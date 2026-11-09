from django.shortcuts import render

# Create your views here.
import json
import re
import requests
from decimal import Decimal
from django.http import JsonResponse
from django.db import connection, connections
from django.db.models import Count
from django.contrib.auth import authenticate, get_user_model, login as django_login, logout as django_logout
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
from datetime import datetime, date, timedelta
from django.conf import settings


COMMUNICATION_TICKET_SOURCE_LABELS = {
    "attendance": "Attendance",
    "pr": "Progress Review",
    "mcm": "Monthly Coaching Meeting",
    "pr_missed": "Missed Progress Review",
    "mcm_missed": "Missed MCM",
    "signature": "Missing Signature",
    "otj": "Off-the-Job Hours",
    "epa": "EPA",
    "reminder": "Reminder",
    "satisfaction": "Satisfaction",
    "learner_satisfaction": "Learner Satisfaction",
    "employer_feedback": "Employer Satisfaction",
    "manual": "Manual Case",
    "tech_support": "Technical Support",
}
COMMUNICATION_SYSTEM_CUTOFF = date(2026, 9, 1)


def _communication_next_workday(day):
    candidate = day + timedelta(days=1)
    while candidate.weekday() >= 5:
        candidate += timedelta(days=1)
    return candidate


def _communication_on_break_emails():
    if "lms" not in settings.DATABASES:
        return []
    break_statuses = [
        "break",
        "onbreak",
        "onabreak",
        "onmaternitybreak",
        "onillnessbreak",
        "onotherbreak",
    ]
    try:
        with connections["lms"].cursor() as cursor:
            cursor.execute("""
                SELECT lower(BTRIM("Email"))
                FROM enrolment."Created_users"
                WHERE regexp_replace(
                    lower(BTRIM(COALESCE("Programme_status", ''))),
                    '\\s+', '', 'g'
                ) = ANY(%s)
                  AND NULLIF(BTRIM("Email"), '') IS NOT NULL
            """, [break_statuses])
            return sorted({row[0] for row in cursor.fetchall() if row[0]})
    except Exception:
        return []


def _communication_case_scope():
    """Return the Communication Centre's operational case scope and parameters."""
    from zoneinfo import ZoneInfo

    today = timezone.now().astimezone(ZoneInfo("Europe/London")).date()
    ready_attendance_date = today - timedelta(days=3)
    next_workday = _communication_next_workday(today)
    on_break_emails = _communication_on_break_emails()
    conditions = [
        "c.source_type NOT IN ('otj', 'satisfaction')",
        "COALESCE(c.source_data->>'eligible', 'true') <> 'false'",
        "NOT (c.source_type = 'reminder' AND c.booking_at < %s)",
        "NOT (c.source_type = 'attendance' AND (c.overdue_since < %s OR c.overdue_since > %s))",
        "NOT (c.source_type IN ('pr', 'mcm', 'pr_missed', 'mcm_missed', 'signature') AND c.overdue_since < %s)",
        "NOT (c.source_type IN ('pr', 'mcm') AND NOT (c.source_data ? 'review_type'))",
    ]
    params = [
        datetime.combine(next_workday, datetime.min.time(), tzinfo=ZoneInfo("Europe/London")),
        COMMUNICATION_SYSTEM_CUTOFF,
        ready_attendance_date,
        COMMUNICATION_SYSTEM_CUTOFF,
    ]
    if on_break_emails:
        conditions.append("lower(BTRIM(c.learner_email)) <> ALL(%s)")
        params.append(on_break_emails)
    return " AND ".join(f"({condition})" for condition in conditions), params


def _communication_ticket_issue(source_type, source_data):
    data = source_data if isinstance(source_data, dict) else {}
    candidates = (
        data.get("module"),
        data.get("review_type"),
        data.get("title"),
        data.get("session_type"),
        data.get("subcategory"),
        data.get("purpose"),
    )
    issue = next((str(value).strip() for value in candidates if str(value or "").strip()), "")
    if source_type == "tech_support" and data.get("ticket"):
        ticket_ref = str(data.get("ticket") or "").strip()
        return " · ".join(value for value in (ticket_ref, issue) if value)
    return issue or COMMUNICATION_TICKET_SOURCE_LABELS.get(
        source_type,
        str(source_type or "Ticket").replace("_", " ").title(),
    )


def _communication_report_bounds(month):
    from zoneinfo import ZoneInfo

    london = ZoneInfo("Europe/London")
    if month == "all":
        return None, None, "Since 1 September 2026"
    if not re.fullmatch(r"\d{4}-\d{2}", month or ""):
        raise ValueError("month must use YYYY-MM or all")
    year, month_number = (int(part) for part in month.split("-"))
    if year < 2020 or not 1 <= month_number <= 12:
        raise ValueError("month is outside the supported range")
    start = datetime(year, month_number, 1, tzinfo=london)
    if month_number == 12:
        end = datetime(year + 1, 1, 1, tzinfo=london)
    else:
        end = datetime(year, month_number + 1, 1, tzinfo=london)
    current_month = timezone.now().astimezone(london).replace(
        day=1,
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    )
    if start > current_month:
        raise ValueError("month cannot be in the future")
    return start, end, start.strftime("%B %Y")


