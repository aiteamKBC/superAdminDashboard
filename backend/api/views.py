from django.shortcuts import render

# Create your views here.
import json
import re
import requests
from decimal import Decimal
from django.http import JsonResponse
from django.db import connection, connections
from django.contrib.auth import authenticate, get_user_model, login as django_login, logout as django_logout
from django.views.decorators.csrf import csrf_exempt
from datetime import datetime, date, timedelta
from django.conf import settings


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
    ]

    for fmt in formats:
        try:
            return datetime.strptime(value, fmt).date()
        except Exception:
            continue

    import re

    match = re.search(r"(\d{2}[/-]\d{2}[/-]\d{2,4}|\d{4}[/-]\d{2}[/-]\d{2})$", value)
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


def is_countable_progress_review_slot(planned_value):
    planned_text = str(planned_value or "").strip().lower()
    if "personal support plan" in planned_text or "gateway review" in planned_text:
        return False

    return True


def progress_review_summary(request):
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
        cursor.execute("""
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
        """)
        columns = [col[0] for col in cursor.description]
        raw_rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

    today = date.today()
    results = []

    for row in raw_rows:
        overdue_count = 0
        next_due_date_from_planned = None
        next_due_state_from_planned = ""
        all_planned_dates = []
        last_actually_completed_pr = row.get("Last Actually Completed PR") or ""
        last_progress_review = row.get("Last Progress Review") or ""
        excluded_planned_dates = set()
        countable_planned_dates = set()

        for i in range(1, 17):
            planned_key = f"Review Planned Date{i}"
            status_key = f"Review Status{i}"

            planned_value = row.get(planned_key)
            planned_date = parse_date_safe(planned_value)
            planned_status_raw = str(row.get(status_key) or "").strip()
            completed = is_completed_status(planned_status_raw)

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

            if planned_date < today and not completed:
                overdue_count += 1

            if planned_date >= today and not completed:
                if next_due_date_from_planned is None or planned_date < next_due_date_from_planned:
                    next_due_date_from_planned = planned_date
                    next_due_state_from_planned = planned_status_raw

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

        # Normalize nextPrDate to YYYY-MM-DD regardless of source format
        parsed_field_date = parse_date_safe(next_pr_date_raw) if next_pr_date_raw else None
        if parsed_field_date and parsed_field_date not in excluded_planned_dates and (
            not countable_planned_dates or parsed_field_date in countable_planned_dates
        ):
            next_pr_date = parsed_field_date.strftime("%Y-%m-%d")
        elif next_due_date_from_planned:
            next_pr_date = next_due_date_from_planned.strftime("%Y-%m-%d")
        else:
            next_pr_date = ""

        if not next_pr_state and next_due_state_from_planned:
            next_pr_state = next_due_state_from_planned

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
                "contact_key": f"{email}||{date_value}||{module}",
            })

        return JsonResponse(data, safe=False)

    if request.method == "PATCH":
        try:
            body = json.loads(request.body.decode("utf-8"))

            email = str(body.get("email", "")).strip().lower()
            date_value = body.get("date")
            module = str(body.get("module", "")).strip()
            called = bool(body.get("called", False))
            emailed = bool(body.get("emailed", False))
            resolved = bool(body.get("resolved", False))
            note = str(body.get("note", "")).strip()

            if not email or not date_value or not module:
                return JsonResponse(
                    {"error": "email, date and module are required"},
                    status=400,
                )

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
                "contact_key": f"{(row[0] or '').strip().lower()}||{row[1].isoformat() if row[1] else None}||{row[2] or ''}",
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
    with connections["aptem"].cursor() as cursor:
        cursor.execute("""
            SELECT
                "ID",
                "FullName",
                "Email",
                "Minimum",
                "Planned",
                "Submitted",
                "Completed",
                "Forecast",
                "Exepected",
                "ProgressVariance",
                "Progress-Hours",
                "OTJHoursStatus",
                "Program Name",
                "Program-Status",
                "OwnerName",
                "OwnerEmail",
                "OrganizationName",
                "Learner Phone",
                "Start-Date",
                "End-Date",
                "Total Days",
                "Elapsed-Days"
            FROM public.aptem_auto_extracting
            WHERE "Program-Status" = 'Active'
              AND "OTJHoursStatus" IS NOT NULL
              AND "OTJHoursStatus" != ''
        """)
        columns = [col[0] for col in cursor.description]
        raw_rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

    results = []
    for row in raw_rows:
        results.append({
            "id": str(row.get("ID") or ""),
            "fullName": row.get("FullName") or "",
            "email": (row.get("Email") or "").strip().lower(),
            "otjMinimum": float(row.get("Minimum") or 0),
            "otjPlanned": float(row.get("Planned") or 0),
            "otjSubmitted": float(row.get("Submitted") or 0),
            "otjCompleted": float(row.get("Completed") or 0),
            "otjForecast": float(row.get("Forecast") or 0),
            "otjExpected": float(row.get("Exepected") or 0),
            "progressVariance": row.get("ProgressVariance") or "",
            "progressHours": row.get("Progress-Hours") or "",
            "otjHoursStatus": row.get("OTJHoursStatus") or "",
            "prStatusLast12Weeks": "",
            "mcmStatusLast4Weeks": "",
            "programName": row.get("Program Name") or "",
            "programStatus": row.get("Program-Status") or "",
            "ownerName": row.get("OwnerName") or "",
            "ownerEmail": (row.get("OwnerEmail") or "").strip().lower(),
            "organizationName": row.get("OrganizationName") or "",
            "learnerPhone": row.get("Learner Phone") or "",
            "startDate": row.get("Start-Date").isoformat() if row.get("Start-Date") else None,
            "endDate": row.get("End-Date").isoformat() if row.get("End-Date") else None,
            "totalDays": row.get("Total Days"),
            "elapsedDays": row.get("Elapsed-Days"),
        })

    return JsonResponse(results, safe=False)


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
        next_due_date = None
        mcm_dates = []

        for i in range(1, 23):
            mcm_date = parse_date_safe(row.get(f"MCM{i}"))
            status_raw = str(row.get(f"Status{i}") or "").strip()
            completed = is_completed_status(status_raw)

            if not mcm_date:
                continue

            mcm_dates.append({
                "date": mcm_date.strftime("%Y-%m-%d"),
                "status": status_raw,
                "completed": completed,
            })

            if mcm_date < today and not completed:
                overdue_count += 1

            if mcm_date >= today and not completed:
                if next_due_date is None or mcm_date < next_due_date:
                    next_due_date = mcm_date

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
            "nextDueDate": next_due_date.isoformat() if next_due_date else None,
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
            ORDER BY "Email", "date" ASC
        """)
        columns = [col[0] for col in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

    def _attendance_identity(row):
        full_name = re.sub(r"\s+", " ", str(row.get("FullName") or "").strip()).lower()
        raw_key = str(row.get("key") or "").strip()
        key_match = re.match(r"^(\d+)_", raw_key)
        if key_match:
            return f"id:{key_match.group(1)}"
        if full_name:
            return f"name:{full_name}"
        email = (row.get("Email") or "").strip().lower()
        return f"email:{email}"

    grouped = defaultdict(lambda: {
        "fullName": "",
        "records": [],
        "emails": [],
        "latest_email": "",
        "latest_date": None,
    })

    for row in rows:
        email = (row.get("Email") or "").strip().lower()
        if not email:
            continue
        identity = _attendance_identity(row)
        group = grouped[identity]
        row_date = row.get("date")
        if row.get("FullName"):
            group["fullName"] = row.get("FullName") or group["fullName"]
        if email not in group["emails"]:
            group["emails"].append(email)
        if row_date and (group["latest_date"] is None or row_date >= group["latest_date"]):
            group["latest_date"] = row_date
            group["latest_email"] = email
        group["records"].append({
            "date": row["date"].isoformat() if row.get("date") else None,
            "attendance": row.get("Attendance"),
            "module": row.get("module") or "",
            "key": row.get("key") or "",
            "email": email,
            "note": row.get("note") or "",
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
            "ownerName": extras.get("owner_name", ""),
            "records": sorted(data["records"], key=lambda record: record.get("date") or ""),
        })

    return JsonResponse(results, safe=False)


def require_marking_summary(request):
    with connections["aptem"].cursor() as cursor:
        cursor.execute("""
            SELECT
                "LearnerId",
                "FullName",
                "Email",
                "Subscription Status",
                "CaseOwner ID",
                "CaseOwner",
                "ElapsedDays",
                "Phone",
                "CountEvidencePending",
                "Evidence Accepted",
                "Evidence Reffered",
                "Referred Closure",
                "Total Evidence",
                "Last Snapshot CountApproved",
                "Last Snapshot Date",
                "Today",
                "Yesterday",
                "-2", "-3", "-4", "-5", "-6", "-7",
                "Start-Date",
                "Status",
                "LastSubDate"
            FROM public."Require Marking"
            WHERE LOWER(COALESCE("Status", '')) = 'active'
              AND "CaseOwner" IS NOT NULL
        """)
        columns = [col[0] for col in cursor.description]
        raw_rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

    results = []
    for row in raw_rows:
        results.append({
            "learnerId": row.get("LearnerId"),
            "fullName": row.get("FullName") or "",
            "email": (row.get("Email") or "").strip().lower(),
            "subscriptionStatus": row.get("Subscription Status") or "",
            "caseOwnerId": row.get("CaseOwner ID"),
            "caseOwner": row.get("CaseOwner") or "",
            "elapsedDays": row.get("ElapsedDays"),
            "phone": row.get("Phone") or "",
            "countEvidencePending": row.get("CountEvidencePending") or 0,
            "evidenceAccepted": row.get("Evidence Accepted") or 0,
            "evidenceReferred": row.get("Evidence Reffered") or 0,
            "referredClosure": row.get("Referred Closure") or 0,
            "totalEvidence": row.get("Total Evidence") or 0,
            "lastSnapshotCountApproved": row.get("Last Snapshot CountApproved") or "",
            "lastSnapshotDate": row.get("Last Snapshot Date").isoformat() if row.get("Last Snapshot Date") else None,
            "todayCount": row.get("Today") or 0,
            "yesterdayCount": row.get("Yesterday") or 0,
            "day2Count": row.get("-2") or 0,
            "day3Count": row.get("-3") or 0,
            "day4Count": row.get("-4") or 0,
            "day5Count": row.get("-5") or 0,
            "day6Count": row.get("-6") or 0,
            "day7Count": row.get("-7") or 0,
            "startDate": row.get("Start-Date").isoformat() if row.get("Start-Date") else None,
            "status": row.get("Status") or "",
            "lastSubDate": row.get("LastSubDate") or "",
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
        "evidenceCount": ticket.evidence_files.count(),
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
    missed_dates = _attendance_missed_dates(
        {(ticket.learner_email, ticket.attendance_module) for ticket in tickets}
    )

    to_update = []
    for ticket in tickets:
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


@csrf_exempt
def auto_create_attendance_tickets(request):
    """Auto-create tickets for absent learners in a given week if no ticket exists yet."""
    from .models import AttendanceTicket
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    body = _json_body(request)
    learners = body.get("learners", [])
    if not learners:
        try:
            week_start = date.fromisoformat(str(body.get("week_start") or ""))
            week_end = date.fromisoformat(str(body.get("week_end") or ""))
            learners = _attendance_missing_learners_for_week(week_start, week_end)
        except Exception:
            learners = []

    created_list = []
    existing_list = []

    for learner in learners:
        email = str(learner.get("email") or "").strip().lower()
        if not email:
            continue

        raw_date = learner.get("attendance_date")
        att_date = None
        if raw_date:
            try:
                att_date = date.fromisoformat(str(raw_date))
            except Exception:
                pass

        # Check for existing non-archived ticket for same email + date
        existing = AttendanceTicket.objects.filter(
            learner_email=email,
            attendance_date=att_date,
            is_archived=False,
        ).first()

        if existing:
            missed_count = int(learner.get("missed_count") or 1)
            risk = _attendance_ticket_risk(missed_count)
            if existing.risk != risk:
                existing.risk = risk
                existing.save(update_fields=["risk"])
            existing_list.append({
                "email": email,
                "id": existing.pk,
                "ticketRef": existing.ticket_ref,
                "status": existing.status,
                "created": False,
            })
        else:
            missed_count = int(learner.get("missed_count") or 1)
            risk = _attendance_ticket_risk(missed_count)
            ticket = AttendanceTicket.objects.create(
                ticket_ref="ATT-TMP",
                learner_email=email,
                learner_name=str(learner.get("name") or "").strip(),
                learner_phone=str(learner.get("phone") or "").strip(),
                organisation=str(learner.get("organisation") or "").strip(),
                programme=str(learner.get("programme") or "").strip(),
                attendance_date=att_date,
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
            created_list.append({
                "email": email,
                "id": ticket.pk,
                "ticketRef": ticket.ticket_ref,
                "status": ticket.status,
                "created": True,
            })

    return JsonResponse({
        "created": len(created_list),
        "existing": len(existing_list),
        "tickets": created_list + existing_list,
    })


@csrf_exempt
def attendance_tickets(request):
    from .models import AttendanceTicket

    if request.method == "GET":
        show_archived = request.GET.get("archived", "false").lower() == "true"
        tickets = AttendanceTicket.objects.filter(is_archived=show_archived)
        if not show_archived:
            _sync_attendance_ticket_risks(
                tickets.exclude(status__in=["resolved", "covered"])
            )
            tickets = AttendanceTicket.objects.filter(is_archived=False)
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
    for ref in ProgressReviewTicket.objects.values_list("ticket_ref", flat=True):
        match = re.fullmatch(r"PR-(\d+)", str(ref or "").strip())
        if match:
            max_ref = max(max_ref, int(match.group(1)))
    return f"PR-{max_ref + 1:03d}"


@csrf_exempt
def auto_create_pr_tickets(request):
    """Auto-create PR tickets for scoped overdue progress reviews."""
    from .models import ProgressReviewTicket

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    body = _json_body(request)
    learners = body.get("learners", [])

    created_list = []
    existing_list = []

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
    }, status=201)


@csrf_exempt
def pr_tickets(request):
    from .models import ProgressReviewTicket

    if request.method == "GET":
        show_archived = request.GET.get("archived", "false").lower() == "true"
        tickets = ProgressReviewTicket.objects.filter(is_archived=show_archived)
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
    for ref in MCMTicket.objects.values_list("ticket_ref", flat=True):
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


def _mcm_overdue_items(history):
    today = date.today()
    overdue = []
    for item in history:
        item_date = parse_date_safe(item.get("date"))
        if not item_date:
            continue
        item_status = str(item.get("status") or "").strip()
        completed = bool(item.get("completed")) or _mcm_completed_status(item_status)
        if item_date < today and not completed:
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
        if item_date >= today and not completed:
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
    next_item = _mcm_next_item(normalized_history)
    completed_items = _mcm_completed_items(normalized_history)
    completed_items.sort(key=lambda item: item["date"])
    last_completed = completed_items[-1] if completed_items else None

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

    body = _json_body(request)
    rows = body.get("rows", [])
    if not isinstance(rows, list):
        return JsonResponse({"error": "rows must be a list"}, status=400)

    active_by_email = {
        ticket.learner_email.strip().lower(): ticket
        for ticket in MCMTicket.objects.filter(is_archived=False).exclude(status="resolved")
    }
    created = []
    updated = []

    for row in rows:
        if not isinstance(row, dict):
            continue
        payload = _mcm_payload_from_summary_row(row)
        if not payload["learner_email"] or not payload["learner_name"] or payload["overdue_count"] <= 0:
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
        tickets = MCMTicket.objects.filter(is_archived=show_archived)
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
    active_by_email = {
        ticket.learner_email.strip().lower(): ticket
        for ticket in EPATicket.objects.filter(is_archived=False).exclude(status="resolved")
    }

    for row in _epa_rows():
        if not _epa_is_active(row):
            continue
        end_date = row.get("End-Date")
        if not end_date or today <= end_date + timedelta(days=7):
            continue
        learner = _epa_learner_dict(row, today)
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

def _otj_ticket_to_dict(ticket):
    return {
        "id": ticket.pk,
        "ticketRef": ticket.ticket_ref,
        "learnerEmail": ticket.learner_email,
        "learnerName": ticket.learner_name,
        "learnerPhone": ticket.learner_phone,
        "organisation": ticket.organisation,
        "programme": ticket.programme,
        "otjMinimum": ticket.otj_minimum,
        "otjCompleted": ticket.otj_completed,
        "otjExpected": ticket.otj_expected,
        "otjStatus": ticket.otj_status,
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
        show_archived = request.GET.get("archived", "false").lower() == "true"
        tickets = OTJTicket.objects.filter(is_archived=show_archived)
        return JsonResponse([_otj_ticket_to_dict(t) for t in tickets], safe=False)

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
        return JsonResponse(_otj_ticket_to_dict(ticket))

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

N8N_EMAIL_WEBHOOK = "https://n8n.srv943390.hstgr.cloud/webhook/email_sender"

@csrf_exempt
def send_email_proxy(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
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
        return JsonResponse(data, status=resp.status_code, safe=False)
    except requests.Timeout:
        return JsonResponse({"error": "n8n webhook timed out"}, status=504)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)
