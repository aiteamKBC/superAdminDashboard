from django.shortcuts import render

# Create your views here.
import json
import requests
from django.http import JsonResponse
from django.db import connection, connections
from django.contrib.auth import authenticate, get_user_model, login as django_login, logout as django_logout
from django.views.decorators.csrf import csrf_exempt
from datetime import datetime, date
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
                "key"
            FROM public.kbc_attendance
            ORDER BY "Email", "date" ASC
        """)
        columns = [col[0] for col in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

    grouped = defaultdict(lambda: {"fullName": "", "records": []})

    for row in rows:
        email = (row.get("Email") or "").strip().lower()
        if not email:
            continue
        if not grouped[email]["fullName"]:
            grouped[email]["fullName"] = row.get("FullName") or ""
        grouped[email]["records"].append({
            "date": row["date"].isoformat() if row.get("date") else None,
            "attendance": row.get("Attendance"),
            "module": row.get("module") or "",
            "key": row.get("key") or "",
        })

    results = []
    for email, data in grouped.items():
        if not data["records"]:
            continue
        extras = learner_extras.get(email, {})
        results.append({
            "email": email,
            "fullName": data["fullName"],
            "phone": extras.get("phone", ""),
            "organisation": extras.get("organisation", ""),
            "aptemProgramme": extras.get("programme", ""),
            "ownerName": extras.get("owner_name", ""),
            "records": data["records"],
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


# KBC API Proxy Endpoint
def fetch_all_coaches_analytics(request):
    """
    Fetches all coaches analytics data from the KBC API.
    This endpoint proxies requests to the external KBC API.
    """
    try:
        api_key = getattr(settings, 'KBC_API_KEY', '')
        api_base_url = getattr(settings, 'KBC_API_BASE_URL', 'https://api.kentbusinesscollege.net')
        
        if not api_key:
            return JsonResponse({"error": "KBC API key not configured"}, status=500)
        
        # Make request to KBC API
        response = requests.get(
            f"{api_base_url.rstrip('/')}/api/coaches/all",
            headers={
                "x-api-key": api_key,
                "Accept": "application/json",
            },
            timeout=30,
        )
        
        if response.status_code != 200:
            return JsonResponse({
                "error": f"KBC API returned status {response.status_code}",
                "details": response.text[:500]  # Limit response size
            }, status=response.status_code)
        
        # Return the data from KBC API
        return JsonResponse(response.json(), safe=False)
        
    except requests.exceptions.Timeout:
        return JsonResponse({"error": "KBC API request timed out"}, status=504)
    except requests.exceptions.RequestException as e:
        return JsonResponse({"error": f"Failed to connect to KBC API: {str(e)}"}, status=502)
    except Exception as e:
        return JsonResponse({"error": f"Internal server error: {str(e)}"}, status=500)


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


@csrf_exempt
def auto_create_attendance_tickets(request):
    """Auto-create tickets for absent learners in a given week if no ticket exists yet."""
    from .models import AttendanceTicket
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    body = _json_body(request)
    learners = body.get("learners", [])

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
            existing_list.append({
                "email": email,
                "id": existing.pk,
                "ticketRef": existing.ticket_ref,
                "status": existing.status,
                "created": False,
            })
        else:
            ticket = AttendanceTicket.objects.create(
                ticket_ref="ATT-TMP",
                learner_email=email,
                learner_name=str(learner.get("name") or "").strip(),
                learner_phone=str(learner.get("phone") or "").strip(),
                organisation=str(learner.get("organisation") or "").strip(),
                programme=str(learner.get("programme") or "").strip(),
                attendance_date=att_date,
                attendance_module=str(learner.get("attendance_module") or "").strip(),
                risk="amber",
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

        ticket = AttendanceTicket.objects.create(
            ticket_ref="ATT-TMP",
            learner_email=str(body.get("learner_email", "")).strip().lower(),
            learner_name=str(body.get("learner_name", "")).strip(),
            learner_phone=str(body.get("learner_phone", "")).strip(),
            organisation=str(body.get("organisation", "")).strip(),
            programme=str(body.get("programme", "")).strip(),
            attendance_date=att_date,
            attendance_module=str(body.get("attendance_module", "")).strip(),
            risk=str(body.get("risk", "green")).strip(),
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
            next_pr_date=next_pr_date,
            is_archived=False,
        ).first()

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
            ticket_ref="PR-TMP",
            learner_email=email,
            learner_name=name,
            learner_phone=str(learner.get("phone") or "").strip(),
            organisation=str(learner.get("organisation") or "").strip(),
            programme=str(learner.get("programme") or "").strip(),
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
        ticket.ticket_ref = f"PR-{ticket.pk:03d}"
        ticket.save(update_fields=["ticket_ref"])
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
            ticket_ref="PR-TMP",
            learner_email=str(body.get("learner_email", "")).strip().lower(),
            learner_name=str(body.get("learner_name", "")).strip(),
            learner_phone=str(body.get("learner_phone", "")).strip(),
            organisation=str(body.get("organisation", "")).strip(),
            programme=str(body.get("programme", "")).strip(),
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
        ticket.ticket_ref = f"PR-{ticket.pk:03d}"
        ticket.save(update_fields=["ticket_ref"])
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


def _mcm_evidence_file_to_dict(f, request):
    return {
        "id": f.pk,
        "name": f.original_name,
        "url": request.build_absolute_uri(f.file.url),
        "mimeType": f.mime_type,
        "uploadedAt": f.uploaded_at.isoformat(),
    }


@csrf_exempt
def mcm_tickets(request):
    from .models import MCMTicket
    if request.method == "GET":
        show_archived = request.GET.get("archived", "false").lower() == "true"
        tickets = MCMTicket.objects.filter(is_archived=show_archived)
        return JsonResponse([_mcm_ticket_to_dict(t) for t in tickets], safe=False)
    if request.method == "POST":
        body = _json_body(request)
        if not body.get("learner_email") or not body.get("learner_name"):
            return JsonResponse({"error": "learner_email and learner_name are required"}, status=400)
        ticket = MCMTicket.objects.create(
            ticket_ref="MCM-TMP",
            learner_email=str(body.get("learner_email", "")).strip().lower(),
            learner_name=str(body.get("learner_name", "")).strip(),
            learner_phone=str(body.get("learner_phone", "")).strip(),
            organisation=str(body.get("organisation", "")).strip(),
            programme=str(body.get("programme", "")).strip(),
            coach_name=str(body.get("coach_name", "")).strip(),
            overdue_count=int(body.get("overdue_count") or 0),
            next_mcm_date=str(body.get("next_mcm_date", "")).strip(),
            last_mcm_date=str(body.get("last_mcm_date", "")).strip(),
            mcm_status=str(body.get("mcm_status", "")).strip(),
            risk=str(body.get("risk", "amber")).strip(),
            status=str(body.get("status", "new")).strip(),
            assigned_owner=str(body.get("assigned_owner", "")).strip(),
            action=str(body.get("action", "")).strip(),
            notes=str(body.get("notes", "")).strip(),
            escalated=bool(body.get("escalated", False)),
            created_by=str(body.get("created_by", "System")).strip(),
        )
        ticket.ticket_ref = f"MCM-{ticket.pk:03d}"
        ticket.save(update_fields=["ticket_ref"])
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
        str_fields = ["learner_name", "learner_phone", "organisation", "programme",
                      "coach_name", "mcm_status", "next_mcm_date", "last_mcm_date",
                      "risk", "status", "assigned_owner", "action", "notes"]
        for f in str_fields:
            if f in body:
                setattr(ticket, f, str(body[f]).strip())
        if "overdue_count" in body:
            ticket.overdue_count = int(body["overdue_count"] or 0)
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


@csrf_exempt
def otj_tickets(request):
    from .models import OTJTicket

    if request.method == "GET":
        show_archived = request.GET.get("archived", "false").lower() == "true"
        tickets = OTJTicket.objects.filter(is_archived=show_archived)
        return JsonResponse([_otj_ticket_to_dict(t) for t in tickets], safe=False)

    if request.method == "POST":
        body = _json_body(request)
        if not body.get("learner_email") or not body.get("learner_name"):
            return JsonResponse({"error": "learner_email and learner_name are required"}, status=400)

        ticket = OTJTicket.objects.create(
            ticket_ref="OTJ-TMP",
            learner_email=str(body.get("learner_email", "")).strip().lower(),
            learner_name=str(body.get("learner_name", "")).strip(),
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
        ticket.ticket_ref = f"OTJ-{ticket.pk:03d}"
        ticket.save(update_fields=["ticket_ref"])
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