def communication_ticket_report(request):
    """Read-only reporting over the Communication Centre's shared case tables."""
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    # Ticket and learner details are an administrative report, not a public API.
    from .engagement_admin import _admin_only

    denied = _admin_only(request)
    if denied:
        return denied

    month = str(request.GET.get("month") or timezone.localdate().strftime("%Y-%m")).strip()
    try:
        period_start, period_end, period_label = _communication_report_bounds(month)
        page = max(1, int(request.GET.get("page", 1)))
        page_size = min(100, max(10, int(request.GET.get("page_size", 50))))
    except (TypeError, ValueError) as exc:
        return JsonResponse({"error": str(exc) or "Invalid report filters"}, status=400)

    search = str(request.GET.get("search") or "").strip()[:200]
    status_filter = str(request.GET.get("status") or "all").strip().lower()
    source_filter = str(request.GET.get("source") or "all").strip().lower()
    include_tickets = str(request.GET.get("include_tickets") or "false").lower() == "true"

    period_sql = "TRUE"
    period_params = []
    if period_start is not None:
        period_sql = "c.created_at >= %s AND c.created_at < %s"
        period_params = [period_start, period_end]

    scope_sql, scope_params = _communication_case_scope()
    scoped_period_sql = f"({period_sql}) AND ({scope_sql})"
    scoped_period_params = [*period_params, *scope_params]

    table_conditions = [scoped_period_sql]
    table_params = list(scoped_period_params)
    if status_filter == "open":
        table_conditions.append("c.status <> 'resolved' AND c.archived = FALSE")
    elif status_filter == "archived":
        table_conditions.append("c.archived = TRUE")
    elif status_filter != "all":
        table_conditions.append("lower(c.status) = %s")
        table_params.append(status_filter)
    if source_filter != "all":
        table_conditions.append("lower(c.source_type) = %s")
        table_params.append(source_filter)
    if search:
        table_conditions.append("""
            (
                CAST(c.id AS TEXT) ILIKE %s
                OR c.learner_name ILIKE %s
                OR c.learner_email ILIKE %s
                OR c.coach ILIKE %s
                OR c.organisation ILIKE %s
                OR c.programme ILIKE %s
            )
        """)
        search_value = f"%{search}%"
        table_params.extend([search_value] * 6)
    table_where = " AND ".join(f"({condition})" for condition in table_conditions)

    failed_call_results = ["no_answer", "missed", "busy", "voicemail", "rejected"]
    summary = {}
    daily_by_date = {}
    tickets = []
    status_breakdown = []
    source_breakdown = []
    available_months = []
    total_filtered = 0

    try:
        with connection.cursor() as cursor:
            from .engagement_admin import _table_exists, _verified_calls_cte
            from zoneinfo import ZoneInfo

            verified_calls_cte = _verified_calls_cte(_table_exists(cursor, "callcenter_event_call"))
            verified_call_start = period_start or datetime.combine(
                COMMUNICATION_SYSTEM_CUTOFF, datetime.min.time(), tzinfo=ZoneInfo("Europe/London")
            )
            verified_call_end = period_end or (timezone.now() + timedelta(seconds=1))
            cursor.execute(f"""
                SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE c.status <> 'resolved' AND c.archived = FALSE) AS open,
                    COUNT(*) FILTER (WHERE c.status = 'resolved') AS resolved,
                    COUNT(*) FILTER (
                        WHERE c.status <> 'resolved'
                          AND c.archived = FALSE
                          AND (c.sla_breached OR c.due_at < NOW())
                    ) AS sla_breached,
                    COUNT(*) FILTER (WHERE c.archived) AS archived
                FROM callcenter_case c
                WHERE {scoped_period_sql}
            """, scoped_period_params)
            total, open_count, resolved, sla_breached, archived = cursor.fetchone()
            summary.update({
                "ticketsTotal": total,
                "ticketsOpen": open_count,
                "ticketsResolved": resolved,
                "slaBreached": sla_breached,
                "ticketsArchived": archived,
            })

            event_period_sql = "TRUE" if period_start is None else "e.created_at >= %s AND e.created_at < %s"
            cursor.execute(f"""
                SELECT
                    COUNT(DISTINCT e.ticket_id) FILTER (WHERE e.kind = 'escalated'),
                    COUNT(*) FILTER (WHERE e.kind = 'session_booked')
                FROM callcenter_event e
                INNER JOIN callcenter_case c ON c.id = e.ticket_id
                WHERE ({event_period_sql}) AND ({scope_sql})
            """, [*period_params, *scope_params])
            escalated, appointments = cursor.fetchone()
            summary["ticketsEscalated"] = escalated
            summary["appointmentsBooked"] = appointments

            cursor.execute(f"""
                {verified_calls_cte}
                SELECT
                    COUNT(*),
                    COUNT(*) FILTER (WHERE result = 'answered' AND voicemail = ''),
                    COUNT(*) FILTER (
                        WHERE (result = 'answered' AND voicemail <> '') OR result = ANY(%s)
                    )
                FROM verified_calls
                WHERE zoom_started_at >= %s AND zoom_started_at < %s
                  AND direction = 'outbound'
            """, [failed_call_results, verified_call_start, verified_call_end])
            calls, answered, not_answered = cursor.fetchone()
            summary.update({
                "callsTotal": calls,
                "callsAnswered": answered,
                "callsNotAnswered": not_answered,
            })

            email_period_sql = "TRUE" if period_start is None else "em.created_at >= %s AND em.created_at < %s"
            cursor.execute(f"""
                SELECT COUNT(*)
                FROM callcenter_email em
                INNER JOIN callcenter_case c ON c.id = em.ticket_id
                WHERE ({email_period_sql})
                  AND ({scope_sql})
                  AND em.status IN ('accepted', 'sent')
            """, [*period_params, *scope_params])
            summary["emailsSent"] = cursor.fetchone()[0]

            cursor.execute(f"""
                SELECT
                    timezone('Europe/London', c.created_at)::date AS day,
                    COUNT(*) AS tickets_created,
                    COUNT(*) FILTER (WHERE c.status = 'resolved') AS created_and_resolved
                FROM callcenter_case c
                WHERE {scoped_period_sql}
                GROUP BY day
                ORDER BY day
            """, scoped_period_params)
            for day, created, created_and_resolved in cursor.fetchall():
                daily_by_date[day.isoformat()] = {
                    "date": day.isoformat(),
                    "ticketsCreated": created,
                    "ticketsResolved": 0,
                    "createdAndResolved": created_and_resolved,
                    "calls": 0,
                    "answered": 0,
                    "notAnswered": 0,
                    "appointmentsBooked": 0,
                    "emailsSent": 0,
                }

            resolved_period_sql = "c.resolved_at IS NOT NULL" if period_start is None else "c.resolved_at >= %s AND c.resolved_at < %s"
            cursor.execute(f"""
                SELECT timezone('Europe/London', c.resolved_at)::date AS day, COUNT(*)
                FROM callcenter_case c
                WHERE ({resolved_period_sql}) AND ({scope_sql})
                GROUP BY day
                ORDER BY day
            """, [*period_params, *scope_params])
            for day, count in cursor.fetchall():
                key = day.isoformat()
                daily_by_date.setdefault(key, {
                    "date": key, "ticketsCreated": 0, "ticketsResolved": 0,
                    "createdAndResolved": 0, "calls": 0, "answered": 0,
                    "notAnswered": 0, "appointmentsBooked": 0, "emailsSent": 0,
                })["ticketsResolved"] = count

            cursor.execute(f"""
                {verified_calls_cte}
                SELECT
                    timezone('Europe/London', zoom_started_at)::date AS day,
                    COUNT(*),
                    COUNT(*) FILTER (WHERE result = 'answered' AND voicemail = ''),
                    COUNT(*) FILTER (
                        WHERE (result = 'answered' AND voicemail <> '') OR result = ANY(%s)
                    )
                FROM verified_calls
                WHERE zoom_started_at >= %s AND zoom_started_at < %s
                  AND direction = 'outbound'
                GROUP BY day
                ORDER BY day
            """, [failed_call_results, verified_call_start, verified_call_end])
            for day, call_count, answered_count, failed_count in cursor.fetchall():
                key = day.isoformat()
                row = daily_by_date.setdefault(key, {
                    "date": key, "ticketsCreated": 0, "ticketsResolved": 0,
                    "createdAndResolved": 0, "calls": 0, "answered": 0,
                    "notAnswered": 0, "appointmentsBooked": 0, "emailsSent": 0,
                })
                row.update({"calls": call_count, "answered": answered_count, "notAnswered": failed_count})

            cursor.execute(f"""
                SELECT timezone('Europe/London', e.created_at)::date AS day, COUNT(*)
                FROM callcenter_event e
                INNER JOIN callcenter_case c ON c.id = e.ticket_id
                WHERE ({event_period_sql}) AND ({scope_sql}) AND e.kind = 'session_booked'
                GROUP BY day
            """, [*period_params, *scope_params])
            for day, count in cursor.fetchall():
                key = day.isoformat()
                daily_by_date.setdefault(key, {
                    "date": key, "ticketsCreated": 0, "ticketsResolved": 0,
                    "createdAndResolved": 0, "calls": 0, "answered": 0,
                    "notAnswered": 0, "appointmentsBooked": 0, "emailsSent": 0,
                })["appointmentsBooked"] = count

            cursor.execute(f"""
                SELECT timezone('Europe/London', em.created_at)::date AS day, COUNT(*)
                FROM callcenter_email em
                INNER JOIN callcenter_case c ON c.id = em.ticket_id
                WHERE ({email_period_sql}) AND ({scope_sql}) AND em.status IN ('accepted', 'sent')
                GROUP BY day
            """, [*period_params, *scope_params])
            for day, count in cursor.fetchall():
                key = day.isoformat()
                daily_by_date.setdefault(key, {
                    "date": key, "ticketsCreated": 0, "ticketsResolved": 0,
                    "createdAndResolved": 0, "calls": 0, "answered": 0,
                    "notAnswered": 0, "appointmentsBooked": 0, "emailsSent": 0,
                })["emailsSent"] = count

            cursor.execute(f"""
                SELECT c.status, COUNT(*)
                FROM callcenter_case c
                WHERE {scoped_period_sql}
                GROUP BY c.status
                ORDER BY COUNT(*) DESC, c.status
            """, scoped_period_params)
            status_breakdown = [
                {"key": key, "label": str(key).replace("_", " ").title(), "count": count}
                for key, count in cursor.fetchall()
            ]

            cursor.execute(f"""
                SELECT c.source_type, COUNT(*)
                FROM callcenter_case c
                WHERE {scoped_period_sql}
                GROUP BY c.source_type
                ORDER BY COUNT(*) DESC, c.source_type
            """, scoped_period_params)
            source_breakdown = [
                {
                    "key": key,
                    "label": COMMUNICATION_TICKET_SOURCE_LABELS.get(
                        key, str(key).replace("_", " ").title()
                    ),
                    "count": count,
                }
                for key, count in cursor.fetchall()
            ]

            cursor.execute(f"""
                SELECT to_char(timezone('Europe/London', c.created_at), 'YYYY-MM') AS month, COUNT(*)
                FROM callcenter_case c
                WHERE {scope_sql}
                GROUP BY month
                ORDER BY month DESC
            """, scope_params)
            available_months = [
                {"value": value, "count": count} for value, count in cursor.fetchall()
            ]

            if include_tickets:
                cursor.execute(f"SELECT COUNT(*) FROM callcenter_case c WHERE {table_where}", table_params)
                total_filtered = cursor.fetchone()[0]
                max_page = max(1, (total_filtered + page_size - 1) // page_size)
                page = min(page, max_page)
                offset = (page - 1) * page_size

                cursor.execute(f"""
                    SELECT
                        c.id,
                        c.source_type,
                        c.learner_name,
                        c.learner_email,
                        c.learner_phone,
                        c.coach,
                        c.organisation,
                        c.programme,
                        c.source_data,
                        c.risk,
                        c.status,
                        c.attempts,
                        c.misses,
                        c.overdue_since,
                        c.due_at,
                        c.sla_breached,
                        c.escalated,
                        c.archived,
                        c.created_at,
                        c.updated_at,
                        c.resolved_at,
                        c.resolved_by,
                        c.resolution_option,
                        c.last_actor,
                        agent.display_name AS claimed_by
                    FROM callcenter_case c
                    LEFT JOIN callcenter_agent agent ON agent.id = c.claimed_by_id
                    WHERE {table_where}
                    ORDER BY c.created_at DESC, c.id DESC
                    LIMIT %s OFFSET %s
                """, [*table_params, page_size, offset])
                columns = [column[0] for column in cursor.description]
                for values in cursor.fetchall():
                    row = dict(zip(columns, values))
                    source_type = row["source_type"]
                    tickets.append({
                        "id": row["id"],
                        "ticketRef": f"CC-{row['id']:06d}",
                        "sourceType": source_type,
                        "sourceLabel": COMMUNICATION_TICKET_SOURCE_LABELS.get(
                            source_type, str(source_type).replace("_", " ").title()
                        ),
                        "issue": _communication_ticket_issue(source_type, row["source_data"]),
                        "issueDate": row["overdue_since"].isoformat() if row["overdue_since"] else None,
                        "learnerName": row["learner_name"],
                        "learnerEmail": row["learner_email"],
                        "learnerPhone": row["learner_phone"],
                        "coach": row["coach"],
                        "organisation": row["organisation"],
                        "programme": row["programme"],
                        "risk": row["risk"],
                        "status": row["status"],
                        "attempts": row["attempts"],
                        "misses": row["misses"],
                        "dueAt": row["due_at"].isoformat() if row["due_at"] else None,
                        "slaBreached": bool(
                            row["status"] != "resolved"
                            and not row["archived"]
                            and (row["sla_breached"] or (row["due_at"] and row["due_at"] < timezone.now()))
                        ),
                        "escalated": row["escalated"],
                        "archived": row["archived"],
                        "claimedBy": row["claimed_by"] or "",
                        "lastActor": row["last_actor"],
                        "createdAt": row["created_at"].isoformat(),
                        "updatedAt": row["updated_at"].isoformat(),
                        "resolvedAt": row["resolved_at"].isoformat() if row["resolved_at"] else None,
                        "resolvedBy": row["resolved_by"],
                        "resolutionOption": row["resolution_option"],
                    })
    except Exception as exc:
        return JsonResponse({
            "error": "Communication Centre ticket data is temporarily unavailable",
            "detail": str(exc) if settings.DEBUG else "",
        }, status=503)

    return JsonResponse({
        "period": {
            "value": month,
            "label": period_label,
            "from": period_start.date().isoformat() if period_start else None,
            "to": (period_end - timedelta(days=1)).date().isoformat() if period_end else None,
            "timezone": "Europe/London",
        },
        "scope": {
            "from": COMMUNICATION_SYSTEM_CUTOFF.isoformat(),
            "label": "Communication Centre operational scope",
        },
        "summary": summary,
        "daily": [daily_by_date[key] for key in sorted(daily_by_date)],
        "statusBreakdown": status_breakdown,
        "sourceBreakdown": source_breakdown,
        "months": available_months,
        "filters": {
            "statuses": [{"value": row["key"], "label": row["label"]} for row in status_breakdown],
            "sources": [{"value": row["key"], "label": row["label"]} for row in source_breakdown],
        },
        "tickets": tickets,
        "pagination": {
            "page": page,
            "pageSize": page_size,
            "total": total_filtered,
            "pages": max(1, (total_filtered + page_size - 1) // page_size),
        },
        "ticketsIncluded": include_tickets,
    })


def _json_body(request):
    try:
        return json.loads(request.body.decode("utf-8") or "{}")
    except Exception:
        return {}


def _auth_user_payload(user):
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "firstName": user.first_name,
        "lastName": user.last_name,
        "fullName": (user.get_full_name() or user.username or user.email).strip(),
        "isStaff": user.is_staff,
        "isSuperuser": user.is_superuser,
    }


def _find_auth_user_by_identifier(identifier):
    User = get_user_model()
    value = str(identifier or "").strip()
    if not value:
        return None

    user = User.objects.filter(email__iexact=value).first()
    if user:
        return user

    return User.objects.filter(username__iexact=value).first()


def auth_session(request):
    if not request.user.is_authenticated:
        return JsonResponse({"authenticated": False, "user": None})

    return JsonResponse({
        "authenticated": True,
        "user": _auth_user_payload(request.user),
    })


@csrf_exempt
def auth_login(request):
    if request.method != "POST":
        return JsonResponse({"detail": "POST required"}, status=405)

    body = _json_body(request)
    identifier = str(body.get("identifier") or body.get("email") or body.get("username") or "").strip()
    password = str(body.get("password") or "")

    if not identifier or not password:
        return JsonResponse({"detail": "Username/email and password are required."}, status=400)

    user_record = _find_auth_user_by_identifier(identifier)
    if not user_record:
        return JsonResponse({"detail": "No active KBC account was found for this email or username."}, status=401)

    user = authenticate(request, username=user_record.username, password=password)
    if not user:
        return JsonResponse({"detail": "Invalid username/email or password."}, status=401)

    if not user.is_active:
        return JsonResponse({"detail": "This KBC account is inactive."}, status=403)

    django_login(request, user)
    return JsonResponse({"authenticated": True, "user": _auth_user_payload(user)})


@csrf_exempt
def auth_microsoft_login(request):
    if request.method != "POST":
        return JsonResponse({"detail": "POST required"}, status=405)

    body = _json_body(request)
    access_token = str(body.get("accessToken") or "").strip()
    if not access_token:
        return JsonResponse({"detail": "Microsoft access token is required."}, status=400)

    try:
        graph_res = requests.get(
            "https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=15,
        )
    except Exception as exc:
        return JsonResponse({"detail": f"Could not contact Microsoft Graph: {exc}"}, status=502)

    if graph_res.status_code >= 400:
        return JsonResponse({"detail": "Microsoft sign-in could not be verified."}, status=401)

    profile = graph_res.json()
    email = str(profile.get("mail") or profile.get("userPrincipalName") or "").strip()
    if not email:
        return JsonResponse({"detail": "Microsoft account did not return an email address."}, status=401)

    user = _find_auth_user_by_identifier(email)
    if not user:
        return JsonResponse({"detail": "This Microsoft email is not registered in KBC auth_user."}, status=403)

    if not user.is_active:
        return JsonResponse({"detail": "This KBC account is inactive."}, status=403)

    django_login(request, user)
    return JsonResponse({"authenticated": True, "user": _auth_user_payload(user)})


@csrf_exempt
def auth_logout(request):
    if request.method != "POST":
        return JsonResponse({"detail": "POST required"}, status=405)

    django_logout(request)
    return JsonResponse({"authenticated": False, "user": None})

# Next PR 
def split_next_review_status(value):
    raw = str(value or "").strip()
    if not raw:
        return "", ""

    if "(" in raw and ")" in raw:
        date_part = raw.split("(", 1)[0].strip()
        state_part = raw.split("(", 1)[1].rsplit(")", 1)[0].strip()
        return date_part, state_part

    return raw, ""

def current_db_info(request):
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_database(), current_schema()")
        row = cursor.fetchone()

    return JsonResponse({
        "database": row[0],
        "schema": row[1],
    })

def parse_date_safe(value):
    if not value:
        return None

    value = str(value).strip()
    if not value or value.upper() == "N/A":
        return None

    formats = [
        "%Y-%m-%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%Y/%m/%d",
        "%d-%m-%y",
        "%d/%m/%y",
        "%d %b %Y",
        "%d %B %Y",
    ]

    for fmt in formats:
        try:
            return datetime.strptime(value, fmt).date()
        except Exception:
            continue

    import re

    match = re.search(
        r"(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})",
        value,
    )
    if match:
        extracted = match.group(1).strip()
        for fmt in formats:
            try:
                return datetime.strptime(extracted, fmt).date()
            except Exception:
                continue

    return None


def is_completed_status(status_value):
    s = str(status_value or "").strip().lower()
    return "completed" in s


def is_archived_status(status_value):
    s = str(status_value or "").strip().lower()
    return "archived" in s


def is_scheduled_status(status_value):
    s = str(status_value or "").strip().lower()
    return "scheduled" in s and "not scheduled" not in s


def is_countable_progress_review_slot(planned_value):
    planned_text = str(planned_value or "").strip().lower()
    if "personal support plan" in planned_text or "gateway review" in planned_text:
        return False

    return True


def _latest_dated_item(items, date_key="date"):
    dated_items = []
    for item in items or []:
        item_date = parse_date_safe(item.get(date_key))
        if item_date:
            dated_items.append((item_date, item))
    if not dated_items:
        return None
    dated_items.sort(key=lambda pair: pair[0])
    return dated_items[-1][1]


def progress_review_summary(request):
    learner_filter = str(
        request.GET.get("learner_email")
        or request.GET.get("email")
        or request.GET.get("learner")
        or ""
    ).strip().lower()

    # Fetch phone / organisation from aptem_auto_extracting for enrichment
    learner_extras = {}
    try:
        with connections["aptem"].cursor() as cur:
            cur.execute("""
                SELECT "Email", "Learner Phone", "OrganizationName"
                FROM public.aptem_auto_extracting
            """)
            for row in cur.fetchall():
                em = (row[0] or "").strip().lower()
                if em:
                    learner_extras[em] = {
                        "phone": str(row[1] or "").strip(),
                        "organisation": str(row[2] or "").strip(),
                    }
    except Exception:
        pass

    with connections["aptem"].cursor() as cursor:
        learner_where = 'AND LOWER(TRIM("Email")) = %s' if learner_filter else ""
        params = [learner_filter] if learner_filter else []
        cursor.execute(f"""
            SELECT
                "ID",
                "FullName",
                "Email",
                "Group",
                "CaseOwner",
                "Last Actually Completed PR",
                "Last Progress Review",
                "Next Review (Status)",
                "Review Planned Date1", "Review Status1",
                "Review Planned Date2", "Review Status2",
                "Review Planned Date3", "Review Status3",
                "Review Planned Date4", "Review Status4",
                "Review Planned Date5", "Review Status5",
                "Review Planned Date6", "Review Status6",
                "Review Planned Date7", "Review Status7",
                "Review Planned Date8", "Review Status8",
                "Review Planned Date9", "Review Status9",
                "Review Planned Date10", "Review Status10",
                "Review Planned Date11", "Review Status11",
                "Review Planned Date12", "Review Status12",
                "Review Planned Date13", "Review Status13",
                "Review Planned Date14", "Review Status14",
                "Review Planned Date15", "Review Status15",
                "Review Planned Date16", "Review Status16"
            FROM public.progress_review
            WHERE LOWER(COALESCE("Status", '')) = 'active'
              {learner_where}
        """, params)
        columns = [col[0] for col in cursor.description]
        raw_rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

    today = date.today()
    results = []

    for row in raw_rows:
        overdue_count = 0
        next_pr_date_from_planned = None
        next_pr_state_from_planned = ""
        latest_due_pr_date = None
        latest_due_pr_state = ""
        all_planned_dates = []
        planned_candidates = []
        last_actually_completed_pr = row.get("Last Actually Completed PR") or ""
        last_progress_review = row.get("Last Progress Review") or ""
        last_completed_pr_date = parse_date_safe(last_actually_completed_pr or last_progress_review)
        excluded_planned_dates = set()
        countable_planned_dates = set()

        for i in range(1, 17):
            planned_key = f"Review Planned Date{i}"
            status_key = f"Review Status{i}"

            planned_value = row.get(planned_key)
            planned_date = parse_date_safe(planned_value)
            planned_status_raw = str(row.get(status_key) or "").strip()
            completed = is_completed_status(planned_status_raw)
            archived = is_archived_status(planned_status_raw)

            if not planned_date:
                continue
            if not is_countable_progress_review_slot(planned_value):
                excluded_planned_dates.add(planned_date)
                continue
            countable_planned_dates.add(planned_date)

            all_planned_dates.append({
                "date": planned_date.strftime("%Y-%m-%d"),
                "status": planned_status_raw,
                "completed": completed,
                "isPast": planned_date < today,
            })
            planned_candidates.append({
                "date": planned_date,
                "status": planned_status_raw,
                "completed": completed,
                "archived": archived,
            })

            if planned_date < today and not completed and not archived:
                overdue_count += 1
                if latest_due_pr_date is None or planned_date > latest_due_pr_date:
                    latest_due_pr_date = planned_date
                    latest_due_pr_state = planned_status_raw

            is_after_last_completed = not last_completed_pr_date or planned_date > last_completed_pr_date
            if planned_date >= today and is_after_last_completed and not completed and not archived:
                if next_pr_date_from_planned is None or planned_date < next_pr_date_from_planned:
                    next_pr_date_from_planned = planned_date
                    next_pr_state_from_planned = planned_status_raw

        if overdue_count <= 0:
            review_status = "Ahead"
        elif overdue_count > 12:
            review_status = "Due"
        elif overdue_count > 10:
            review_status = "At Risk"
        else:
            review_status = "Normal"

        next_review_raw = row.get("Next Review (Status)") or ""
        next_pr_date_raw, next_pr_state = split_next_review_status(next_review_raw)

        parsed_field_date = parse_date_safe(next_pr_date_raw) if next_pr_date_raw else None
        reference_pr_date = last_completed_pr_date or today
        scheduled_window_start = reference_pr_date + timedelta(weeks=10)
        scheduled_window_end = reference_pr_date + timedelta(weeks=12)
        scheduled_pr_candidate = None
        for candidate in planned_candidates:
            candidate_date = candidate["date"]
            if not (
                is_scheduled_status(candidate["status"])
                and not candidate["completed"]
                and not candidate["archived"]
                and candidate_date >= today
                and scheduled_window_start <= candidate_date <= scheduled_window_end
            ):
                continue
            if scheduled_pr_candidate is None or candidate_date < scheduled_pr_candidate["date"]:
                scheduled_pr_candidate = candidate

        if scheduled_pr_candidate:
            next_pr_date = scheduled_pr_candidate["date"].strftime("%Y-%m-%d")
            next_pr_state = scheduled_pr_candidate["status"]
        elif parsed_field_date and parsed_field_date >= today and (
            not last_completed_pr_date or parsed_field_date > last_completed_pr_date
        ) and parsed_field_date not in excluded_planned_dates and (
            not countable_planned_dates or parsed_field_date in countable_planned_dates
        ):
            next_pr_date = parsed_field_date.strftime("%Y-%m-%d")
        elif next_pr_date_from_planned:
            next_pr_date = next_pr_date_from_planned.strftime("%Y-%m-%d")
            next_pr_state = next_pr_state_from_planned
        else:
            next_pr_date = ""
            next_pr_state = ""

        if not next_pr_state and next_pr_state_from_planned:
            next_pr_state = next_pr_state_from_planned

        email_key = (row.get("Email") or "").strip().lower()
        extras = learner_extras.get(email_key, {})

        results.append({
            "id": row.get("ID"),
            "fullName": row.get("FullName") or "",
            "email": email_key,
            "group": row.get("Group") or "",
            "caseOwner": row.get("CaseOwner") or "",
            "phone": extras.get("phone", ""),
            "organisation": extras.get("organisation", ""),
            "lastActuallyCompletedPr": last_actually_completed_pr,
            "lastProgressReview": last_progress_review,
            "nextReviewStatus": next_review_raw,
            "duePrDate": latest_due_pr_date.strftime("%Y-%m-%d") if latest_due_pr_date else "",
            "duePrState": latest_due_pr_state,
            "nextPrDate": next_pr_date,
            "nextPrState": next_pr_state,
            "overduePrCount": overdue_count,
            "reviewStatus": review_status,
            "plannedDates": all_planned_dates,
        })

    return JsonResponse(results, safe=False)

def test_kbc_attendance(request):
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT "Email", "date", "module", "Attendance", "called", "emailed", "resolved", "resolved_at", "note"
            FROM public.kbc_attendance
            ORDER BY "date" DESC
            LIMIT 20
        """)
        rows = cursor.fetchall()

    data = []
    for row in rows:
        data.append({
            "email": row[0],
            "date": row[1].isoformat() if row[1] else None,
            "module": row[2],
            "attendance": row[3],
            "called": bool(row[4]),
            "emailed": bool(row[5]),
            "resolved": bool(row[6]),
            "resolved_at": row[7].isoformat() if row[7] else None,
            "note": row[8] or "",
        })

    return JsonResponse(data, safe=False)


@csrf_exempt
def learner_contact_actions(request):
    from django.utils import timezone
    from .models import AttendanceContactAction

    if request.method == "GET":
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT "Email", "date", "module", "called", "emailed", "resolved", "resolved_at", "note"
                FROM public.kbc_attendance
                WHERE "called" = true
                   OR "emailed" = true
                   OR "resolved" = true
                   OR COALESCE("note", '') <> ''
                ORDER BY "date" DESC
                LIMIT 1000
            """)
            rows = cursor.fetchall()

        data = []
        for row in rows:
            email = (row[0] or "").strip().lower()
            date_value = row[1].isoformat() if row[1] else None
            module = row[2] or ""

            data.append({
                "email": email,
                "date": date_value,
                "module": module,
                "called": bool(row[3]),
                "emailed": bool(row[4]),
                "resolved": bool(row[5]),
                "resolved_at": row[6].isoformat() if row[6] else None,
                "note": row[7] or "",
                "source": "legacy",
                "contact_key": f"legacy||{email}||{date_value}||{module}",
            })

        for action in AttendanceContactAction.objects.all():
            date_value = action.attendance_date.isoformat()
            data.append({
                "email": action.learner_email,
                "date": date_value,
                "module": action.attendance_module,
                "called": action.called,
                "emailed": action.emailed,
                "resolved": action.resolved,
                "resolved_at": action.resolved_at.isoformat() if action.resolved_at else None,
                "note": action.note,
                "source": action.source,
                "contact_key": f"{action.source}||{action.learner_email}||{date_value}||{action.attendance_module}",
            })

        return JsonResponse(data, safe=False)

    if request.method == "PATCH":
        try:
            body = json.loads(request.body.decode("utf-8"))

            email = str(body.get("email", "")).strip().lower()
            date_value = body.get("date")
            module = str(body.get("module", "")).strip()
            source = str(body.get("source", "legacy")).strip().lower()
            called = bool(body.get("called", False))
            emailed = bool(body.get("emailed", False))
            resolved = bool(body.get("resolved", False))
            note = str(body.get("note", "")).strip()

            if not email or not date_value or not module:
                return JsonResponse(
                    {"error": "email, date and module are required"},
                    status=400,
                )

            if source == "live":
                action, _created = AttendanceContactAction.objects.update_or_create(
                    source="live",
                    learner_email=email,
                    attendance_date=date_value,
                    attendance_module=module,
                    defaults={
                        "called": called,
                        "emailed": emailed,
                        "resolved": resolved,
                        "resolved_at": timezone.now() if resolved else None,
                        "note": note,
                    },
                )
                return JsonResponse({
                    "email": action.learner_email,
                    "date": action.attendance_date.isoformat(),
                    "module": action.attendance_module,
                    "called": action.called,
                    "emailed": action.emailed,
                    "resolved": action.resolved,
                    "resolved_at": action.resolved_at.isoformat() if action.resolved_at else None,
                    "note": action.note,
                    "source": "live",
                    "contact_key": f"live||{action.learner_email}||{action.attendance_date.isoformat()}||{action.attendance_module}",
                })

            with connection.cursor() as cursor:
                cursor.execute("""
                    UPDATE public.kbc_attendance
                    SET "called" = %s,
                        "emailed" = %s,
                        "resolved" = %s,
                        "note" = %s,
                        "resolved_at" = CASE
                            WHEN %s = true THEN NOW()
                            ELSE NULL
                        END
                    WHERE lower("Email") = lower(%s)
                      AND "date" = %s
                      AND "module" = %s
                    RETURNING "Email", "date", "module", "called", "emailed", "resolved", "resolved_at", "note"
                """, [called, emailed, resolved, note, resolved, email, date_value, module])

                row = cursor.fetchone()

            if not row:
                return JsonResponse({"error": "Attendance row not found"}, status=404)

            return JsonResponse({
                "email": row[0],
                "date": row[1].isoformat() if row[1] else None,
                "module": row[2],
                "called": bool(row[3]),
                "emailed": bool(row[4]),
                "resolved": bool(row[5]),
                "resolved_at": row[6].isoformat() if row[6] else None,
                "note": row[7] or "",
                "source": "legacy",
                "contact_key": f"legacy||{(row[0] or '').strip().lower()}||{row[1].isoformat() if row[1] else None}||{row[2] or ''}",
            })

        except Exception as e:
            return JsonResponse({"error": str(e)}, status=500)

    return JsonResponse({"error": "Method not allowed"}, status=405)

