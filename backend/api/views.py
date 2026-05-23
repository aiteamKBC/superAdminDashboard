from django.shortcuts import render

# Create your views here.
import json
import requests
from django.http import JsonResponse
from django.db import connection, connections
from django.views.decorators.csrf import csrf_exempt
from datetime import datetime, date
from django.conf import settings

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


def progress_review_summary(request):
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

        for i in range(1, 17):
            planned_key = f"Review Planned Date{i}"
            status_key = f"Review Status{i}"

            planned_date = parse_date_safe(row.get(planned_key))
            planned_status_raw = str(row.get(status_key) or "").strip()
            completed = is_completed_status(planned_status_raw)

            if not planned_date:
                continue

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
        next_pr_date, next_pr_state = split_next_review_status(next_review_raw)

        if not next_pr_date and next_due_date_from_planned:
            next_pr_date = next_due_date_from_planned.strftime("%Y-%m-%d")

        if not next_pr_state and next_due_state_from_planned:
            next_pr_state = next_due_state_from_planned

        results.append({
            "id": row.get("ID"),
            "fullName": row.get("FullName") or "",
            "email": (row.get("Email") or "").strip().lower(),
            "group": row.get("Group") or "",
            "caseOwner": row.get("CaseOwner") or "",
            "lastProgressReview": row.get("Last Progress Review") or "",
            "nextReviewStatus": next_review_raw,
            "nextPrDate": next_pr_date,
            "nextPrState": next_pr_state,
            "overduePrCount": overdue_count,
            "reviewStatus": review_status,
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
    with connections["aptem"].cursor() as cursor:
        cursor.execute("""
            SELECT
                "ID", "FullName", "Email", "CaseOwner", "case_owner_id",
                "Next Review (Status)"
            FROM public.progress_review
            WHERE LOWER(COALESCE("Status", '')) = 'active'
        """)
        columns = [col[0] for col in cursor.description]
        raw_rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

    results = []
    for row in raw_rows:
        next_review_raw = row.get("Next Review (Status)") or ""
        date_part, state_part = split_next_review_status(next_review_raw)

        if state_part.strip().lower() != "scheduled":
            continue

        parsed_date = parse_date_safe(date_part)
        if not parsed_date:
            continue

        results.append({
            "id": row.get("ID"),
            "fullName": row.get("FullName") or "",
            "email": (row.get("Email") or "").strip().lower(),
            "caseOwner": row.get("CaseOwner") or "",
            "caseOwnerId": row.get("case_owner_id"),
            "bookedDates": [{
                "date": parsed_date.strftime("%Y-%m-%d"),
                "status": state_part,
                "completed": False,
            }],
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


def mcr_summary(request):
    with connections["aptem"].cursor() as cursor:
        cursor.execute("""
            SELECT
                "ID",
                "FullName",
                "Email",
                "Status",
                "Subscription Status",
                "CaseOwner",
                "Last MCM",
                "Next MCM",
                "MCM1", "Status1",
                "MCM2", "Status2",
                "MCM3", "Status3",
                "MCM4", "Status4",
                "MCM5", "Status5",
                "MCM6", "Status6",
                "MCM7", "Status7",
                "MCM8", "Status8",
                "MCM9", "Status9",
                "MCM10", "Status10",
                "MCM11", "Status11",
                "MCM12", "Status12",
                "MCM13", "Status13",
                "MCM14", "Status14",
                "MCM15", "Status15",
                "MCM16", "Status16",
                "MCM17", "Status17",
                "MCM18", "Status18",
                "MCM19", "Status19",
                "MCM20", "Status20",
                "MCM21", "Status21",
                "MCM22", "Status22",
                "Last Actually Completed  MCM",
                "Manager Name",
                "Manager Email"
            FROM public."MCR"
        """)
        columns = [col[0] for col in cursor.description]
        raw_rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

    today = date.today()
    results = []

    for row in raw_rows:
        overdue_count = 0
        next_due_date = None

        for i in range(1, 23):
            mcm_date = parse_date_safe(row.get(f"MCM{i}"))
            status_raw = str(row.get(f"Status{i}") or "").strip()
            completed = is_completed_status(status_raw)

            if not mcm_date:
                continue

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
            "managerName": row.get("Manager Name") or "",
            "managerEmail": (row.get("Manager Email") or "").strip().lower(),
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