# Employer attendance summary based on due dates in booking review summaries and actual attendance records
def booking_review_employer_summary(request):
    with connections["employer"].cursor() as cursor:
        cursor.execute("""
            SELECT
                id,
                case_owner_id,
                day_date,
                booking_id,
                service_name,
                meeting_subject,
                customer_name,
                customer_email,
                learner_email,
                learner_phone,
                total_participant_count,
                staff_names,
                staff_emails,
                status,
                summary_json,
                summary_text,
                planned,
                submitted,
                expected,
                otj_hours_status,
                inserted_at,
                last_synced_at
            FROM public.booking_review_summaries
            WHERE
                LOWER(COALESCE(service_name, '')) LIKE '%progress review%'
                OR LOWER(COALESCE(service_name, '')) LIKE '%monthly coaching review%'
                OR LOWER(COALESCE(service_name, '')) LIKE '%mcr%'
                OR LOWER(COALESCE(meeting_subject, '')) LIKE '%progress review%'
                OR LOWER(COALESCE(meeting_subject, '')) LIKE '%monthly coaching review%'
                OR LOWER(COALESCE(meeting_subject, '')) LIKE '%mcr%'
            ORDER BY day_date DESC NULLS LAST, id DESC
        """)
        columns = [col[0] for col in cursor.description]
        raw_rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

    results = []

    for row in raw_rows:
        learner_email = str(
            row.get("learner_email") or row.get("customer_email") or ""
        ).strip().lower()

        summary_data = row.get("summary_json")
        if isinstance(summary_data, str):
            try:
                summary_data = json.loads(summary_data)
            except Exception:
                summary_data = None

        employer_owner = ""
        employer_action = ""
        employer_due = ""

        if isinstance(summary_data, dict):
            actions = summary_data.get("priority_actions", []) or []

            for act in actions:
                owner = str(act.get("owner") or "").strip()
                action = str(act.get("action") or "").strip()
                due = str(act.get("due") or "").strip()

                owner_lower = owner.lower()
                if "employer" in owner_lower or "line manager" in owner_lower:
                    employer_owner = owner
                    employer_action = action
                    employer_due = due
                    break

        total_participants = row.get("total_participant_count") or 0
        staff_names = str(row.get("staff_names") or "").strip()
        staff_emails = str(row.get("staff_emails") or "").strip()

        # افتراض عملي:
        # 2 مشاركين = غالبًا coach + learner
        # 3 أو أكثر = employer حاضر غالبًا
        if total_participants >= 3:
            employer_attendance = "Yes"
        else:
            employer_attendance = "No"

        results.append({
            "id": row.get("id"),
            "caseOwnerId": row.get("case_owner_id"),
            "dayDate": row.get("day_date").isoformat() if row.get("day_date") else None,
            "bookingId": row.get("booking_id") or "",
            "serviceName": row.get("service_name") or "",
            "meetingSubject": row.get("meeting_subject") or "",
            "customerName": row.get("customer_name") or "",
            "customerEmail": str(row.get("customer_email") or "").strip().lower(),
            "learnerEmail": learner_email,
            "learnerPhone": row.get("learner_phone") or "",
            "totalParticipantCount": total_participants,
            "staffNames": staff_names,
            "staffEmails": staff_emails,
            "status": row.get("status") or "",
            "planned": row.get("planned"),
            "submitted": row.get("submitted"),
            "expected": row.get("expected"),
            "otjHoursStatus": row.get("otj_hours_status") or "",
            "insertedAt": row.get("inserted_at").isoformat() if row.get("inserted_at") else None,
            "lastSyncedAt": row.get("last_synced_at").isoformat() if row.get("last_synced_at") else None,
            "employerAttendance": employer_attendance,
            "employerOwner": employer_owner,
            "employerAction": employer_action,
            "employerDue": employer_due,
            "summaryText": row.get("summary_text") or "",
        })

    return JsonResponse(results, safe=False)
# Test
def employer_tables_debug(request):
    with connections["employer"].cursor() as cursor:
        cursor.execute("""
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_type = 'BASE TABLE'
            ORDER BY table_schema, table_name
        """)
        rows = cursor.fetchall()

    return JsonResponse(
        [
            {"schema": row[0], "table": row[1]}
            for row in rows
        ],
        safe=False
    )

def progress_review_booked_summary(request):
    planned_cols = ", ".join(
        f'"Review Planned Date{i}", "Review Status{i}"' for i in range(1, 17)
    )
    with connections["aptem"].cursor() as cursor:
        cursor.execute(f"""
            SELECT
                "ID", "FullName", "Email", "CaseOwner", "case_owner_id",
                "Last Progress Review",
                "Next Review (Status)",
                {planned_cols}
            FROM public.progress_review
            WHERE LOWER(COALESCE("Status", '')) = 'active'
        """)
        columns = [col[0] for col in cursor.description]
        raw_rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

    results = []
    for row in raw_rows:
        # Must have a currently scheduled next review
        next_review_raw = row.get("Next Review (Status)") or ""
        date_part, state_part = split_next_review_status(next_review_raw)
        if state_part.strip().lower() != "scheduled":
            continue
        parsed_next = parse_date_safe(date_part)
        if not parsed_next:
            continue

        # Collect all 16 planned review slots for quarter filtering
        all_dates = []
        last_progress_review = row.get("Last Progress Review") or ""
        excluded_planned_dates = set()
        for i in range(1, 17):
            planned_value = row.get(f"Review Planned Date{i}")
            planned_date = parse_date_safe(planned_value)
            status_raw = str(row.get(f"Review Status{i}") or "").strip()
            if not planned_date:
                continue
            if not is_countable_progress_review_slot(planned_value):
                excluded_planned_dates.add(planned_date)
                continue
            all_dates.append({
                "date": planned_date.strftime("%Y-%m-%d"),
                "status": status_raw,
                "completed": is_completed_status(status_raw),
            })

        # Ensure the next scheduled date is present
        next_date_str = parsed_next.strftime("%Y-%m-%d")
        if parsed_next in excluded_planned_dates:
            continue
        if not any(d["date"] == next_date_str for d in all_dates):
            all_dates.append({
                "date": next_date_str,
                "status": state_part,
                "completed": False,
            })

        results.append({
            "id": row.get("ID"),
            "fullName": row.get("FullName") or "",
            "email": (row.get("Email") or "").strip().lower(),
            "caseOwner": row.get("CaseOwner") or "",
            "caseOwnerId": row.get("case_owner_id"),
            "bookedDates": all_dates,
            "nextBookedDate": next_date_str,
        })

    return JsonResponse(results, safe=False)


def aptem_learners_summary(request):
    with connections["aptem"].cursor() as cursor:
        cursor.execute("""
            SELECT
                "ID",
                "FullName",
                "Email",
                "Group",
                "Minimum",
                "Planned",
                "Submitted",
                "Completed",
                "Forecast",
                "Exepected",
                "ProgressVariance",
                "Progress-Hours",
                "OTJHoursStatus",
                "TotalTargetKSB",
                "TotalCompletedKSB",
                "KSBStatus",
                "Start-Date",
                "End-Date",
                "Total Days",
                "Elapsed-Days",
                "Program Name",
                "Program-Status",
                "subprogramme",
                "TotalCompCount",
                "TargetCompCount",
                "CompletedCompCount",
                "TargetComp%",
                "CompletedComp%",
                "CompStatus",
                "OwnerName",
                "OwnerEmail",
                "Coach-RAG",
                "OrganizationName",
                "ManagerName",
                "ManagerEmail",
                "Manager Phone",
                "Employer Email",
                "Employer Repsentative",
                "Learner Phone",
                "Gender",
                "Disability",
                "Subscription Status",
                "Levy or Not",
                "Working hours",
                "case_owner_id",
                "Assignment Evidence",
                "AssignEvdHours",
                "LMS Evidence",
                "LMSEvdHours",
                "ExtraAct-Evidence",
                "ExtrEvdHours",
                "Markers_Markers",
                "components",
                "apprenticeship-agreement",
                "trainingplan",
                "individual-learning-record",
                "contract-for-service",
                "written-agreement",
                "Address",
                "post code "
            FROM public.aptem_auto_extracting
        """)
        columns = [col[0] for col in cursor.description]
        raw_rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

    results = []
    for row in raw_rows:
        results.append({
            "id": row.get("ID"),
            "fullName": row.get("FullName") or "",
            "email": (row.get("Email") or "").strip().lower(),
            "group": row.get("Group") or "",
            "otjMinimum": float(row.get("Minimum") or 0),
            "otjPlanned": float(row.get("Planned") or 0),
            "otjSubmitted": float(row.get("Submitted") or 0),
            "otjCompleted": float(row.get("Completed") or 0),
            "otjForecast": float(row.get("Forecast") or 0),
            "otjExpected": float(row.get("Exepected") or 0),
            "progressVariance": row.get("ProgressVariance") or "",
            "progressHours": row.get("Progress-Hours") or "",
            "otjHoursStatus": row.get("OTJHoursStatus") or "",
            "totalTargetKsb": row.get("TotalTargetKSB"),
            "totalCompletedKsb": row.get("TotalCompletedKSB"),
            "ksbStatus": row.get("KSBStatus") or "",
            "startDate": row.get("Start-Date").isoformat() if row.get("Start-Date") else None,
            "endDate": row.get("End-Date").isoformat() if row.get("End-Date") else None,
            "totalDays": row.get("Total Days"),
            "elapsedDays": row.get("Elapsed-Days"),
            "programName": row.get("Program Name") or "",
            "programStatus": row.get("Program-Status") or "",
            "subprogramme": row.get("subprogramme") or "",
            "totalCompCount": row.get("TotalCompCount"),
            "targetCompCount": row.get("TargetCompCount"),
            "completedCompCount": row.get("CompletedCompCount") or "",
            "targetCompPct": row.get("TargetComp%") or "",
            "completedCompPct": row.get("CompletedComp%") or "",
            "compStatus": row.get("CompStatus") or "",
            "ownerName": row.get("OwnerName") or "",
            "ownerEmail": (row.get("OwnerEmail") or "").strip().lower(),
            "coachRag": row.get("Coach-RAG") or "",
            "organizationName": row.get("OrganizationName") or "",
            "managerName": row.get("ManagerName") or "",
            "managerEmail": (row.get("ManagerEmail") or "").strip().lower(),
            "managerPhone": row.get("Manager Phone") or "",
            "employerEmail": (row.get("Employer Email") or "").strip().lower(),
            "employerRepresentative": row.get("Employer Repsentative") or "",
            "learnerPhone": row.get("Learner Phone") or "",
            "gender": row.get("Gender") or "",
            "disability": row.get("Disability") or "",
            "subscriptionStatus": row.get("Subscription Status") or "",
            "levyOrNot": row.get("Levy or Not") or "",
            "workingHours": row.get("Working hours") or "",
            "caseOwnerId": row.get("case_owner_id"),
            "assignmentEvidence": row.get("Assignment Evidence"),
            "assignEvdHours": float(row.get("AssignEvdHours") or 0),
            "lmsEvidence": row.get("LMS Evidence"),
            "lmsEvdHours": float(row.get("LMSEvdHours") or 0),
            "extraActEvidence": row.get("ExtraAct-Evidence"),
            "extraEvdHours": float(row.get("ExtrEvdHours") or 0),
            "markers": row.get("Markers_Markers") or "",
            "components": row.get("components") or "",
            "apprenticeshipAgreement": row.get("apprenticeship-agreement") or "",
            "trainingPlan": row.get("trainingplan") or "",
            "individualLearningRecord": row.get("individual-learning-record") or "",
            "contractForService": row.get("contract-for-service") or "",
            "writtenAgreement": row.get("written-agreement") or "",
            "address": row.get("Address") or "",
            "postCode": row.get("post code ") or "",
        })

    return JsonResponse(results, safe=False)


def _epa_is_active(row):
    program_status = str(row.get("Program-Status") or "").strip().lower()
    subscription_status = str(row.get("Subscription Status") or "").strip().lower()
    return program_status == "active" or subscription_status == "active"


def _epa_rows():
    with connections["aptem"].cursor() as cursor:
        cursor.execute("""
            SELECT
                "ID",
                "FullName",
                "Email",
                "Program Name",
                "Program-Status",
                "Subscription Status",
                "End-Date",
                "OwnerName",
                "OrganizationName",
                "ManagerName",
                "ManagerEmail",
                "Learner Phone",
                "OTJHoursStatus"
            FROM public.aptem_auto_extracting
        """)
        columns = [col[0] for col in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _epa_learner_dict(row, today=None):
    today = today or date.today()
    end_date = row.get("End-Date")
    days_until = (end_date - today).days if end_date else None
    days_late = (today - end_date).days if end_date else 0
    return {
        "id": row.get("ID"),
        "fullName": row.get("FullName") or "",
        "email": (row.get("Email") or "").strip().lower(),
        "phone": row.get("Learner Phone") or "",
        "organisation": row.get("OrganizationName") or "",
        "programme": row.get("Program Name") or "",
        "coach": row.get("OwnerName") or "",
        "managerName": row.get("ManagerName") or "",
        "managerEmail": (row.get("ManagerEmail") or "").strip().lower(),
        "endDate": end_date.isoformat() if end_date else None,
        "daysUntilEnd": days_until,
        "daysOverdue": max(0, days_late - 7),
        "programStatus": row.get("Program-Status") or "",
        "subscriptionStatus": row.get("Subscription Status") or "",
        "otjHoursStatus": row.get("OTJHoursStatus") or "",
    }


def epa_summary(request):
    today = date.today()
    close_to_epa = []
    overdue = []
    entered_epa = []

    for row in _epa_rows():
        program_status = str(row.get("Program-Status") or "").strip().lower()
        if program_status == "enteredepa":
            entered_epa.append(_epa_learner_dict(row, today))

        end_date = row.get("End-Date")
        if not _epa_is_active(row):
            continue
        if not end_date:
            continue
        item = _epa_learner_dict(row, today)
        if 0 <= (end_date - today).days <= 60:
            close_to_epa.append(item)
        if today > end_date + timedelta(days=7):
            overdue.append(item)

    close_to_epa.sort(key=lambda item: item.get("endDate") or "")
    overdue.sort(key=lambda item: item.get("daysOverdue") or 0, reverse=True)
    entered_epa.sort(key=lambda item: item.get("endDate") or "")
    return JsonResponse({
        "closeToEpa": close_to_epa,
        "epaOverdue": overdue,
        "enteredEpa": entered_epa,
        "closeToEpaCount": len(close_to_epa),
        "epaOverdueCount": len(overdue),
        "enteredEpaCount": len(entered_epa),
    })


def otj_at_risk_summary(request):
    # Keep the established URL for frontend compatibility, but source every
    # OTJH metric from the canonical LMS snapshot.
    from .lms_otjh import lms_otjh_summary

    return lms_otjh_summary(request)


def mcr_summary(request):
    with connections["aptem"].cursor() as cursor:
        cursor.execute("""
            SELECT
                m."ID",
                m."FullName",
                m."Email",
                m."Status",
                m."Subscription Status",
                m."CaseOwner",
                m."Last MCM",
                m."Next MCM",
                m."MCM1", m."Status1",
                m."MCM2", m."Status2",
                m."MCM3", m."Status3",
                m."MCM4", m."Status4",
                m."MCM5", m."Status5",
                m."MCM6", m."Status6",
                m."MCM7", m."Status7",
                m."MCM8", m."Status8",
                m."MCM9", m."Status9",
                m."MCM10", m."Status10",
                m."MCM11", m."Status11",
                m."MCM12", m."Status12",
                m."MCM13", m."Status13",
                m."MCM14", m."Status14",
                m."MCM15", m."Status15",
                m."MCM16", m."Status16",
                m."MCM17", m."Status17",
                m."MCM18", m."Status18",
                m."MCM19", m."Status19",
                m."MCM20", m."Status20",
                m."MCM21", m."Status21",
                m."MCM22", m."Status22",
                m."Last Actually Completed  MCM",
                m."Manager Name",
                m."Manager Email",
                COALESCE(a."Program Name", '') AS "Programme",
                COALESCE(a."OrganizationName", '') AS "OrganisationName"
            FROM public."MCR" m
            LEFT JOIN public.aptem_auto_extracting a
                ON LOWER(TRIM(m."Email")) = LOWER(TRIM(a."Email"))
            WHERE LOWER(COALESCE(m."Status", '')) = 'active'
        """)
        columns = [col[0] for col in cursor.description]
        raw_rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

    today = date.today()
    results = []

    for row in raw_rows:
        overdue_count = 0
        next_mcm_date = None
        latest_due_mcm_date = None
        last_completed_mcm_date = parse_date_safe(
            row.get("Last Actually Completed  MCM") or row.get("Last MCM")
        )
        mcm_dates = []
        mcm_candidates = []

        for i in range(1, 23):
            mcm_date = parse_date_safe(row.get(f"MCM{i}"))
            status_raw = str(row.get(f"Status{i}") or "").strip()
            completed = is_completed_status(status_raw)
            archived = is_archived_status(status_raw)

            if not mcm_date:
                continue

            mcm_dates.append({
                "date": mcm_date.strftime("%Y-%m-%d"),
                "status": status_raw,
                "completed": completed,
            })
            mcm_candidates.append({
                "date": mcm_date,
                "status": status_raw,
                "completed": completed,
                "archived": archived,
            })

            if mcm_date < today and not completed and not archived:
                overdue_count += 1
                if latest_due_mcm_date is None or mcm_date > latest_due_mcm_date:
                    latest_due_mcm_date = mcm_date

            is_after_last_completed = not last_completed_mcm_date or mcm_date > last_completed_mcm_date
            if mcm_date >= today and is_after_last_completed and not completed and not archived:
                if next_mcm_date is None or mcm_date < next_mcm_date:
                    next_mcm_date = mcm_date

        next_mcm_field_date = parse_date_safe(row.get("Next MCM"))
        if next_mcm_field_date and next_mcm_field_date >= today:
            is_after_last_completed = not last_completed_mcm_date or next_mcm_field_date > last_completed_mcm_date
            if is_after_last_completed and (next_mcm_date is None or next_mcm_field_date < next_mcm_date):
                next_mcm_date = next_mcm_field_date

        reference_mcm_date = last_completed_mcm_date or today
        scheduled_window_start = reference_mcm_date + timedelta(weeks=4)
        scheduled_window_end = reference_mcm_date + timedelta(weeks=5)
        scheduled_mcm_candidate = None
        for candidate in mcm_candidates:
            candidate_date = candidate["date"]
            if not (
                is_scheduled_status(candidate["status"])
                and not candidate["completed"]
                and not candidate["archived"]
                and candidate_date >= today
                and scheduled_window_start <= candidate_date <= scheduled_window_end
            ):
                continue
            if scheduled_mcm_candidate is None or candidate_date < scheduled_mcm_candidate["date"]:
                scheduled_mcm_candidate = candidate
        if scheduled_mcm_candidate:
            next_mcm_date = scheduled_mcm_candidate["date"]

        if overdue_count <= 0:
            mcr_status = "Ahead"
        elif overdue_count > 12:
            mcr_status = "Due"
        elif overdue_count > 10:
            mcr_status = "At Risk"
        else:
            mcr_status = "Normal"

        results.append({
            "id": row.get("ID"),
            "fullName": row.get("FullName") or "",
            "email": (row.get("Email") or "").strip().lower(),
            "status": row.get("Status") or "",
            "subscriptionStatus": row.get("Subscription Status") or "",
            "caseOwner": row.get("CaseOwner") or "",
            "lastMcm": row.get("Last MCM") or "",
            "nextMcm": row.get("Next MCM") or "",
            "lastActuallyCompletedMcm": row.get("Last Actually Completed  MCM") or "",
            "overdueMcmCount": overdue_count,
            "dueMcmDate": latest_due_mcm_date.isoformat() if latest_due_mcm_date else None,
            "nextDueDate": next_mcm_date.isoformat() if next_mcm_date else None,
            "mcrStatus": mcr_status,
            "mcmDates": mcm_dates,
            "managerName": row.get("Manager Name") or "",
            "managerEmail": (row.get("Manager Email") or "").strip().lower(),
            "programme": row.get("Programme") or "",
            "organisationName": row.get("OrganisationName") or "",
        })

    return JsonResponse(results, safe=False)


def kbc_attendance_summary(request):
    from collections import defaultdict

    # The original KBC table is still the source of truth for these two legacy
    # groups. All other active delivery moved to the LMS live-session tables at
    # the start of October 2026.
    legacy_modules = (
        "Stephen-Portfolio Management 2026",
        "Steve-Earned Value Management(EVM)2026",
    )
    live_attendance_start = date(2026, 10, 1)
    eligible_programme_statuses = ("active", "delivery")

    # Enrich each attendance learner from their APTEM learner record.
    learner_extras = {}
    try:
        with connections["aptem"].cursor() as cur:
            cur.execute("""
                SELECT
                    "Email",
                    "Learner Phone",
                    "OrganizationName",
                    "Program Name",
                    "OwnerName"
                FROM public.aptem_auto_extracting
            """)
            for row in cur.fetchall():
                em = (row[0] or "").strip().lower()
                if em:
                    learner_extras[em] = {
                        "phone": str(row[1] or "").strip(),
                        "organisation": str(row[2] or "").strip(),
                        "programme": str(row[3] or "").strip(),
                        "owner_name": str(row[4] or "").strip(),
                    }
    except Exception:
        pass

    # Created_users is the source of truth for whether a learner must attend
    # live sessions and whether their programme is currently in delivery.
    eligible_legacy_emails = set()
    if "lms" in settings.DATABASES:
        try:
            with connections["lms"].cursor() as cursor:
                cursor.execute("""
                    SELECT lower(BTRIM("Email"))
                    FROM enrolment."Created_users"
                    WHERE lower(BTRIM(COALESCE("Attendance_type", ''))) = 'not recorded'
                      AND lower(BTRIM(COALESCE("Programme_status", ''))) = ANY(%s)
                      AND NULLIF(BTRIM("Email"), '') IS NOT NULL
                """, [list(eligible_programme_statuses)])
                eligible_legacy_emails = {row[0] for row in cursor.fetchall() if row[0]}
        except Exception:
            eligible_legacy_emails = set()

    attendance_rows = []
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT
                "FullName",
                "Email",
                "date",
                "Attendance",
                "module",
                "key",
                "note"
            FROM public.kbc_attendance
            WHERE "module" = ANY(%s)
              AND lower(BTRIM("Email")) = ANY(%s)
            ORDER BY "Email", "date" ASC
        """, [list(legacy_modules), list(eligible_legacy_emails)])
        columns = [col[0] for col in cursor.description]
        for row in cursor.fetchall():
            legacy = dict(zip(columns, row))
            attendance_rows.append({
                "email": (legacy.get("Email") or "").strip().lower(),
                "full_name": str(legacy.get("FullName") or "").strip(),
                "date": legacy.get("date"),
                "attendance": legacy.get("Attendance"),
                "module": str(legacy.get("module") or "").strip(),
                "key": str(legacy.get("key") or "").strip(),
                "note": str(legacy.get("note") or "").strip(),
                "source": "legacy",
            })

    # Follow the LMS foreign-key chain explicitly:
    # learner_profile_id -> Created_users.learner_id (attendance policy/status)
    # module_catalogue_id -> modules.module_catalogue_id (module identity)
    # live_session_id -> live_sessions.id (meeting definition)
    # occurrence_id -> live_session_occurrences.id (weekly occurrence)
    if "lms" in settings.DATABASES:
        try:
            with connections["lms"].cursor() as cursor:
                cursor.execute("""
                    SELECT
                        attendance.learner_email,
                        attendance.learner_name,
                        occurrence.scheduled_start::date AS session_date,
                        attendance.attendance_status,
                        COALESCE(NULLIF(BTRIM(module.title), ''), session.module_title) AS module_title,
                        session.organizer_email,
                        attendance.learner_profile_id,
                        attendance.module_catalogue_id,
                        attendance.live_session_id,
                        attendance.occurrence_id
                    FROM curriculum.live_session_learner_attendance AS attendance
                    INNER JOIN enrolment."Created_users" AS learner
                        ON learner.learner_id = attendance.learner_profile_id
                    INNER JOIN curriculum.modules AS module
                        ON module.module_catalogue_id = attendance.module_catalogue_id
                    INNER JOIN curriculum.live_sessions AS session
                        ON session.id = attendance.live_session_id
                       AND session.module_catalogue_id = attendance.module_catalogue_id
                    INNER JOIN curriculum.live_session_occurrences AS occurrence
                        ON occurrence.id = attendance.occurrence_id
                       AND occurrence.live_session_id = attendance.live_session_id
                    WHERE occurrence.status = 'completed'
                      AND occurrence.scheduled_start::date >= %s
                      AND occurrence.scheduled_start::date <= %s
                      AND lower(BTRIM(COALESCE(learner."Attendance_type", ''))) = 'not recorded'
                      AND lower(BTRIM(COALESCE(learner."Programme_status", ''))) = ANY(%s)
                    ORDER BY attendance.learner_email, occurrence.scheduled_start ASC
                """, [
                    live_attendance_start,
                    timezone.localdate(),
                    list(eligible_programme_statuses),
                ])
                for (
                    email,
                    full_name,
                    session_date,
                    status,
                    module_title,
                    organizer_email,
                    learner_profile_id,
                    module_catalogue_id,
                    live_session_id,
                    occurrence_id,
                ) in cursor.fetchall():
                    normalized_status = str(status or "").strip().lower()
                    attendance_rows.append({
                        "email": str(email or "").strip().lower(),
                        "full_name": str(full_name or "").strip(),
                        "date": session_date,
                        "attendance": 0 if normalized_status == "absent" else 1 if normalized_status == "present" else None,
                        "module": str(module_title or "").strip(),
                        "key": "",
                        "note": "",
                        "source": "live",
                        "organizer_email": str(organizer_email or "").strip(),
                        "learner_profile_id": learner_profile_id,
                        "module_catalogue_id": str(module_catalogue_id or "").strip(),
                        "live_session_id": str(live_session_id or "").strip(),
                        "occurrence_id": str(occurrence_id or "").strip(),
                    })
        except Exception:
            # The legacy groups must continue to load if the LMS database is
            # temporarily unavailable.
            pass

    def _normalized_name(value):
        return re.sub(r"\s+", " ", str(value or "").strip()).lower()

    grouped = defaultdict(lambda: {
        "fullName": "",
        "records": [],
        "emails": [],
        "latest_email": "",
        "latest_date": None,
        "organizer_email": "",
    })
    email_to_identity = {}
    name_to_identities = defaultdict(set)

    for row in attendance_rows:
        email = row["email"]
        if not email:
            continue
        full_name = _normalized_name(row["full_name"])
        identity = email_to_identity.get(email)
        if not identity and full_name and len(name_to_identities[full_name]) == 1:
            identity = next(iter(name_to_identities[full_name]))
        if not identity:
            identity = f"email:{email}"

        email_to_identity[email] = identity
        if full_name:
            name_to_identities[full_name].add(identity)
        group = grouped[identity]
        row_date = row["date"]
        if row["full_name"]:
            group["fullName"] = row["full_name"] or group["fullName"]
        if email not in group["emails"]:
            group["emails"].append(email)
        if row_date and (group["latest_date"] is None or row_date >= group["latest_date"]):
            group["latest_date"] = row_date
            group["latest_email"] = email
        if row.get("organizer_email"):
            group["organizer_email"] = row["organizer_email"]
        group["records"].append({
            "date": row_date.isoformat() if row_date else None,
            "attendance": row["attendance"],
            "module": row["module"],
            "key": row["key"],
            "email": email,
            "note": row["note"],
            "source": row["source"],
            "learnerProfileId": row.get("learner_profile_id"),
            "moduleCatalogueId": row.get("module_catalogue_id", ""),
            "liveSessionId": row.get("live_session_id", ""),
            "occurrenceId": row.get("occurrence_id", ""),
        })

    results = []
    for data in grouped.values():
        if not data["records"]:
            continue
        emails = data["emails"]
        latest_email = data["latest_email"] or (emails[0] if emails else "")
        email_with_extras = next((em for em in emails if em in learner_extras), "")
        email = latest_email if latest_email in learner_extras else email_with_extras or latest_email
        extras = learner_extras.get(email, {})
        results.append({
            "email": email,
            "emails": emails,
            "fullName": data["fullName"],
            "phone": extras.get("phone", ""),
            "organisation": extras.get("organisation", ""),
            "aptemProgramme": extras.get("programme", ""),
            "ownerName": extras.get("owner_name", "") or data["organizer_email"],
            "records": sorted(data["records"], key=lambda record: record.get("date") or ""),
        })

    return JsonResponse(results, safe=False)


def _quote_pg_identifier(name):
    return '"' + str(name).replace('"', '""') + '"'


def _learner_evidence_table_info(alias):
    with connections[alias].cursor() as cursor:
        cursor.execute("""
            SELECT table_schema
            FROM information_schema.tables
            WHERE table_name = %s
              AND table_type = %s
            ORDER BY CASE WHEN table_schema = %s THEN 0 ELSE 1 END, table_schema
            LIMIT 1
        """, ["learner_evidence", "BASE TABLE", "public"])
        table_schema_row = cursor.fetchone()
        if not table_schema_row:
            return "", []

        table_schema = table_schema_row[0]
        cursor.execute("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = %s
              AND table_name = %s
            ORDER BY ordinal_position
        """, [table_schema, "learner_evidence"])
        return table_schema, [row[0] for row in cursor.fetchall()]


def _assignment_rows_from_learner_evidence(active_learners_by_id):
    alias = "learner_evidence" if "learner_evidence" in settings.DATABASES else ""
    if not alias:
        return []

    active_ids = [learner_id for learner_id in active_learners_by_id.keys() if learner_id]
    if not active_ids:
        return []

    try:
        table_schema, columns = _learner_evidence_table_info(alias)
        if not table_schema or "evidence" not in columns or "learner_id" not in columns:
            return []

        table_sql = f"{_quote_pg_identifier(table_schema)}.{_quote_pg_identifier('learner_evidence')}"
        row_order_sql = "fetched_at DESC NULLS LAST" if "fetched_at" in columns else "id DESC" if "id" in columns else "learner_id"
        full_name_sql = _quote_pg_identifier("full_name") if "full_name" in columns else "''"
        program_name_sql = _quote_pg_identifier("program_name") if "program_name" in columns else "''"

        with connections[alias].cursor() as cursor:
            cursor.execute(
                f"""
                    WITH latest_rows AS (
                        SELECT DISTINCT ON (learner_id::text)
                            learner_id::text AS learner_id,
                            {full_name_sql} AS full_name,
                            {program_name_sql} AS program_name,
                            evidence::jsonb AS evidence
                        FROM {table_sql}
                        WHERE learner_id::text = ANY(%s)
                        ORDER BY learner_id::text, {row_order_sql}
                    ),
                    evidence_items AS (
                        SELECT
                            latest_rows.learner_id,
                            latest_rows.full_name,
                            latest_rows.program_name,
                            item.value AS evidence_item,
                            LOWER(COALESCE(
                                item.value->>'kind',
                                item.value->>'type',
                                item.value->>'EvidenceKind',
                                item.value->'raw'->>'EvidenceKind',
                                ''
                            )) AS evidence_kind,
                            LOWER(COALESCE(
                                item.value->>'status',
                                item.value->>'LatestStatus',
                                item.value->>'ConfirmedStatus',
                                item.value->'raw'->>'LatestStatus',
                                item.value->'raw'->>'ConfirmedStatus',
                                ''
                            )) AS evidence_status,
                            COALESCE(
                                item.value->'raw'->>'SubmissionDate',
                                item.value->>'SubmissionDate',
                                item.value->>'submissionDate',
                                item.value->>'submission_date',
                                item.value->>'submittedAt',
                                item.value->>'submitted_at',
                                item.value->>'created_date',
                                item.value->>'createdDate',
                                item.value->'raw'->>'UpdatedDate',
                                item.value->>'UpdatedDate'
                            ) AS submission_text
                        FROM latest_rows
                        LEFT JOIN LATERAL jsonb_array_elements(
                            CASE
                                WHEN jsonb_typeof(latest_rows.evidence) = 'array' THEN latest_rows.evidence
                                ELSE '[]'::jsonb
                            END
                        ) AS item(value) ON TRUE
                    ),
                    parsed_items AS (
                        SELECT
                            learner_id,
                            full_name,
                            program_name,
                            evidence_kind,
                            evidence_status,
                            CASE
                                WHEN submission_text ~ '^\\d{{4}}-\\d{{2}}-\\d{{2}}'
                                THEN submission_text::timestamptz
                                ELSE NULL
                            END AS submitted_at
                        FROM evidence_items
                    )
                    SELECT
                        learner_id,
                        full_name,
                        program_name,
                        COUNT(*) FILTER (
                            WHERE evidence_kind = 'file'
                        ) AS total_file_count,
                        COUNT(*) FILTER (
                            WHERE evidence_kind = 'file'
                              AND evidence_status = 'pendingassessment'
                        ) AS pending_count,
                        COUNT(*) FILTER (
                            WHERE evidence_kind = 'file'
                              AND evidence_status = 'accepted'
                        ) AS accepted_count,
                        COUNT(*) FILTER (
                            WHERE evidence_kind = 'file'
                              AND evidence_status = 'referred'
                        ) AS referred_count,
                        MAX(submitted_at) FILTER (WHERE evidence_kind = 'file') AS latest_submit
                    FROM parsed_items
                    GROUP BY learner_id, full_name, program_name
                """,
                [active_ids],
            )
            query_columns = [col[0] for col in cursor.description]
            raw_rows = [dict(zip(query_columns, row)) for row in cursor.fetchall()]
    except Exception:
        return []

    by_learner = {}
    for row in raw_rows:
        learner_id = str(row.get("learner_id") or "").strip()
        if not learner_id or learner_id in by_learner:
            continue

        learner = active_learners_by_id.get(learner_id, {})
        latest_submit = row.get("latest_submit")
        latest_submit_value = latest_submit.date().isoformat() if latest_submit else ""
        by_learner[learner_id] = {
            "learnerId": learner_id,
            "fullName": learner.get("fullName") or row.get("full_name") or "",
            "email": learner.get("email") or "",
            "caseOwner": learner.get("caseOwner") or "",
            "caseOwnerId": learner.get("caseOwnerId"),
            "countEvidencePending": int(row.get("pending_count") or 0),
            "evidenceAccepted": int(row.get("accepted_count") or 0),
            "evidenceReferred": int(row.get("referred_count") or 0),
            "totalEvidence": int(row.get("total_file_count") or 0),
            "lastSubDate": latest_submit_value,
            "lastFileSubmitDate": latest_submit_value,
            "status": "Active",
        }

    return list(by_learner.values())


def require_marking_summary(request):
    active_learners_by_id = {}
    with connections["aptem"].cursor() as cursor:
        cursor.execute("""
            SELECT
                "ID",
                "FullName",
                "Email",
                "OwnerName",
                "OwnerEmail",
                "case_owner_id",
                "Program-Status"
            FROM public.aptem_auto_extracting
            WHERE LOWER(COALESCE("Program-Status", '')) = 'active'
        """)
        columns = [col[0] for col in cursor.description]
        for row in [dict(zip(columns, row)) for row in cursor.fetchall()]:
            learner_id = str(row.get("ID") or "").strip()
            if not learner_id:
                continue
            active_learners_by_id[learner_id] = {
                "fullName": row.get("FullName") or "",
                "email": (row.get("Email") or "").strip().lower(),
                "caseOwner": row.get("OwnerName") or "",
                "ownerEmail": (row.get("OwnerEmail") or "").strip().lower(),
                "caseOwnerId": row.get("case_owner_id"),
            }

    results = _assignment_rows_from_learner_evidence(active_learners_by_id)

    return JsonResponse(results, safe=False)


def lms_activity_summary(request):
    from .lms_otjh import load_lms_otjh_by_email

    active_learners_by_email = {
        email: {
            "learnerId": learner.get("id"),
            "fullName": learner.get("fullName") or "",
            "email": email,
            "caseOwner": learner.get("ownerName") or learner.get("coach") or "",
        }
        for email, learner in load_lms_otjh_by_email().items()
    }

    if not active_learners_by_email or "learner_evidence" not in settings.DATABASES:
        return JsonResponse({"error": "LMS activity database is not configured."}, status=503)

    active_emails = list(active_learners_by_email.keys())
    try:
        with connections["learner_evidence"].cursor() as cursor:
            cursor.execute("""
                SELECT table_schema
                FROM information_schema.tables
                WHERE table_name = %s
                  AND table_type = %s
                ORDER BY CASE WHEN table_schema = %s THEN 0 ELSE 1 END, table_schema
                LIMIT 1
            """, ["LMS_data", "BASE TABLE", "Audit"])
            schema_row = cursor.fetchone()
            if not schema_row:
                return JsonResponse({"error": "LMS activity table is unavailable."}, status=502)

            table_sql = f"{_quote_pg_identifier(schema_row[0])}.{_quote_pg_identifier('LMS_data')}"
            cursor.execute(
                f"""
                    WITH progress_rows AS (
                        SELECT
                            LOWER(TRIM(data::jsonb->>'email')) AS email,
                            data::jsonb AS data
                        FROM {table_sql}
                        WHERE LOWER(TRIM(data::jsonb->>'email')) = ANY(%s)
                    ),
                    completed_values AS (
                        SELECT
                            email,
                            NULLIF(TRIM(data->>'course_completed_at'), '') AS completed_text
                        FROM progress_rows
                        UNION ALL
                        SELECT
                            email,
                            NULLIF(TRIM(value #>> '{{}}'), '') AS completed_text
                        FROM progress_rows
                        CROSS JOIN LATERAL jsonb_path_query(data, '$.**.completed_at') AS completed(value)
                    ),
                    parsed_values AS (
                        SELECT
                            email,
                            CASE
                                WHEN completed_text ~ '^\\d{{4}}-\\d{{2}}-\\d{{2}}[ T]\\d{{2}}:\\d{{2}}'
                                THEN completed_text::timestamptz
                                WHEN completed_text ~ '^\\d{{4}}-\\d{{2}}-\\d{{2}}$'
                                THEN completed_text::date::timestamptz
                                ELSE NULL
                            END AS completed_at
                        FROM completed_values
                    )
                    SELECT email, MAX(completed_at) AS last_activity
                    FROM parsed_values
                    WHERE completed_at IS NOT NULL
                    GROUP BY email
                """,
                [active_emails],
            )
            rows = cursor.fetchall()
    except Exception as exc:
        return JsonResponse({
            "error": "Could not load LMS activity data.",
            "detail": str(exc) if settings.DEBUG else "",
        }, status=502)

    latest_by_email = {email: last_activity for email, last_activity in rows if email}
    results = []
    for email, learner in active_learners_by_email.items():
        last_activity = latest_by_email.get(email)
        results.append({
            **learner,
            "lastActivity": last_activity.date().isoformat() if last_activity else "",
        })

    return JsonResponse(results, safe=False)


@csrf_exempt
def dashboard_bookings(request):
    from .models import DashboardBooking

    if request.method == 'GET':
        bookings = DashboardBooking.objects.all().values(
            'id', 'learner_email', 'learner_name', 'coach',
            'session_type', 'booking_date', 'booking_time',
            'notes', 'booking_url', 'created_at',
        )
        result = [
            {
                'id': b['id'],
                'learnerEmail': b['learner_email'],
                'learnerName': b['learner_name'],
                'coach': b['coach'],
                'sessionType': b['session_type'],
                'date': b['booking_date'].isoformat(),
                'time': b['booking_time'].strftime('%H:%M'),
                'notes': b['notes'],
                'bookingUrl': b['booking_url'],
                'createdAt': b['created_at'].isoformat(),
            }
            for b in bookings
        ]
        return JsonResponse(result, safe=False)

    elif request.method == 'POST':
        data = json.loads(request.body)
        booking = DashboardBooking.objects.create(
            learner_email=data.get('learnerEmail', ''),
            learner_name=data.get('learnerName', ''),
            coach=data.get('coach', ''),
            session_type=data.get('sessionType', ''),
            booking_date=data.get('date'),
            booking_time=data.get('time'),
            notes=data.get('notes', ''),
            booking_url=data.get('bookingUrl', ''),
        )
        return JsonResponse({'id': booking.id}, status=201)

    elif request.method == 'PATCH':
        booking_id = request.GET.get('id')
        data = json.loads(request.body)
        updated = DashboardBooking.objects.filter(id=booking_id).first()
        if not updated:
            return JsonResponse({'error': 'Not found'}, status=404)
        if 'date' in data:
            updated.booking_date = data['date']
        if 'time' in data:
            updated.booking_time = data['time']
        if 'notes' in data:
            updated.notes = data['notes']
        updated.save()
        return JsonResponse({'success': True})

    elif request.method == 'DELETE':
        booking_id = request.GET.get('id')
        DashboardBooking.objects.filter(id=booking_id).delete()
        return JsonResponse({'success': True})

    return JsonResponse({'error': 'Method not allowed'}, status=405)


@csrf_exempt
def dashboard_contact_log(request):
    from .models import DashboardContactLog

    if request.method == 'GET':
        email = request.GET.get('email', '').strip().lower()
        qs = DashboardContactLog.objects.all()
        if email:
            qs = qs.filter(learner_email__iexact=email)
        result = [
            {
                'id': log.id,
                'learnerEmail': log.learner_email,
                'learnerName': log.learner_name,
                'coach': log.coach,
                'actionType': log.action_type,
                'outcome': log.outcome,
                'notes': log.notes,
                'source': log.source,
                'createdAt': log.created_at.isoformat(),
            }
            for log in qs.order_by('-created_at')[:200]
        ]
        return JsonResponse(result, safe=False)

    if request.method == 'POST':
        data = json.loads(request.body)
        log = DashboardContactLog.objects.create(
            learner_email=(data.get('learnerEmail') or '').strip().lower(),
            learner_name=data.get('learnerName') or '',
            coach=data.get('coach') or '',
            action_type=data.get('actionType') or 'called',
            outcome=data.get('outcome') or '',
            notes=data.get('notes') or '',
            source=data.get('source') or 'attendance',
        )
        return JsonResponse({'id': log.id}, status=201)

    return JsonResponse({'error': 'Method not allowed'}, status=405)


def _coaches_data_value(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        stripped = value.strip()
        if stripped and stripped[0] in "[{":
            try:
                return json.loads(stripped)
            except Exception:
                return value
    return value


def fetch_all_coaches_analytics(request):
    """
    Fetch coach analytics directly from public.coaches_data.
    This replaces the old external KBC API integration.
    """
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT * FROM public."coaches_data"')
            columns = [col[0] for col in cursor.description]
            rows = []
            for raw in cursor.fetchall():
                item = {
                    column: _coaches_data_value(value)
                    for column, value in zip(columns, raw)
                }
                phones = [
                    str(item.get("owner_phone") or "").strip(),
                    str(item.get("phone number") or "").strip(),
                ]
                item["phone_numbers"] = [
                    phone for phone in phones
                    if phone and phone.lower() not in {"empty", "null", "none"}
                ]
                rows.append(item)

        return JsonResponse(rows, safe=False)

    except Exception as e:
        return JsonResponse({"error": f"Failed to load coaches_data: {str(e)}"}, status=500)


# ─────────────────── Attendance Ticket System ───────────────────

def _ticket_to_dict(ticket):
    from .models import AttendanceTicket
    evidence_count = (
        ticket.evidence_file_count
        if hasattr(ticket, "evidence_file_count")
        else ticket.evidence_files.count()
    )
    return {
        "id": ticket.pk,
        "ticketRef": ticket.ticket_ref,
        "learnerEmail": ticket.learner_email,
        "learnerName": ticket.learner_name,
        "learnerPhone": ticket.learner_phone,
        "organisation": ticket.organisation,
        "programme": ticket.programme,
        "attendanceDate": ticket.attendance_date.isoformat() if ticket.attendance_date else None,
        "attendanceModule": ticket.attendance_module,
        "risk": ticket.risk,
        "status": ticket.status,
        "assignedOwner": ticket.assigned_owner,
        "action": ticket.action,
        "notes": ticket.notes,
        "evidence": ticket.evidence,
        "isArchived": ticket.is_archived,
        "escalated": ticket.escalated,
        "createdBy": ticket.created_by,
        "createdAt": ticket.created_at.isoformat(),
        "updatedAt": ticket.updated_at.isoformat(),
        "evidenceCount": evidence_count,
    }


def _normalize_attendance_value(value):
    if value is True or value == 1:
        return 1
    if value is False or value == 0:
        return 0
    normalized = str(value or "").strip().lower()
    if normalized in {"1", "present", "attended", "yes", "true"}:
        return 1
    if normalized in {"0", "absent", "missed", "no", "false"}:
        return 0
    return None


def _attendance_ticket_risk(missed_count):
    try:
        count = int(missed_count or 0)
    except Exception:
        count = 0
    return "red" if count >= 3 else "amber"


def _attendance_missed_dates(email_module_pairs):
    pairs = {
        (str(email or "").strip().lower(), str(module or "").strip())
        for email, module in email_module_pairs
        if str(email or "").strip()
    }
    if not pairs:
        return {}

    emails = list({email for email, _module in pairs})
    placeholders = ",".join(["%s"] * len(emails))
    with connection.cursor() as cur:
        cur.execute(
            f"""
            SELECT "Email", "module", "date", "Attendance"
            FROM public.kbc_attendance
            WHERE lower("Email") IN ({placeholders})
            """,
            emails,
        )

        seen = {}
        for email, module, attendance_date, attendance_value in cur.fetchall():
            clean_email = str(email or "").strip().lower()
            clean_module = str(module or "").strip()
            key = (clean_email, clean_module, str(attendance_date))
            is_missed = _normalize_attendance_value(attendance_value) == 0
            seen[key] = seen.get(key, False) or is_missed

    missed_dates = {}
    for (email, module, _attendance_date), is_missed in seen.items():
        pair = (email, module)
        if is_missed and pair in pairs:
            missed_dates.setdefault(pair, set()).add(_attendance_date)
    return {
        pair: sorted(dates)
        for pair, dates in missed_dates.items()
    }


def _attendance_missed_counts(email_module_pairs):
    return {
        pair: len(dates)
        for pair, dates in _attendance_missed_dates(email_module_pairs).items()
    }


def _attendance_missed_count_until(email, module, attendance_date):
    email = str(email or "").strip().lower()
    module = str(module or "").strip()
    if not email or not module or not attendance_date:
        return _attendance_missed_count(email, module)

    date_key = attendance_date.isoformat() if hasattr(attendance_date, "isoformat") else str(attendance_date)
    dates = _attendance_missed_dates({(email, module)}).get((email, module), [])
    return sum(1 for missed_date in dates if missed_date <= date_key)


def _attendance_missed_count(email, module):
    email = str(email or "").strip().lower()
    module = str(module or "").strip()
    return _attendance_missed_counts({(email, module)}).get((email, module), 0)


def _sync_attendance_ticket_risks(tickets):
    tickets = list(tickets)
    legacy_modules = {
        "Stephen-Portfolio Management 2026",
        "Steve-Earned Value Management(EVM)2026",
    }
    missed_dates = _attendance_missed_dates(
        {
            (ticket.learner_email, ticket.attendance_module)
            for ticket in tickets
            if not (
                ticket.attendance_date
                and ticket.attendance_date >= date(2026, 10, 1)
                and ticket.attendance_module not in legacy_modules
            )
        }
    )

    to_update = []
    for ticket in tickets:
        # Live-session records are read from the LMS tables. Their risk was
        # calculated when the ticket was created, so do not overwrite it with
        # the legacy KBC-only query below.
        if (
            ticket.attendance_date
            and ticket.attendance_date >= date(2026, 10, 1)
            and ticket.attendance_module not in legacy_modules
        ):
            continue
        key = (
            str(ticket.learner_email or "").strip().lower(),
            str(ticket.attendance_module or "").strip(),
        )
        attendance_date = ticket.attendance_date.isoformat() if ticket.attendance_date else ""
        dates = missed_dates.get(key, [])
        missed_count = (
            sum(1 for missed_date in dates if missed_date <= attendance_date)
            if attendance_date
            else len(dates)
        )
        new_risk = _attendance_ticket_risk(missed_count)
        if ticket.risk != new_risk:
            ticket.risk = new_risk
            to_update.append(ticket)

    if to_update:
        from .models import AttendanceTicket
        AttendanceTicket.objects.bulk_update(to_update, ["risk"])
    return len(to_update)


def _attendance_missing_learners_for_week(week_start, week_end):
    """Return ticket-ready absences from the consolidated attendance sources."""
    from django.test import RequestFactory

    response = kbc_attendance_summary(
        RequestFactory().get("/api/kbc-attendance/")
    )
    if response.status_code != 200:
        return []

    learners = []
    for source_row in json.loads(response.content.decode("utf-8")):
        email = str(source_row.get("email") or "").strip().lower()
        if not email:
            continue

        def is_trackable(record):
            raw_date = record.get("date")
            module = str(record.get("module") or "").strip()
            note = str(record.get("note") or "").lower()
            if not raw_date or not module or "recorded sessions" in module.lower():
                return False
            if "attended with another instructor" in note:
                return False
            try:
                record_date = date.fromisoformat(str(raw_date))
            except (TypeError, ValueError):
                return False
            return week_start <= record_date <= week_end

        week_records = [
            record for record in source_row.get("records", []) if is_trackable(record)
        ]
        if not week_records:
            continue

        latest = max(week_records, key=lambda record: str(record.get("date") or ""))
        if _normalize_attendance_value(latest.get("attendance")) != 0:
            continue

        attendance_date = str(latest.get("date") or "")
        attendance_module = str(latest.get("module") or "").strip()
        missed_count = sum(
            1
            for record in source_row.get("records", [])
            if str(record.get("module") or "").strip() == attendance_module
            and str(record.get("date") or "") <= attendance_date
            and _normalize_attendance_value(record.get("attendance")) == 0
        )
        learners.append({
            "email": email,
            "name": str(source_row.get("fullName") or "Unknown").strip(),
            "phone": str(source_row.get("phone") or "").strip(),
            "organisation": str(source_row.get("organisation") or "").strip(),
            "programme": str(source_row.get("aptemProgramme") or attendance_module).strip(),
            "attendance_date": attendance_date,
            "attendance_module": attendance_module,
            "missed_count": missed_count or 1,
        })
    return learners


def _legacy_attendance_missing_learners_for_week(week_start, week_end):
    """Build the same missed-learner payload the Track Attendance page used to send."""
    learner_extras = {}
    try:
        with connections["aptem"].cursor() as cur:
            cur.execute("""
                SELECT
                    "Email",
                    "Learner Phone",
                    "OrganizationName",
                    "Program Name",
                    "OwnerName"
                FROM public.aptem_auto_extracting
            """)
            for row in cur.fetchall():
                email = str(row[0] or "").strip().lower()
                if email:
                    learner_extras[email] = {
                        "phone": str(row[1] or "").strip(),
                        "organisation": str(row[2] or "").strip(),
                        "programme": str(row[3] or "").strip(),
                        "owner_name": str(row[4] or "").strip(),
                    }
    except Exception:
        pass

    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT
                "FullName",
                "Email",
                "date",
                "Attendance",
                "module"
            FROM public.kbc_attendance
            WHERE "date" >= %s AND "date" <= %s
            ORDER BY "Email", "date" ASC
        """, [week_start, week_end])
        rows = cursor.fetchall()

    latest_by_email = {}
    for full_name, email, attendance_date, attendance_value, module in rows:
        clean_email = str(email or "").strip().lower()
        if not clean_email or not attendance_date:
            continue
        latest_by_email[clean_email] = {
            "email": clean_email,
            "name": str(full_name or "").strip(),
            "attendance_date": attendance_date.isoformat(),
            "attendance_module": str(module or "").strip(),
            "attendance": attendance_value,
        }

    learners = []
    for email, learner in latest_by_email.items():
        if _normalize_attendance_value(learner.get("attendance")) != 0:
            continue
        extras = learner_extras.get(email, {})
        learners.append({
            "email": email,
            "name": learner.get("name") or "Unknown",
            "phone": extras.get("phone", ""),
            "organisation": extras.get("organisation", ""),
            "programme": extras.get("programme", ""),
            "attendance_date": learner.get("attendance_date"),
            "attendance_module": learner.get("attendance_module", ""),
        })

    # Compute missed-session counts per (email, module) across ALL history
    if learners:
        absent_emails = list({l["email"] for l in learners})
        placeholders = ",".join(["%s"] * len(absent_emails))
        with connection.cursor() as cur:
            cur.execute(
                f"""
                SELECT "Email", "module", "date", "Attendance"
                FROM public.kbc_attendance
                WHERE lower("Email") IN ({placeholders})
                """,
                absent_emails,
            )
            # Deduplicate by (email, module, date) — same logic as frontend tooltip
            seen = {}  # (email, module, date) → is_missed
            for em, mod, dt, att in cur.fetchall():
                clean_email = str(em or "").strip().lower()
                clean_mod = str(mod or "").strip()
                key = (clean_email, clean_mod, str(dt))
                is_missed = _normalize_attendance_value(att) == 0
                seen[key] = seen.get(key, False) or is_missed

        missed_dates = {}
        for (em, mod, _dt), is_missed in seen.items():
            if is_missed:
                missed_dates.setdefault((em, mod), set()).add(_dt)

        for learner in learners:
            key = (learner["email"], learner["attendance_module"])
            attendance_date = str(learner.get("attendance_date") or "")
            learner_dates = sorted(missed_dates.get(key, set()))
            learner["missed_count"] = (
                sum(1 for missed_date in learner_dates if missed_date <= attendance_date)
                if attendance_date
                else len(learner_dates)
            ) or 1

    return learners


def _upsert_auto_attendance_tickets(learners):
    """Create only tickets that are not already active for the same absence."""
    from .models import AttendanceTicket

    created_list = []
    existing_list = []
    candidate_keys = []
    for learner in learners:
        email = str(learner.get("email") or "").strip().lower()
        try:
            attendance_date = date.fromisoformat(
                str(learner.get("attendance_date") or "")
            )
        except (TypeError, ValueError):
            continue
        if email:
            candidate_keys.append((email, attendance_date))

    existing_by_key = {
        (ticket.learner_email, ticket.attendance_date): ticket
        for ticket in AttendanceTicket.objects.filter(
            is_archived=False,
            learner_email__in=list({email for email, _ in candidate_keys}),
            attendance_date__in=list({attendance_date for _, attendance_date in candidate_keys}),
        )
    } if candidate_keys else {}

    for learner in learners:
        email = str(learner.get("email") or "").strip().lower()
        if not email:
            continue

        try:
            attendance_date = date.fromisoformat(
                str(learner.get("attendance_date") or "")
            )
        except (TypeError, ValueError):
            continue

        missed_count = int(learner.get("missed_count") or 1)
        risk = _attendance_ticket_risk(missed_count)
        ticket = existing_by_key.get((email, attendance_date))

        if ticket:
            if ticket.risk != risk:
                ticket.risk = risk
                ticket.save(update_fields=["risk", "updated_at"])
            existing_list.append({
                "email": email,
                "id": ticket.pk,
                "ticketRef": ticket.ticket_ref,
                "status": ticket.status,
                "created": False,
            })
            continue

        ticket = AttendanceTicket.objects.create(
            ticket_ref="ATT-TMP",
            learner_email=email,
            learner_name=str(learner.get("name") or "").strip(),
            learner_phone=str(learner.get("phone") or "").strip(),
            organisation=str(learner.get("organisation") or "").strip(),
            programme=str(learner.get("programme") or "").strip(),
            attendance_date=attendance_date,
            attendance_module=str(learner.get("attendance_module") or "").strip(),
            risk=risk,
            status="new",
            assigned_owner="",
            action="no_action",
            notes="",
            evidence="",
            created_by="Auto",
        )
        ticket.ticket_ref = f"ATT-{ticket.pk:03d}"
        ticket.save(update_fields=["ticket_ref"])
        existing_by_key[(email, attendance_date)] = ticket
        created_list.append({
            "email": email,
            "id": ticket.pk,
            "ticketRef": ticket.ticket_ref,
            "status": ticket.status,
            "created": True,
        })

    return created_list, existing_list


def _archive_stale_auto_attendance_tickets(week_start, week_end, learners):
    """Archive auto tickets that no longer belong to the eligible attendance set."""
    from .models import AttendanceTicket

    valid_keys = set()
    for learner in learners:
        email = str(learner.get("email") or "").strip().lower()
        try:
            attendance_date = date.fromisoformat(str(learner.get("attendance_date") or ""))
        except (TypeError, ValueError):
            continue
        if email:
            valid_keys.add((email, attendance_date))

    stale = []
    for ticket in AttendanceTicket.objects.filter(
        is_archived=False,
        created_by="Auto",
        attendance_date__gte=week_start,
        attendance_date__lte=week_end,
    ):
        key = (str(ticket.learner_email or "").strip().lower(), ticket.attendance_date)
        if key not in valid_keys:
            ticket.is_archived = True
            ticket.updated_at = timezone.now()
            stale.append(ticket)

    if stale:
        AttendanceTicket.objects.bulk_update(stale, ["is_archived", "updated_at"])
    return len(stale)


@csrf_exempt
def auto_create_attendance_tickets(request):
    """Auto-create tickets for absent learners in a given week if no ticket exists yet."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    body = _json_body(request)
    try:
        week_start = date.fromisoformat(str(body.get("week_start") or ""))
        week_end = date.fromisoformat(str(body.get("week_end") or ""))
    except (TypeError, ValueError):
        return JsonResponse({"error": "week_start and week_end must be YYYY-MM-DD"}, status=400)

    if week_end < week_start:
        return JsonResponse({"error": "week_end must not be before week_start"}, status=400)

    # Attendance tickets must always use the server-side merge of the LMS live
    # tables and the two approved legacy KBC groups. The client payload is only
    # a UI hint and can be stale when the page has been open for a while.
    learners = _attendance_missing_learners_for_week(week_start, week_end)
    archived = _archive_stale_auto_attendance_tickets(week_start, week_end, learners)
    created_list, existing_list = _upsert_auto_attendance_tickets(learners)

    return JsonResponse({
        "created": len(created_list),
        "existing": len(existing_list),
        "archived": archived,
        "tickets": created_list + existing_list,
    })


@csrf_exempt
def attendance_tickets(request):
    from django.db.models import Count
    from .models import AttendanceTicket

    if request.method == "GET":
        show_archived = request.GET.get("archived", "false").lower() == "true"
        lookup_only = request.GET.get("lookup", "false").lower() == "true"
        tickets = AttendanceTicket.objects.filter(is_archived=show_archived).annotate(
            evidence_file_count=Count("evidence_files")
        )
        if lookup_only:
            rows = tickets.values(
                "id",
                "ticket_ref",
                "learner_email",
                "attendance_date",
                "status",
            )
            return JsonResponse([
                {
                    "id": row["id"],
                    "ticketRef": row["ticket_ref"],
                    "learnerEmail": row["learner_email"],
                    "attendanceDate": row["attendance_date"].isoformat() if row["attendance_date"] else None,
                    "status": row["status"],
                }
                for row in rows
            ], safe=False)

        return JsonResponse([_ticket_to_dict(t) for t in tickets], safe=False)

    if request.method == "POST":
        body = _json_body(request)
        if not body.get("learner_email") or not body.get("learner_name"):
            return JsonResponse({"error": "learner_email and learner_name are required"}, status=400)

        att_date = None
        raw_date = body.get("attendance_date")
        if raw_date:
            try:
                att_date = date.fromisoformat(str(raw_date))
            except Exception:
                pass

        attendance_module = str(body.get("attendance_module", "")).strip()
        risk = _attendance_ticket_risk(
            _attendance_missed_count_until(
                str(body.get("learner_email", "")).strip().lower(),
                attendance_module,
                att_date,
            )
        )

        ticket = AttendanceTicket.objects.create(
            ticket_ref="ATT-TMP",
            learner_email=str(body.get("learner_email", "")).strip().lower(),
            learner_name=str(body.get("learner_name", "")).strip(),
            learner_phone=str(body.get("learner_phone", "")).strip(),
            organisation=str(body.get("organisation", "")).strip(),
            programme=str(body.get("programme", "")).strip(),
            attendance_date=att_date,
            attendance_module=attendance_module,
            risk=risk,
            status=str(body.get("status", "new")).strip(),
            assigned_owner=str(body.get("assigned_owner", "")).strip(),
            action=str(body.get("action", "")).strip(),
            notes=str(body.get("notes", "")).strip(),
            evidence=str(body.get("evidence", "")).strip(),
            escalated=bool(body.get("escalated", False)),
            created_by=str(body.get("created_by", "System")).strip(),
        )
        ticket.ticket_ref = f"ATT-{ticket.pk:03d}"
        ticket.save(update_fields=["ticket_ref"])
        return JsonResponse(_ticket_to_dict(ticket), status=201)

    return JsonResponse({"error": "Method not allowed"}, status=405)


@csrf_exempt
def attendance_ticket_detail(request, pk):
    from .models import AttendanceTicket

    try:
        ticket = AttendanceTicket.objects.get(pk=pk)
    except AttendanceTicket.DoesNotExist:
        return JsonResponse({"error": "Ticket not found"}, status=404)

    if request.method == "GET":
        return JsonResponse(_ticket_to_dict(ticket))

    if request.method == "PATCH":
        body = _json_body(request)
        fields = ["learner_name", "learner_phone", "organisation", "programme",
                  "attendance_module", "risk", "status", "assigned_owner", "action", "notes", "evidence"]
        for f in fields:
            if f in body:
                setattr(ticket, f, str(body[f]).strip())
        if "escalated" in body:
            ticket.escalated = bool(body["escalated"])
        if "attendance_date" in body:
            raw = body["attendance_date"]
            if raw:
                try:
                    ticket.attendance_date = date.fromisoformat(str(raw))
                except Exception:
                    pass
            else:
                ticket.attendance_date = None
        if ticket.status not in {"resolved", "covered"}:
            ticket.risk = _attendance_ticket_risk(
                _attendance_missed_count_until(
                    ticket.learner_email,
                    ticket.attendance_module,
                    ticket.attendance_date,
                )
            )
        ticket.save()
        return JsonResponse(_ticket_to_dict(ticket))

    if request.method == "DELETE":
        if not ticket.is_archived:
            return JsonResponse({"error": "Only archived tickets can be permanently deleted"}, status=400)
        ticket.delete()
        return JsonResponse({"success": True})

    return JsonResponse({"error": "Method not allowed"}, status=405)


@csrf_exempt
def attendance_ticket_archive(request, pk):
    from .models import AttendanceTicket

    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    try:
        ticket = AttendanceTicket.objects.get(pk=pk)
    except AttendanceTicket.DoesNotExist:
        return JsonResponse({"error": "Ticket not found"}, status=404)

    body = _json_body(request)
    ticket.is_archived = bool(body.get("archive", True))
    ticket.save(update_fields=["is_archived", "updated_at"])
    return JsonResponse(_ticket_to_dict(ticket))


def _evidence_file_to_dict(ef, request=None):
    url = ef.file.url if ef.file else ""
    if request and url:
        url = request.build_absolute_uri(url)
    return {
        "id": ef.pk,
        "name": ef.original_name,
        "url": url,
        "mimeType": ef.mime_type,
        "uploadedAt": ef.uploaded_at.isoformat(),
    }


@csrf_exempt
def attendance_ticket_files(request, pk):
    from .models import AttendanceTicket, AttendanceEvidenceFile

    try:
        ticket = AttendanceTicket.objects.get(pk=pk)
    except AttendanceTicket.DoesNotExist:
        return JsonResponse({"error": "Ticket not found"}, status=404)

    if request.method == "GET":
        files = ticket.evidence_files.all()
        return JsonResponse([_evidence_file_to_dict(f, request) for f in files], safe=False)

    if request.method == "POST":
        uploaded = request.FILES.get("file")
        if not uploaded:
            return JsonResponse({"error": "No file provided"}, status=400)

        ef = AttendanceEvidenceFile.objects.create(
            ticket=ticket,
            file=uploaded,
            original_name=uploaded.name,
            mime_type=uploaded.content_type or "",
        )
        return JsonResponse(_evidence_file_to_dict(ef, request), status=201)

    return JsonResponse({"error": "Method not allowed"}, status=405)


@csrf_exempt
def attendance_ticket_file_delete(request, pk, file_pk):
    from .models import AttendanceEvidenceFile

    if request.method != "DELETE":
        return JsonResponse({"error": "DELETE required"}, status=405)

    try:
        ef = AttendanceEvidenceFile.objects.get(pk=file_pk, ticket_id=pk)
    except AttendanceEvidenceFile.DoesNotExist:
        return JsonResponse({"error": "File not found"}, status=404)

    ef.file.delete(save=False)
    ef.delete()
    return JsonResponse({"success": True})


# ─────────────────── Progress Review Ticket System ───────────────────

def _pr_ticket_to_dict(ticket):
    return {
        "id": ticket.pk,
        "ticketRef": ticket.ticket_ref,
        "learnerEmail": ticket.learner_email,
        "learnerName": ticket.learner_name,
        "learnerPhone": ticket.learner_phone,
        "organisation": ticket.organisation,
        "programme": ticket.programme,
        "lastProgressReview": ticket.last_progress_review,
        "lastActuallyCompletedPr": ticket.last_actually_completed_pr,
        "lastPrDate": ticket.last_pr_date.isoformat() if ticket.last_pr_date else None,
        "nextPrDate": ticket.next_pr_date.isoformat() if ticket.next_pr_date else None,
        "overdueCount": ticket.overdue_count,
        "risk": ticket.risk,
        "status": ticket.status,
        "assignedOwner": ticket.assigned_owner,
        "action": ticket.action,
        "notes": ticket.notes,
        "isArchived": ticket.is_archived,
        "escalated": ticket.escalated,
        "createdBy": ticket.created_by,
        "createdAt": ticket.created_at.isoformat(),
        "updatedAt": ticket.updated_at.isoformat(),
        "evidenceCount": ticket.evidence_files.count(),
    }


def _next_pr_ticket_ref():
    from .models import ProgressReviewTicket

    max_ref = 0
    for ref in ProgressReviewTicket.objects.filter(is_archived=False).values_list("ticket_ref", flat=True):
        match = re.fullmatch(r"PR-(\d+)", str(ref or "").strip())
        if match:
            max_ref = max(max_ref, int(match.group(1)))
    return f"PR-{max_ref + 1:03d}"


def _pr_reason_key(learner_email, next_pr_date):
    if hasattr(next_pr_date, "isoformat"):
        normalized_date = next_pr_date.isoformat()
    else:
        parsed_date = parse_date_safe(next_pr_date)
        normalized_date = parsed_date.isoformat() if parsed_date else str(next_pr_date or "").strip()
    return (str(learner_email or "").strip().lower(), normalized_date)


@csrf_exempt
def auto_create_pr_tickets(request):
    """Auto-create PR tickets for scoped overdue progress reviews."""
    from .models import ProgressReviewTicket

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    from .lms_academic import lms_progress_review_summary

    source_response = lms_progress_review_summary(request)
    if source_response.status_code != 200:
        return source_response
    source_rows = json.loads(source_response.content)
    learners = [{
        "email": row.get("email"), "name": row.get("fullName"),
        "phone": row.get("phone"), "organisation": row.get("organisation"),
        "programme": row.get("group"), "last_progress_review": row.get("lastProgressReview"),
        "last_actually_completed_pr": row.get("lastActuallyCompletedPr"),
        "last_pr_date": row.get("lastActuallyCompletedPr"), "next_pr_date": row.get("duePrDate"),
        "overdue_count": row.get("overduePrCount"), "risk": "amber", "status": "new",
        "created_by": "System",
    } for row in source_rows if int(row.get("overduePrCount") or 0) > 0 and row.get("duePrDate")]

    valid_emails = {str(row.get("email") or "").strip().lower() for row in learners}
    stale = ProgressReviewTicket.objects.filter(
        is_archived=False, created_by="System", status="new", assigned_owner="",
        action="no_action", notes="",
    ).exclude(learner_email__in=valid_emails).annotate(
        evidence_count=Count("evidence_files")
    ).filter(evidence_count=0)
    archived_count = stale.update(is_archived=True, updated_at=timezone.now())

    created_list = []
    existing_list = []
    resolved_reason_keys = {
        _pr_reason_key(ticket.learner_email, ticket.next_pr_date)
        for ticket in ProgressReviewTicket.objects.filter(is_archived=False, status="resolved")
        if ticket.next_pr_date
    }

    for learner in learners:
        email = str(learner.get("email") or "").strip().lower()
        name = str(learner.get("name") or "").strip()
        if not email or not name:
            continue

        raw_next_pr_date = learner.get("next_pr_date")
        next_pr_date = None
        if raw_next_pr_date:
            try:
                next_pr_date = date.fromisoformat(str(raw_next_pr_date))
            except Exception:
                next_pr_date = None

        if next_pr_date is None:
            continue
        if _pr_reason_key(email, next_pr_date) in resolved_reason_keys:
            continue

        raw_last_pr_date = learner.get("last_pr_date")
        last_pr_date = None
        if raw_last_pr_date:
            try:
                last_pr_date = date.fromisoformat(str(raw_last_pr_date))
            except Exception:
                last_pr_date = None

        existing = ProgressReviewTicket.objects.filter(
            learner_email=email,
            is_archived=False,
        ).exclude(status="resolved").first()

        if existing:
            existing_list.append({
                "email": email,
                "id": existing.pk,
                "ticketRef": existing.ticket_ref,
                "nextPrDate": existing.next_pr_date.isoformat() if existing.next_pr_date else None,
                "created": False,
            })
            continue

        ticket = ProgressReviewTicket.objects.create(
            ticket_ref=_next_pr_ticket_ref(),
            learner_email=email,
            learner_name=name,
            learner_phone=str(learner.get("phone") or "").strip(),
            organisation=str(learner.get("organisation") or "").strip(),
            programme=str(learner.get("programme") or "").strip(),
            last_progress_review=str(learner.get("last_progress_review") or "").strip(),
            last_actually_completed_pr=str(learner.get("last_actually_completed_pr") or "").strip(),
            last_pr_date=last_pr_date,
            next_pr_date=next_pr_date,
            overdue_count=int(learner.get("overdue_count") or 0),
            risk=str(learner.get("risk") or "amber").strip(),
            status=str(learner.get("status") or "new").strip(),
            assigned_owner=str(learner.get("assigned_owner") or "").strip(),
            action="no_action",
            notes=str(learner.get("notes") or "").strip(),
            escalated=bool(learner.get("escalated", False)),
            created_by=str(learner.get("created_by") or "System").strip(),
        )
        created_list.append(_pr_ticket_to_dict(ticket))

    return JsonResponse({
        "created": created_list,
        "existing": existing_list,
        "createdCount": len(created_list),
        "existingCount": len(existing_list),
        "archivedCount": archived_count,
    }, status=201)


@csrf_exempt
def pr_tickets(request):
    from .models import ProgressReviewTicket

    if request.method == "GET":
        show_archived = request.GET.get("archived", "false").lower() == "true"
        tickets = ProgressReviewTicket.objects.filter(is_archived=show_archived).order_by("-id")
        learner_email = str(
            request.GET.get("learner_email")
            or request.GET.get("email")
            or request.GET.get("learner")
            or ""
        ).strip().lower()
        if learner_email:
            tickets = tickets.filter(learner_email__iexact=learner_email)
        return JsonResponse([_pr_ticket_to_dict(t) for t in tickets], safe=False)

    if request.method == "POST":
        body = _json_body(request)
        if not body.get("learner_email") or not body.get("learner_name"):
            return JsonResponse({"error": "learner_email and learner_name are required"}, status=400)

        def _parse_date(val):
            if not val:
                return None
            try:
                return date.fromisoformat(str(val))
            except Exception:
                return None

        ticket = ProgressReviewTicket.objects.create(
            ticket_ref=_next_pr_ticket_ref(),
            learner_email=str(body.get("learner_email", "")).strip().lower(),
            learner_name=str(body.get("learner_name", "")).strip(),
            learner_phone=str(body.get("learner_phone", "")).strip(),
            organisation=str(body.get("organisation", "")).strip(),
            programme=str(body.get("programme", "")).strip(),
            last_progress_review=str(body.get("last_progress_review", "")).strip(),
            last_actually_completed_pr=str(body.get("last_actually_completed_pr", "")).strip(),
            last_pr_date=_parse_date(body.get("last_pr_date")),
            next_pr_date=_parse_date(body.get("next_pr_date")),
            overdue_count=int(body.get("overdue_count") or 0),
            risk=str(body.get("risk", "green")).strip(),
            status=str(body.get("status", "new")).strip(),
            assigned_owner=str(body.get("assigned_owner", "")).strip(),
            action=str(body.get("action", "")).strip(),
            notes=str(body.get("notes", "")).strip(),
            escalated=bool(body.get("escalated", False)),
            created_by=str(body.get("created_by", "System")).strip(),
        )
        return JsonResponse(_pr_ticket_to_dict(ticket), status=201)

    return JsonResponse({"error": "Method not allowed"}, status=405)


@csrf_exempt
def pr_ticket_detail(request, pk):
    from .models import ProgressReviewTicket

    try:
        ticket = ProgressReviewTicket.objects.get(pk=pk)
    except ProgressReviewTicket.DoesNotExist:
        return JsonResponse({"error": "Ticket not found"}, status=404)

    if request.method == "GET":
        return JsonResponse(_pr_ticket_to_dict(ticket))

    if request.method == "PATCH":
        body = _json_body(request)
        str_fields = ["learner_name", "learner_phone", "organisation", "programme",
                      "last_progress_review", "last_actually_completed_pr",
                      "risk", "status", "assigned_owner", "action", "notes"]
        for f in str_fields:
            if f in body:
                setattr(ticket, f, str(body[f]).strip())
        if "escalated" in body:
            ticket.escalated = bool(body["escalated"])
        if "overdue_count" in body:
            ticket.overdue_count = int(body["overdue_count"] or 0)
        for date_field in ["last_pr_date", "next_pr_date"]:
            if date_field in body:
                raw = body[date_field]
                if raw:
                    try:
                        setattr(ticket, date_field, date.fromisoformat(str(raw)))
                    except Exception:
                        pass
                else:
                    setattr(ticket, date_field, None)
        ticket.save()
        return JsonResponse(_pr_ticket_to_dict(ticket))

    if request.method == "DELETE":
        if not ticket.is_archived:
            return JsonResponse({"error": "Only archived tickets can be permanently deleted"}, status=400)
        ticket.delete()
        return JsonResponse({"success": True})

    return JsonResponse({"error": "Method not allowed"}, status=405)


@csrf_exempt
def pr_ticket_archive(request, pk):
    from .models import ProgressReviewTicket

    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    try:
        ticket = ProgressReviewTicket.objects.get(pk=pk)
    except ProgressReviewTicket.DoesNotExist:
        return JsonResponse({"error": "Ticket not found"}, status=404)

    body = _json_body(request)
    ticket.is_archived = bool(body.get("archive", True))
    ticket.save(update_fields=["is_archived", "updated_at"])
    return JsonResponse(_pr_ticket_to_dict(ticket))


@csrf_exempt
def pr_tickets_reset_owners(request):
    """One-time: clear assigned_owner for all PR tickets (was pre-filled from caseOwner)."""
    from .models import ProgressReviewTicket
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    updated = ProgressReviewTicket.objects.exclude(assigned_owner="").update(assigned_owner="")
    return JsonResponse({"cleared": updated})


def _pr_evidence_file_to_dict(ef, request=None):
    url = ef.file.url if ef.file else ""
    if request and url:
        url = request.build_absolute_uri(url)
    return {
        "id": ef.pk,
        "name": ef.original_name,
        "url": url,
        "mimeType": ef.mime_type,
        "uploadedAt": ef.uploaded_at.isoformat(),
    }


@csrf_exempt
def pr_ticket_files(request, pk):
    from .models import ProgressReviewTicket, PRTicketEvidenceFile

    try:
        ticket = ProgressReviewTicket.objects.get(pk=pk)
    except ProgressReviewTicket.DoesNotExist:
        return JsonResponse({"error": "Ticket not found"}, status=404)

    if request.method == "GET":
        files = ticket.evidence_files.all()
        return JsonResponse([_pr_evidence_file_to_dict(f, request) for f in files], safe=False)

    if request.method == "POST":
        uploaded = request.FILES.get("file")
        if not uploaded:
            return JsonResponse({"error": "No file provided"}, status=400)
        ef = PRTicketEvidenceFile.objects.create(
            ticket=ticket,
            file=uploaded,
            original_name=uploaded.name,
            mime_type=uploaded.content_type or "",
        )
        return JsonResponse(_pr_evidence_file_to_dict(ef, request), status=201)

    return JsonResponse({"error": "Method not allowed"}, status=405)


@csrf_exempt
def pr_ticket_file_delete(request, pk, file_pk):
    from .models import PRTicketEvidenceFile

    if request.method != "DELETE":
        return JsonResponse({"error": "DELETE required"}, status=405)

    try:
        ef = PRTicketEvidenceFile.objects.get(pk=file_pk, ticket_id=pk)
    except PRTicketEvidenceFile.DoesNotExist:
        return JsonResponse({"error": "File not found"}, status=404)

    ef.file.delete(save=False)
    ef.delete()
    return JsonResponse({"success": True})


# ─────────────────── MCM Ticket System ───────────────────

def _mcm_ticket_to_dict(ticket):
    try:
        mcm_history = json.loads(ticket.mcm_history or "[]")
    except Exception:
        mcm_history = []

    return {
        "id": ticket.pk,
        "ticketRef": ticket.ticket_ref,
        "learnerEmail": ticket.learner_email,
        "learnerName": ticket.learner_name,
        "learnerPhone": ticket.learner_phone,
        "organisation": ticket.organisation,
        "programme": ticket.programme,
        "coachName": ticket.coach_name,
        "overdueCount": ticket.overdue_count,
        "nextMcmDate": ticket.next_mcm_date,
        "lastMcmDate": ticket.last_mcm_date,
        "mcmStatus": ticket.mcm_status,
        "mcmHistory": mcm_history,
        "risk": ticket.risk,
        "status": ticket.status,
        "assignedOwner": ticket.assigned_owner,
        "action": ticket.action,
        "notes": ticket.notes,
        "isArchived": ticket.is_archived,
        "escalated": ticket.escalated,
        "createdBy": ticket.created_by,
        "createdAt": ticket.created_at.isoformat(),
        "updatedAt": ticket.updated_at.isoformat(),
        "evidenceCount": ticket.evidence_files.count(),
    }


def _next_mcm_ticket_ref():
    from .models import MCMTicket

    max_ref = 0
    for ref in MCMTicket.objects.filter(is_archived=False).values_list("ticket_ref", flat=True):
        match = re.fullmatch(r"MCM-(\d+)", str(ref or "").strip())
        if match:
            max_ref = max(max_ref, int(match.group(1)))
    return f"MCM-{max_ref + 1:03d}"


def _mcm_evidence_file_to_dict(f, request):
    return {
        "id": f.pk,
        "name": f.original_name,
        "url": request.build_absolute_uri(f.file.url),
        "mimeType": f.mime_type,
        "uploadedAt": f.uploaded_at.isoformat(),
    }


def _mcm_completed_status(value):
    return "completed" in str(value or "").strip().lower()


def _mcm_archived_status(value):
    return "archived" in str(value or "").strip().lower()


def _mcm_overdue_items(history):
    today = date.today()
    overdue = []
    for item in history:
        item_date = parse_date_safe(item.get("date"))
        if not item_date:
            continue
        item_status = str(item.get("status") or "").strip()
        completed = bool(item.get("completed")) or _mcm_completed_status(item_status)
        if item_date < today and not completed and not _mcm_archived_status(item_status):
            overdue.append({
                "date": item_date.isoformat(),
                "status": item_status,
                "completed": False,
                "isPast": True,
            })
    return overdue


def _mcm_completed_items(history):
    completed = []
    for item in history:
        item_date = parse_date_safe(item.get("date"))
        item_status = str(item.get("status") or "").strip()
        if item_date and (bool(item.get("completed")) or _mcm_completed_status(item_status)):
            completed.append({
                "date": item_date.isoformat(),
                "status": item_status,
                "completed": True,
            })
    return completed


def _mcm_next_item(history):
    today = date.today()
    next_items = []
    for item in history:
        item_date = parse_date_safe(item.get("date"))
        if not item_date:
            continue
        item_status = str(item.get("status") or "").strip()
        completed = bool(item.get("completed")) or _mcm_completed_status(item_status)
        if item_date >= today and not completed and not _mcm_archived_status(item_status):
            next_items.append((item_date, item_status))
    if not next_items:
        return None
    next_items.sort(key=lambda pair: pair[0])
    return next_items[0]


def _mcm_risk(overdue_count):
    if overdue_count >= 3:
        return "red"
    if overdue_count >= 1:
        return "amber"
    return "green"


def _mcm_reason_key(learner_email, next_mcm_date):
    reason_date = parse_date_safe(next_mcm_date)
    normalized_date = reason_date.isoformat() if reason_date else str(next_mcm_date or "").strip()
    return (str(learner_email or "").strip().lower(), normalized_date)


def _mcm_payload_from_summary_row(row):
    history = row.get("mcmDates") if isinstance(row.get("mcmDates"), list) else []
    normalized_history = []
    for item in history:
        item_date = parse_date_safe(item.get("date"))
        if not item_date:
            continue
        item_status = str(item.get("status") or "").strip()
        normalized_history.append({
            "date": item_date.isoformat(),
            "status": item_status,
            "completed": bool(item.get("completed")) or _mcm_completed_status(item_status),
        })

    overdue_items = _mcm_overdue_items(normalized_history)
    latest_overdue_item = _latest_dated_item(overdue_items)
    next_item = _mcm_next_item(normalized_history)
    completed_items = _mcm_completed_items(normalized_history)
    completed_items.sort(key=lambda item: item["date"])
    last_completed = completed_items[-1] if completed_items else None

    next_mcm_date = str((latest_overdue_item or {}).get("date") or "").strip()
    if not next_mcm_date:
        next_mcm_date = next_item[0].isoformat() if next_item else str(row.get("nextDueDate") or row.get("nextMcm") or "").strip()
    last_mcm_date = str((last_completed or {}).get("date") or row.get("lastActuallyCompletedMcm") or row.get("lastMcm") or "").strip()
    overdue_count = len(overdue_items)

    return {
        "learner_email": str(row.get("email") or "").strip().lower(),
        "learner_name": str(row.get("fullName") or "").strip(),
        "learner_phone": str(row.get("learnerPhone") or "").strip(),
        "organisation": str(row.get("organisationName") or "").strip(),
        "programme": str(row.get("programme") or "").strip(),
        "coach_name": str(row.get("caseOwner") or "").strip(),
        "overdue_count": overdue_count,
        "next_mcm_date": next_mcm_date,
        "last_mcm_date": last_mcm_date,
        "mcm_status": "Overdue follow-up required" if overdue_count else str(row.get("mcrStatus") or "").strip(),
        "mcm_history": normalized_history,
        "risk": _mcm_risk(overdue_count),
    }


@csrf_exempt
def auto_create_mcm_tickets(request):
    from .models import MCMTicket

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    from .lms_academic import lms_mcr_summary

    source_response = lms_mcr_summary(request)
    if source_response.status_code != 200:
        return source_response
    rows = json.loads(source_response.content)

    resolved_reason_keys = {
        _mcm_reason_key(ticket.learner_email, ticket.next_mcm_date)
        for ticket in MCMTicket.objects.filter(is_archived=False, status="resolved")
        if ticket.next_mcm_date
    }
    active_by_email = {
        ticket.learner_email.strip().lower(): ticket
        for ticket in MCMTicket.objects.filter(is_archived=False).exclude(status="resolved")
    }
    created = []
    updated = []
    valid_emails = {
        str(row.get("email") or "").strip().lower()
        for row in rows
        if int(row.get("overdueMcmCount") or 0) > 0
    }
    stale = MCMTicket.objects.filter(
        is_archived=False, created_by="System", status="new", assigned_owner="",
        action="", notes="",
    ).exclude(learner_email__in=valid_emails).annotate(
        evidence_count=Count("evidence_files")
    ).filter(evidence_count=0)
    archived_count = stale.update(is_archived=True, updated_at=timezone.now())

    for row in rows:
        if not isinstance(row, dict):
            continue
        payload = _mcm_payload_from_summary_row(row)
        if not payload["learner_email"] or not payload["learner_name"] or payload["overdue_count"] <= 0:
            continue
        if _mcm_reason_key(payload["learner_email"], payload["next_mcm_date"]) in resolved_reason_keys:
            continue

        existing = active_by_email.get(payload["learner_email"])
        if existing:
            next_history = json.dumps(payload["mcm_history"])
            needs_update = (
                existing.learner_phone != payload["learner_phone"]
                or existing.organisation != payload["organisation"]
                or existing.programme != payload["programme"]
                or existing.coach_name != payload["coach_name"]
                or existing.overdue_count != payload["overdue_count"]
                or existing.next_mcm_date != payload["next_mcm_date"]
                or existing.last_mcm_date != payload["last_mcm_date"]
                or existing.mcm_status != payload["mcm_status"]
                or existing.risk != payload["risk"]
                or (existing.mcm_history or "[]") != next_history
            )
            if needs_update:
                existing.learner_phone = payload["learner_phone"]
                existing.organisation = payload["organisation"]
                existing.programme = payload["programme"]
                existing.coach_name = payload["coach_name"]
                existing.overdue_count = payload["overdue_count"]
                existing.next_mcm_date = payload["next_mcm_date"]
                existing.last_mcm_date = payload["last_mcm_date"]
                existing.mcm_status = payload["mcm_status"]
                existing.mcm_history = next_history
                existing.risk = payload["risk"]
                existing.save(update_fields=[
                    "learner_phone", "organisation", "programme", "coach_name",
                    "overdue_count", "next_mcm_date", "last_mcm_date",
                    "mcm_status", "mcm_history", "risk", "updated_at",
                ])
                updated.append(_mcm_ticket_to_dict(existing))
            continue

        ticket = MCMTicket.objects.create(
            ticket_ref=_next_mcm_ticket_ref(),
            learner_email=payload["learner_email"],
            learner_name=payload["learner_name"],
            learner_phone=payload["learner_phone"],
            organisation=payload["organisation"],
            programme=payload["programme"],
            coach_name=payload["coach_name"],
            overdue_count=payload["overdue_count"],
            next_mcm_date=payload["next_mcm_date"],
            last_mcm_date=payload["last_mcm_date"],
            mcm_status=payload["mcm_status"],
            mcm_history=json.dumps(payload["mcm_history"]),
            risk=payload["risk"],
            status="new",
            action="",
            notes="",
            created_by="System",
        )
        active_by_email[payload["learner_email"]] = ticket
        created.append(_mcm_ticket_to_dict(ticket))

    return JsonResponse({
        "created": created,
        "updated": updated,
        "createdCount": len(created),
        "updatedCount": len(updated),
        "archivedCount": archived_count,
    }, status=201)


@csrf_exempt
def mcm_tickets(request):
    from .models import MCMTicket
    def val(body, snake, camel=None, default=""):
        if snake in body:
            return body.get(snake)
        if camel and camel in body:
            return body.get(camel)
        return default

    if request.method == "GET":
        show_archived = request.GET.get("archived", "false").lower() == "true"
        tickets = MCMTicket.objects.filter(is_archived=show_archived).order_by("-id")
        learner_email = str(
            request.GET.get("learner_email")
            or request.GET.get("email")
            or request.GET.get("learner")
            or ""
        ).strip().lower()
        if learner_email:
            tickets = tickets.filter(learner_email__iexact=learner_email)
        return JsonResponse([_mcm_ticket_to_dict(t) for t in tickets], safe=False)
    if request.method == "POST":
        body = _json_body(request)
        learner_email = str(val(body, "learner_email", "learnerEmail", "")).strip().lower()
        learner_name = str(val(body, "learner_name", "learnerName", "")).strip()
        if not learner_email or not learner_name:
            return JsonResponse({"error": "learner_email and learner_name are required"}, status=400)
        existing = MCMTicket.objects.filter(
            learner_email=learner_email,
            is_archived=False,
        ).exclude(status="resolved").first()
        if existing:
            return JsonResponse(_mcm_ticket_to_dict(existing), status=200)
        ticket = MCMTicket.objects.create(
            ticket_ref=_next_mcm_ticket_ref(),
            learner_email=learner_email,
            learner_name=learner_name,
            learner_phone=str(val(body, "learner_phone", "learnerPhone", "")).strip(),
            organisation=str(body.get("organisation", "")).strip(),
            programme=str(body.get("programme", "")).strip(),
            coach_name=str(val(body, "coach_name", "coachName", "")).strip(),
            overdue_count=int(val(body, "overdue_count", "overdueCount", 0) or 0),
            next_mcm_date=str(val(body, "next_mcm_date", "nextMcmDate", "")).strip(),
            last_mcm_date=str(val(body, "last_mcm_date", "lastMcmDate", "")).strip(),
            mcm_status=str(val(body, "mcm_status", "mcmStatus", "")).strip(),
            mcm_history=json.dumps(val(body, "mcm_history", "mcmHistory", []) or []),
            risk=str(body.get("risk", "amber")).strip(),
            status=str(body.get("status", "new")).strip(),
            assigned_owner=str(val(body, "assigned_owner", "assignedOwner", "")).strip(),
            action=str(body.get("action", "")).strip(),
            notes=str(body.get("notes", "")).strip(),
            escalated=bool(body.get("escalated", False)),
            created_by=str(body.get("created_by", "System")).strip(),
        )
        return JsonResponse(_mcm_ticket_to_dict(ticket), status=201)
    return JsonResponse({"error": "Method not allowed"}, status=405)


@csrf_exempt
def mcm_ticket_detail(request, pk):
    from .models import MCMTicket
    try:
        ticket = MCMTicket.objects.get(pk=pk)
    except MCMTicket.DoesNotExist:
        return JsonResponse({"error": "Ticket not found"}, status=404)
    if request.method == "GET":
        return JsonResponse(_mcm_ticket_to_dict(ticket))
    if request.method == "PATCH":
        body = _json_body(request)
        field_map = {
            "learner_name": "learnerName",
            "learner_email": "learnerEmail",
            "learner_phone": "learnerPhone",
            "organisation": "organisation",
            "programme": "programme",
            "coach_name": "coachName",
            "mcm_status": "mcmStatus",
            "next_mcm_date": "nextMcmDate",
            "last_mcm_date": "lastMcmDate",
            "risk": "risk",
            "status": "status",
            "assigned_owner": "assignedOwner",
            "action": "action",
            "notes": "notes",
        }
        for snake, camel in field_map.items():
            if snake in body or camel in body:
                value = body.get(snake, body.get(camel))
                setattr(ticket, snake, str(value).strip())
        if "overdue_count" in body or "overdueCount" in body:
            ticket.overdue_count = int(body.get("overdue_count", body.get("overdueCount")) or 0)
        if "mcm_history" in body or "mcmHistory" in body:
            ticket.mcm_history = json.dumps(body.get("mcm_history", body.get("mcmHistory")) or [])
        if "escalated" in body:
            ticket.escalated = bool(body["escalated"])
        ticket.save()
        return JsonResponse(_mcm_ticket_to_dict(ticket))
    if request.method == "DELETE":
        if not ticket.is_archived:
            return JsonResponse({"error": "Only archived tickets can be permanently deleted"}, status=400)
        ticket.delete()
        return JsonResponse({"success": True})
    return JsonResponse({"error": "Method not allowed"}, status=405)


@csrf_exempt
def mcm_ticket_archive(request, pk):
    from .models import MCMTicket
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    try:
        ticket = MCMTicket.objects.get(pk=pk)
    except MCMTicket.DoesNotExist:
        return JsonResponse({"error": "Ticket not found"}, status=404)
    body = _json_body(request)
    ticket.is_archived = bool(body.get("archive", True))
    ticket.save(update_fields=["is_archived", "updated_at"])
    return JsonResponse(_mcm_ticket_to_dict(ticket))


@csrf_exempt
def mcm_ticket_files(request, pk):
    from .models import MCMTicket, MCMTicketEvidenceFile
    try:
        ticket = MCMTicket.objects.get(pk=pk)
    except MCMTicket.DoesNotExist:
        return JsonResponse({"error": "Ticket not found"}, status=404)
    if request.method == "GET":
        files = ticket.evidence_files.all()
        return JsonResponse([_mcm_evidence_file_to_dict(f, request) for f in files], safe=False)
    if request.method == "POST":
        uploaded = request.FILES.get("file")
        if not uploaded:
            return JsonResponse({"error": "No file provided"}, status=400)
        ef = MCMTicketEvidenceFile.objects.create(
            ticket=ticket,
            file=uploaded,
            original_name=uploaded.name,
            mime_type=uploaded.content_type or "",
        )
        return JsonResponse(_mcm_evidence_file_to_dict(ef, request), status=201)
    return JsonResponse({"error": "Method not allowed"}, status=405)


@csrf_exempt
def mcm_ticket_file_delete(request, pk, file_pk):
    from .models import MCMTicketEvidenceFile
    if request.method != "DELETE":
        return JsonResponse({"error": "DELETE required"}, status=405)
    try:
        ef = MCMTicketEvidenceFile.objects.get(pk=file_pk, ticket_id=pk)
    except MCMTicketEvidenceFile.DoesNotExist:
        return JsonResponse({"error": "File not found"}, status=404)
    ef.file.delete(save=False)
    ef.delete()
    return JsonResponse({"success": True})


# ─────────────────── EPA Ticket System ───────────────────

def _epa_ticket_to_dict(ticket):
    return {
        "id": ticket.pk,
        "ticketRef": ticket.ticket_ref,
        "learnerEmail": ticket.learner_email,
        "learnerName": ticket.learner_name,
        "learnerPhone": ticket.learner_phone,
        "organisation": ticket.organisation,
        "programme": ticket.programme,
        "coachName": ticket.coach_name,
        "endDate": ticket.end_date.isoformat() if ticket.end_date else None,
        "daysOverdue": ticket.days_overdue,
        "risk": ticket.risk,
        "status": ticket.status,
        "assignedOwner": ticket.assigned_owner,
        "action": ticket.action,
        "notes": ticket.notes,
        "isArchived": ticket.is_archived,
        "escalated": ticket.escalated,
        "createdBy": ticket.created_by,
        "createdAt": ticket.created_at.isoformat(),
        "updatedAt": ticket.updated_at.isoformat(),
        "evidenceCount": ticket.evidence_files.count(),
    }


def _epa_evidence_file_to_dict(ef, request=None):
    url = ef.file.url if ef.file else ""
    if request and url:
        url = request.build_absolute_uri(url)
    return {
        "id": ef.pk,
        "name": ef.original_name,
        "url": url,
        "mimeType": ef.mime_type,
        "uploadedAt": ef.uploaded_at.isoformat(),
    }


def _epa_ticket_risk(days_overdue):
    if days_overdue >= 30:
        return "red"
    if days_overdue >= 1:
        return "amber"
    return "green"


@csrf_exempt
def auto_create_epa_tickets(request):
    from .models import EPATicket

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    today = date.today()
    created = []
    existing = []
    from .lms_academic import lms_epa_summary

    source_response = lms_epa_summary(request)
    if source_response.status_code != 200:
        return source_response
    source_payload = json.loads(source_response.content)
    overdue_learners = source_payload.get("epaOverdue", [])
    valid_emails = {
        str(learner.get("email") or "").strip().lower()
        for learner in overdue_learners
        if str(learner.get("email") or "").strip()
    }
    active_by_email = {
        ticket.learner_email.strip().lower(): ticket
        for ticket in EPATicket.objects.filter(is_archived=False).exclude(status="resolved")
    }

    stale = EPATicket.objects.filter(
        is_archived=False, created_by="System", status="new",
        assigned_owner="", action="", notes__startswith="Auto-created because EPA is overdue.",
    ).exclude(learner_email__in=valid_emails).annotate(
        evidence_count=Count("evidence_files")
    ).filter(evidence_count=0)
    archived_count = stale.update(is_archived=True, updated_at=timezone.now())

    for learner in overdue_learners:
        end_date = parse_date_safe(learner.get("endDate"))
        if not end_date:
            continue
        email = learner["email"]
        if not email or not learner["fullName"]:
            continue
        days_overdue = int(learner["daysOverdue"] or 0)
        ticket = active_by_email.get(email)
        if ticket:
            ticket.learner_phone = learner["phone"]
            ticket.organisation = learner["organisation"]
            ticket.programme = learner["programme"]
            ticket.coach_name = learner["coach"]
            ticket.end_date = end_date
            ticket.days_overdue = days_overdue
            ticket.risk = _epa_ticket_risk(days_overdue)
            ticket.save()
            existing.append(_epa_ticket_to_dict(ticket))
            continue

        ticket = EPATicket.objects.create(
            ticket_ref="EPA-TMP",
            learner_email=email,
            learner_name=learner["fullName"],
            learner_phone=learner["phone"],
            organisation=learner["organisation"],
            programme=learner["programme"],
            coach_name=learner["coach"],
            end_date=end_date,
            days_overdue=days_overdue,
            risk=_epa_ticket_risk(days_overdue),
            status="new",
            action="",
            notes=f"Auto-created because EPA is overdue. End-Date: {end_date.isoformat()}. Grace period: 7 days.",
            created_by="System",
        )
        ticket.ticket_ref = f"EPA-{ticket.pk:03d}"
        ticket.save(update_fields=["ticket_ref"])
        active_by_email[email] = ticket
        created.append(_epa_ticket_to_dict(ticket))

    return JsonResponse({
        "created": created,
        "existing": existing,
        "createdCount": len(created),
        "existingCount": len(existing),
        "archivedCount": archived_count,
    }, status=201)


@csrf_exempt
def epa_tickets(request):
    from .models import EPATicket

    if request.method == "GET":
        show_archived = request.GET.get("archived", "false").lower() == "true"
        tickets = EPATicket.objects.filter(is_archived=show_archived)
        return JsonResponse([_epa_ticket_to_dict(t) for t in tickets], safe=False)

    if request.method == "POST":
        body = _json_body(request)
        email = str(body.get("learner_email") or "").strip().lower()
        name = str(body.get("learner_name") or "").strip()
        if not email or not name:
            return JsonResponse({"error": "learner_email and learner_name are required"}, status=400)
        end_date = parse_date_safe(body.get("end_date"))
        days_overdue = int(body.get("days_overdue") or 0)
        ticket = EPATicket.objects.create(
            ticket_ref="EPA-TMP",
            learner_email=email,
            learner_name=name,
            learner_phone=str(body.get("learner_phone") or "").strip(),
            organisation=str(body.get("organisation") or "").strip(),
            programme=str(body.get("programme") or "").strip(),
            coach_name=str(body.get("coach_name") or "").strip(),
            end_date=end_date,
            days_overdue=days_overdue,
            risk=str(body.get("risk") or _epa_ticket_risk(days_overdue)).strip(),
            status=str(body.get("status") or "new").strip(),
            assigned_owner=str(body.get("assigned_owner") or "").strip(),
            action=str(body.get("action") or "").strip(),
            notes=str(body.get("notes") or "").strip(),
            escalated=bool(body.get("escalated", False)),
            created_by=str(body.get("created_by") or "System").strip(),
        )
        ticket.ticket_ref = f"EPA-{ticket.pk:03d}"
        ticket.save(update_fields=["ticket_ref"])
        return JsonResponse(_epa_ticket_to_dict(ticket), status=201)

    return JsonResponse({"error": "Method not allowed"}, status=405)


@csrf_exempt
def epa_ticket_detail(request, pk):
    from .models import EPATicket

    try:
        ticket = EPATicket.objects.get(pk=pk)
    except EPATicket.DoesNotExist:
        return JsonResponse({"error": "Ticket not found"}, status=404)

    if request.method == "GET":
        return JsonResponse(_epa_ticket_to_dict(ticket))

    if request.method == "PATCH":
        body = _json_body(request)
        for field in ["learner_name", "learner_phone", "organisation", "programme", "coach_name", "risk", "status", "assigned_owner", "action", "notes"]:
            if field in body:
                setattr(ticket, field, str(body[field]).strip())
        if "end_date" in body:
            ticket.end_date = parse_date_safe(body.get("end_date"))
        if "days_overdue" in body:
            ticket.days_overdue = int(body.get("days_overdue") or 0)
        if "escalated" in body:
            ticket.escalated = bool(body["escalated"])
        ticket.save()
        return JsonResponse(_epa_ticket_to_dict(ticket))

    if request.method == "DELETE":
        if not ticket.is_archived:
            return JsonResponse({"error": "Only archived tickets can be permanently deleted"}, status=400)
        ticket.delete()
        return JsonResponse({"success": True})

    return JsonResponse({"error": "Method not allowed"}, status=405)


@csrf_exempt
def epa_ticket_archive(request, pk):
    from .models import EPATicket

    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    try:
        ticket = EPATicket.objects.get(pk=pk)
    except EPATicket.DoesNotExist:
        return JsonResponse({"error": "Ticket not found"}, status=404)
    body = _json_body(request)
    ticket.is_archived = bool(body.get("archive", True))
    ticket.save(update_fields=["is_archived", "updated_at"])
    return JsonResponse(_epa_ticket_to_dict(ticket))


@csrf_exempt
def epa_ticket_files(request, pk):
    from .models import EPATicket, EPATicketEvidenceFile

    try:
        ticket = EPATicket.objects.get(pk=pk)
    except EPATicket.DoesNotExist:
        return JsonResponse({"error": "Ticket not found"}, status=404)

    if request.method == "GET":
        files = ticket.evidence_files.all()
        return JsonResponse([_epa_evidence_file_to_dict(file, request) for file in files], safe=False)

    if request.method == "POST":
        uploaded = request.FILES.get("file")
        if not uploaded:
            return JsonResponse({"error": "No file provided"}, status=400)
        evidence = EPATicketEvidenceFile.objects.create(
            ticket=ticket,
            file=uploaded,
            original_name=uploaded.name,
            mime_type=uploaded.content_type or "",
        )
        return JsonResponse(_epa_evidence_file_to_dict(evidence, request), status=201)

    return JsonResponse({"error": "Method not allowed"}, status=405)


@csrf_exempt
def epa_ticket_file_delete(request, pk, file_pk):
    from .models import EPATicketEvidenceFile

    if request.method != "DELETE":
        return JsonResponse({"error": "DELETE required"}, status=405)
    try:
        evidence = EPATicketEvidenceFile.objects.get(pk=file_pk, ticket_id=pk)
    except EPATicketEvidenceFile.DoesNotExist:
        return JsonResponse({"error": "File not found"}, status=404)
    evidence.file.delete(save=False)
    evidence.delete()
    return JsonResponse({"success": True})


# ─────────────────── OTJ Ticket System ───────────────────

def _otj_ticket_to_dict(ticket, live_otj=None):
    live_otj = live_otj or {}
    live_status = str(live_otj.get("otjHoursStatus") or ticket.otj_status or "").strip()
    risk_by_status = {
        "at risk": "red",
        "need attention": "amber",
        "on track": "green",
    }
    evidence_count = getattr(ticket, "evidence_count", None)
    if evidence_count is None:
        evidence_count = ticket.evidence_files.count()
    return {
        "id": ticket.pk,
        "ticketRef": ticket.ticket_ref,
        "learnerEmail": ticket.learner_email,
        "learnerName": live_otj.get("fullName") or ticket.learner_name,
        "learnerPhone": live_otj.get("learnerPhone") or ticket.learner_phone,
        "organisation": live_otj.get("organizationName") or ticket.organisation,
        "programme": live_otj.get("programName") or ticket.programme,
        "otjMinimum": live_otj.get("otjMinimum", ticket.otj_minimum),
        "otjCompleted": live_otj.get("otjCompleted", ticket.otj_completed),
        "otjExpected": live_otj.get("otjExpected", ticket.otj_expected),
        "otjStatus": live_status,
        "risk": risk_by_status.get(live_status.lower(), ticket.risk),
        "status": ticket.status,
        "assignedOwner": ticket.assigned_owner,
        "action": ticket.action,
        "notes": ticket.notes,
        "isArchived": ticket.is_archived,
        "escalated": ticket.escalated,
        "createdBy": ticket.created_by,
        "createdAt": ticket.created_at.isoformat(),
        "updatedAt": ticket.updated_at.isoformat(),
        "evidenceCount": evidence_count,
        "otjDataSource": "lms" if live_otj else "ticket_snapshot",
        "otjTargetAsOfDate": live_otj.get("targetAsOfDate"),
        "otjTargetStatus": live_otj.get("targetStatus", ""),
    }


def _next_otj_ticket_ref():
    from .models import OTJTicket

    max_ref = 0
    for ref in OTJTicket.objects.values_list("ticket_ref", flat=True):
        match = re.fullmatch(r"OTJ-(\d+)", str(ref or "").strip())
        if match:
            max_ref = max(max_ref, int(match.group(1)))
    return f"OTJ-{max_ref + 1:03d}"


@csrf_exempt
def otj_tickets(request):
    from .models import OTJTicket

    if request.method == "GET":
        from .lms_otjh import load_lms_otjh_by_email

        show_archived = request.GET.get("archived", "false").lower() == "true"
        tickets = OTJTicket.objects.filter(is_archived=show_archived).annotate(
            evidence_count=Count("evidence_files")
        )
        try:
            live_by_email = load_lms_otjh_by_email()
        except Exception:
            live_by_email = {}
        response = JsonResponse([
            _otj_ticket_to_dict(
                ticket,
                live_by_email.get(str(ticket.learner_email or "").strip().lower()),
            )
            for ticket in tickets
        ], safe=False)
        response["Cache-Control"] = "private, no-store"
        return response

    if request.method == "POST":
        body = _json_body(request)
        learner_email = str(body.get("learner_email", "")).strip().lower()
        learner_name = str(body.get("learner_name", "")).strip()
        if not learner_email or not learner_name:
            return JsonResponse({"error": "learner_email and learner_name are required"}, status=400)

        existing = OTJTicket.objects.filter(
            learner_email=learner_email,
            is_archived=False,
        ).exclude(status="resolved").first()
        if existing:
            return JsonResponse(_otj_ticket_to_dict(existing), status=200)

        ticket = OTJTicket.objects.create(
            ticket_ref=_next_otj_ticket_ref(),
            learner_email=learner_email,
            learner_name=learner_name,
            learner_phone=str(body.get("learner_phone", "")).strip(),
            organisation=str(body.get("organisation", "")).strip(),
            programme=str(body.get("programme", "")).strip(),
            otj_minimum=float(body.get("otj_minimum") or 0),
            otj_completed=float(body.get("otj_completed") or 0),
            otj_expected=float(body.get("otj_expected") or 0),
            otj_status=str(body.get("otj_status", "")).strip(),
            risk=str(body.get("risk", "amber")).strip(),
            status=str(body.get("status", "new")).strip(),
            assigned_owner=str(body.get("assigned_owner", "")).strip(),
            action=str(body.get("action", "")).strip(),
            notes=str(body.get("notes", "")).strip(),
            escalated=bool(body.get("escalated", False)),
            created_by=str(body.get("created_by", "System")).strip(),
        )
        return JsonResponse(_otj_ticket_to_dict(ticket), status=201)

    return JsonResponse({"error": "Method not allowed"}, status=405)


@csrf_exempt
def otj_ticket_detail(request, pk):
    from .models import OTJTicket

    try:
        ticket = OTJTicket.objects.get(pk=pk)
    except OTJTicket.DoesNotExist:
        return JsonResponse({"error": "Ticket not found"}, status=404)

    if request.method == "GET":
        try:
            from .lms_otjh import load_lms_otjh_by_email

            live_otj = load_lms_otjh_by_email().get(
                str(ticket.learner_email or "").strip().lower()
            )
        except Exception:
            live_otj = None
        return JsonResponse(_otj_ticket_to_dict(ticket, live_otj))

    if request.method == "PATCH":
        body = _json_body(request)
        str_fields = ["learner_name", "learner_phone", "organisation", "programme",
                      "otj_status", "risk", "status", "assigned_owner", "action", "notes"]
        for f in str_fields:
            if f in body:
                setattr(ticket, f, str(body[f]).strip())
        if "escalated" in body:
            ticket.escalated = bool(body["escalated"])
        for float_field in ["otj_minimum", "otj_completed", "otj_expected"]:
            if float_field in body:
                setattr(ticket, float_field, float(body[float_field] or 0))
        ticket.save()
        return JsonResponse(_otj_ticket_to_dict(ticket))

    if request.method == "DELETE":
        if not ticket.is_archived:
            return JsonResponse({"error": "Only archived tickets can be permanently deleted"}, status=400)
        ticket.delete()
        return JsonResponse({"success": True})

    return JsonResponse({"error": "Method not allowed"}, status=405)


@csrf_exempt
def otj_ticket_archive(request, pk):
    from .models import OTJTicket

    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    try:
        ticket = OTJTicket.objects.get(pk=pk)
    except OTJTicket.DoesNotExist:
        return JsonResponse({"error": "Ticket not found"}, status=404)

    body = _json_body(request)
    ticket.is_archived = bool(body.get("archive", True))
    ticket.save(update_fields=["is_archived", "updated_at"])
    return JsonResponse(_otj_ticket_to_dict(ticket))


def _otj_evidence_file_to_dict(ef, request=None):
    url = ef.file.url if ef.file else ""
    if request and url:
        url = request.build_absolute_uri(url)
    return {
        "id": ef.pk,
        "name": ef.original_name,
        "url": url,
        "mimeType": ef.mime_type,
        "uploadedAt": ef.uploaded_at.isoformat(),
    }


@csrf_exempt
def otj_ticket_files(request, pk):
    from .models import OTJTicket, OTJTicketEvidenceFile

    try:
        ticket = OTJTicket.objects.get(pk=pk)
    except OTJTicket.DoesNotExist:
        return JsonResponse({"error": "Ticket not found"}, status=404)

    if request.method == "GET":
        files = ticket.evidence_files.all()
        return JsonResponse([_otj_evidence_file_to_dict(f, request) for f in files], safe=False)

    if request.method == "POST":
        uploaded = request.FILES.get("file")
        if not uploaded:
            return JsonResponse({"error": "No file provided"}, status=400)
        ef = OTJTicketEvidenceFile.objects.create(
            ticket=ticket,
            file=uploaded,
            original_name=uploaded.name,
            mime_type=uploaded.content_type or "",
        )
        return JsonResponse(_otj_evidence_file_to_dict(ef, request), status=201)

    return JsonResponse({"error": "Method not allowed"}, status=405)


@csrf_exempt
def otj_ticket_file_delete(request, pk, file_pk):
    from .models import OTJTicketEvidenceFile

    if request.method != "DELETE":
        return JsonResponse({"error": "DELETE required"}, status=405)

    try:
        ef = OTJTicketEvidenceFile.objects.get(pk=file_pk, ticket_id=pk)
    except OTJTicketEvidenceFile.DoesNotExist:
        return JsonResponse({"error": "File not found"}, status=404)

    ef.file.delete(save=False)
    ef.delete()
    return JsonResponse({"success": True})


# ── Email proxy ─────────────────────────────────────────────────────────────

N8N_EMAIL_WEBHOOK = getattr(settings, "N8N_EMAIL_WEBHOOK", "https://n8n.srv943390.hstgr.cloud/webhook/email_sender")
EMAIL_ADDRESS_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
MAX_EMAIL_RECIPIENTS = 500
MAX_CC_RECIPIENTS = 20


def _clean_email_address(value):
    return re.sub(r"[\u202A-\u202E]", "", str(value or "")).strip().lower()


def _email_values(value):
    if value is None:
        return []
    if isinstance(value, str):
        return [part for part in re.split(r"[,;\n]", value) if part.strip()]
    if isinstance(value, list):
        values = []
        for item in value:
            if isinstance(item, dict):
                item = (item.get("emailAddress") or {}).get("address") or item.get("address") or item.get("email")
            values.extend(_email_values(item))
        return values
    return [value]


def _normalize_email_list(values, *, exclude=()):
    excluded = {_clean_email_address(value) for value in exclude if value}
    normalized = []
    invalid = []
    seen = set()
    for value in values:
        email = _clean_email_address(value)
        if not email:
            continue
        if not EMAIL_ADDRESS_RE.fullmatch(email):
            invalid.append(str(value).strip())
            continue
        if email in excluded or email in seen:
            continue
        seen.add(email)
        normalized.append(email)
    return normalized, invalid


def _prepare_email_payload(payload):
    if not isinstance(payload, dict):
        raise ValueError("Email payload must be an object")
    recipients = payload.get("recipients")
    if not isinstance(recipients, list) or not recipients:
        raise ValueError("Select at least one email recipient")
    if len(recipients) > MAX_EMAIL_RECIPIENTS:
        raise ValueError(f"A maximum of {MAX_EMAIL_RECIPIENTS} recipients can be sent at once")

    common_cc_values = []
    for key in ("cc", "ccEmails", "ccEmail", "ccRecipients", "testCcEmail"):
        common_cc_values.extend(_email_values(payload.get(key)))
    common_cc, invalid_common_cc = _normalize_email_list(common_cc_values)
    if invalid_common_cc:
        raise ValueError(f"Invalid CC email: {invalid_common_cc[0]}")
    if len(common_cc) > MAX_CC_RECIPIENTS:
        raise ValueError(f"A maximum of {MAX_CC_RECIPIENTS} CC recipients is allowed")

    prepared_recipients = []
    for index, recipient in enumerate(recipients, start=1):
        if not isinstance(recipient, dict):
            raise ValueError(f"Recipient {index} must be an object")
        primary = _clean_email_address(recipient.get("learnerEmail") or recipient.get("email"))
        if not EMAIL_ADDRESS_RE.fullmatch(primary):
            raise ValueError(f"Recipient {index} has an invalid email address")
        subject = str(recipient.get("renderedSubject") or "").strip()
        html_body = str(recipient.get("renderedBody") or recipient.get("renderedHtmlBody") or "").strip()
        if not subject:
            raise ValueError(f"Recipient {index} has an empty subject")
        if not html_body:
            raise ValueError(f"Recipient {index} has an empty email body")

        recipient_cc_values = list(common_cc)
        for key in ("cc", "ccEmails", "ccEmail", "ccRecipients", "coachCcEmail", "testCcEmail"):
            recipient_cc_values.extend(_email_values(recipient.get(key)))
        cc_emails, invalid_cc = _normalize_email_list(recipient_cc_values, exclude=(primary,))
        if invalid_cc:
            raise ValueError(f"Recipient {index} has an invalid CC email: {invalid_cc[0]}")
        if len(cc_emails) > MAX_CC_RECIPIENTS:
            raise ValueError(f"Recipient {index} exceeds the {MAX_CC_RECIPIENTS} CC recipient limit")

        prepared_recipients.append({
            **recipient,
            "learnerEmail": primary,
            "cc": cc_emails,
            "ccEmails": cc_emails,
            "ccEmail": cc_emails[0] if cc_emails else "",
            "ccRecipients": [
                {"emailAddress": {"address": email}}
                for email in cc_emails
            ],
        })

    return {
        **payload,
        "cc": common_cc,
        "ccEmails": common_cc,
        "ccEmail": common_cc[0] if common_cc else "",
        "ccRecipients": [
            {"emailAddress": {"address": email}}
            for email in common_cc
        ],
        "recipients": prepared_recipients,
    }

@csrf_exempt
def send_email_proxy(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    user = getattr(request, "user", None)
    if not user or not user.is_authenticated:
        return JsonResponse({"error": "Authentication required"}, status=401)
    if not (user.is_staff or user.is_superuser):
        return JsonResponse({"error": "Super Admin access required"}, status=403)
    try:
        payload = _prepare_email_payload(json.loads(request.body.decode("utf-8") or "{}"))
        resp = requests.post(
            N8N_EMAIL_WEBHOOK,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=30,
        )
        try:
            data = resp.json()
        except Exception:
            data = {"raw": resp.text}

        if resp.status_code >= 400:
            message = (
                data.get("detail")
                or data.get("error")
                or data.get("message")
                or data.get("raw")
                or "n8n email webhook failed"
            )
            return JsonResponse(
                {
                    "detail": str(message),
                    "webhookStatus": resp.status_code,
                    "webhookResponse": data,
                },
                status=resp.status_code,
            )

        return JsonResponse(data, status=resp.status_code, safe=False)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"detail": "Request body must be valid JSON"}, status=400)
    except ValueError as e:
        return JsonResponse({"detail": str(e)}, status=400)
    except requests.Timeout:
        return JsonResponse({"detail": "n8n email webhook timed out"}, status=504)
    except Exception as e:
        return JsonResponse({"detail": str(e)}, status=500)
