"""Canonical LMS-backed academic reporting for the Super Admin dashboard."""

from collections import defaultdict
from datetime import timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET

from .lms_otjh import load_lms_otjh_by_email
from .lms_reporting_scope import EXCLUDED_COACH_EMAILS, REAL_COACHES_CTE, REAL_LEARNER_WHERE


LONDON = ZoneInfo("Europe/London")
TERMINAL_EVENT_STATUSES = {"completed", "cancelled"}
PR_CYCLE_WEEKS = 12
COMPLETED_REVIEW_STATUSES = {"completed"}
OPEN_REVIEW_STATUSES = {"scheduled", "in progress", "in-progress", "awaiting signature", "awaitingsignature", "awaiting-signature"}


def _load_completed_prs_from_aptem():
    """Last completed PR per learner email from kbc_coaching_reporting.reviews (Aptem history)."""
    with connections["lms"].cursor() as cursor:
        cursor.execute(
            """
            SELECT learner_email, status, completed_day, planned_date
            FROM kbc_coaching_reporting.reviews
            WHERE kind = 'progress_review'
            """
        )
        latest = {}
        for email, status, completed_day, planned_date in cursor.fetchall():
            if not email or str(status or "").strip().lower() != "completed":
                continue
            when = completed_day or planned_date
            if not when:
                continue
            key = email.strip().lower()
            if not key:
                continue
            prev = latest.get(key)
            if prev is None or when > prev:
                latest[key] = when
        return latest


def _load_learner_lifecycle():
    """Programme start/end + coach per learner email from Learner.learners."""
    with connections["lms"].cursor() as cursor:
        cursor.execute(
            """
            SELECT lower(btrim(l.email)) AS email,
                   l.id, l.enrolment_id,
                   l.start_date, l.end_date,
                   l.coach_name, l.coach_email,
                   l.programme_status, l.programme
            FROM "Learner".learners l
            WHERE l.email IS NOT NULL
            """
        )
        return {
            row[0]: {
                "learner_id": row[1], "enrolment_id": row[2],
                "start_date": row[3], "end_date": row[4],
                "coach_name": row[5] or "", "coach_email": row[6] or "",
                "programme_status": row[7] or "", "programme": row[8] or "",
            }
            for row in cursor.fetchall() if row[0]
        }


def _today():
    return timezone.now().astimezone(LONDON).date()


def _canonical_roster():
    return list(load_lms_otjh_by_email().values())


def _review_events(event_type):
    with connections["lms"].cursor() as cursor:
        cursor.execute(
            """
            SELECT learner_id, event_type, sequence, target_date, scheduled_date,
                   status, review_completed_at, meeting_link, graph_web_link
            FROM "Coach".coach_calendar_event
            WHERE event_type = %s
            ORDER BY learner_id, COALESCE(target_date, scheduled_date), sequence, id
            """,
            [event_type],
        )
        columns = [column[0] for column in cursor.description]
        grouped = defaultdict(list)
        for values in cursor.fetchall():
            row = dict(zip(columns, values))
            grouped[str(row["learner_id"])].append(row)
        return grouped


def _event_date(row):
    return row.get("target_date") or row.get("scheduled_date")


def _completed_date(row):
    value = row.get("review_completed_at")
    return value.astimezone(LONDON).date() if value else row.get("scheduled_date")


def _event_status(row):
    return str(row.get("status") or "").strip().lower()


def _open_events(rows):
    return [row for row in rows if _event_status(row) not in TERMINAL_EVENT_STATUSES]


@require_GET
def lms_progress_review_summary(request):
    if "lms" not in settings.DATABASES:
        return JsonResponse({"error": "LMS database is not configured."}, status=503)
    today = _today()
    cycle = timedelta(weeks=PR_CYCLE_WEEKS)
    learner_filter = str(request.GET.get("learner_email") or request.GET.get("email") or "").strip().lower()
    try:
        roster = _canonical_roster()
        events = _review_events("progress-review")
        aptem_completed = _load_completed_prs_from_aptem()
        lifecycle = _load_learner_lifecycle()
    except DatabaseError:
        return JsonResponse({"error": "Could not load LMS progress review data."}, status=502)

    results = []
    for learner in roster:
        email = str(learner.get("email") or "").strip().lower()
        if learner_filter and email != learner_filter:
            continue
        rows = events.get(str(learner.get("id") or ""), [])
        open_rows = _open_events(rows)
        future = [row for row in open_rows if _event_date(row) and _event_date(row) >= today]
        overdue_events = [row for row in open_rows if _event_date(row) and _event_date(row) < today]
        completed_events = [row for row in rows if _event_status(row) == "completed" and _completed_date(row)]

        last_completed_event = max((_completed_date(row) for row in completed_events), default=None)
        last_completed_aptem = aptem_completed.get(email)
        last_completed = max([d for d in (last_completed_event, last_completed_aptem) if d], default=None)

        life = lifecycle.get(email, {})
        start_date = life.get("start_date")
        end_date = life.get("end_date")

        # Due by the 12-week rule, anchored to last PR or (if none) the start date.
        anchor = last_completed or start_date
        due_by_cycle = bool(anchor and (anchor + cycle) <= today)
        within_programme = (not start_date or start_date <= today) and (not end_date or end_date >= today)
        has_future_booking = bool(future)
        booking_required = due_by_cycle and within_programme and not has_future_booking

        latest_due_event = max((_event_date(row) for row in overdue_events), default=None)
        next_row = min(future, key=_event_date) if future else None
        next_due_date = (anchor + cycle) if anchor else None

        planned_dates = [{
            "date": _event_date(row).isoformat() if _event_date(row) else "",
            "status": str(row.get("status") or ""),
            "completed": _event_status(row) == "completed",
            "isPast": bool(_event_date(row) and _event_date(row) < today),
        } for row in rows if _event_date(row)]

        if booking_required:
            review_status = "Due"
        elif has_future_booking:
            review_status = "Booked"
        else:
            review_status = "Ahead"

        results.append({
            "id": learner.get("id"),
            "fullName": learner.get("fullName") or "",
            "email": email,
            "group": learner.get("group") or "",
            "caseOwner": life.get("coach_name") or learner.get("ownerName") or learner.get("coach") or "",
            "caseOwnerEmail": life.get("coach_email") or "",
            "phone": learner.get("learnerPhone") or learner.get("phone") or "",
            "organisation": learner.get("organizationName") or learner.get("organisation") or "",
            "programme": life.get("programme") or learner.get("programme") or "",
            "programmeStatus": life.get("programme_status") or "",
            "startDate": start_date.isoformat() if start_date else "",
            "endDate": end_date.isoformat() if end_date else "",
            "lastActuallyCompletedPr": last_completed.isoformat() if last_completed else "",
            "lastProgressReview": last_completed.isoformat() if last_completed else "",
            "lastPrSource": (
                "lms.coach_calendar_event" if last_completed and last_completed == last_completed_event
                else ("aptem.kbc_coaching_reporting.reviews" if last_completed else "")
            ),
            "nextReviewStatus": str(next_row.get("status") or "") if next_row else "",
            "duePrDate": (latest_due_event.isoformat() if latest_due_event
                          else (next_due_date.isoformat() if booking_required and next_due_date else "")),
            "duePrState": "Overdue" if latest_due_event else ("Booking Required" if booking_required else ""),
            "nextPrDate": _event_date(next_row).isoformat() if next_row else "",
            "nextPrState": str(next_row.get("status") or "") if next_row else "",
            "overduePrCount": (1 if booking_required else 0) + len(overdue_events),
            "reviewStatus": review_status,
            "bookingRequired": booking_required,
            "weeksSinceLastPr": ((today - anchor).days // 7) if anchor else None,
            "plannedDates": planned_dates,
            "dataSource": "lms.coach_calendar_event+aptem.reviews",
        })
    return JsonResponse(results, safe=False)


@require_GET
def lms_progress_review_booked(request):
    summary = lms_progress_review_summary(request)
    if summary.status_code != 200:
        return summary
    import json
    rows = json.loads(summary.content)
    booked = []
    for row in rows:
        scheduled = [item for item in row["plannedDates"] if item["status"].lower() == "scheduled"]
        if not scheduled:
            continue
        scheduled.sort(key=lambda item: item["date"])
        booked.append({
            "id": row["id"], "fullName": row["fullName"], "email": row["email"],
            "caseOwner": row["caseOwner"], "caseOwnerId": None,
            "bookedDates": scheduled, "nextBookedDate": scheduled[0]["date"],
            "dataSource": "lms.coach_calendar_event",
        })
    return JsonResponse(booked, safe=False)


@require_GET
def lms_mcr_summary(request):
    if "lms" not in settings.DATABASES:
        return JsonResponse({"error": "LMS database is not configured."}, status=503)
    today = _today()
    try:
        roster = _canonical_roster()
        events = _review_events("mcr")
    except DatabaseError:
        return JsonResponse({"error": "Could not load LMS monthly meeting data."}, status=502)

    results = []
    for learner in roster:
        rows = events.get(str(learner.get("id") or ""), [])
        open_rows = _open_events(rows)
        overdue = [row for row in open_rows if _event_date(row) and _event_date(row) < today]
        future = [row for row in open_rows if _event_date(row) and _event_date(row) >= today]
        completed = [row for row in rows if _event_status(row) == "completed" and _completed_date(row)]
        last_completed = max((_completed_date(row) for row in completed), default=None)
        latest_due = max((_event_date(row) for row in overdue), default=None)
        next_row = min(future, key=_event_date) if future else None
        history = [{
            "date": _event_date(row).isoformat() if _event_date(row) else "",
            "status": str(row.get("status") or ""),
            "completed": _event_status(row) == "completed",
        } for row in rows if _event_date(row)]
        results.append({
            "id": learner.get("id"), "fullName": learner.get("fullName") or "",
            "email": str(learner.get("email") or "").strip().lower(),
            "status": learner.get("programStatus") or "", "subscriptionStatus": "",
            "caseOwner": learner.get("ownerName") or learner.get("coach") or "",
            "lastMcm": last_completed.isoformat() if last_completed else "",
            "nextMcm": _event_date(next_row).isoformat() if next_row else "",
            "lastActuallyCompletedMcm": last_completed.isoformat() if last_completed else "",
            "overdueMcmCount": len(overdue),
            "dueMcmDate": latest_due.isoformat() if latest_due else None,
            "nextDueDate": _event_date(next_row).isoformat() if next_row else None,
            "mcrStatus": "Due" if overdue else "Ahead", "mcmDates": history,
            "managerName": learner.get("managerName") or "", "managerEmail": learner.get("managerEmail") or "",
            "programme": learner.get("programName") or learner.get("programme") or "",
            "organisationName": learner.get("organizationName") or learner.get("organisation") or "",
            "dataSource": "lms.coach_calendar_event",
        })
    return JsonResponse(results, safe=False)


@require_GET
def lms_epa_summary(request):
    if "lms" not in settings.DATABASES:
        return JsonResponse({"error": "LMS database is not configured."}, status=503)
    today = _today()
    try:
        with connections["lms"].cursor() as cursor:
            cursor.execute(f"""
                {REAL_COACHES_CTE}
                SELECT p.id, p.full_name, lower(btrim(p.email)), p.phone_number,
                       p.programme_status, c.coach_name,
                       COALESCE(NULLIF(prg.name, ''), NULLIF(u."Target_programme", ''), ''),
                       COALESCE(NULLIF(u."Orgnization", ''), NULLIF(u."Employer", ''), ''),
                       COALESCE(u."Line_manager", ''),
                       p.end_date, p.gateway_review_date,
                       p.alert_notify_for_epa, p.enter_epa, p.otjh_status
                FROM "Learner".learners p
                JOIN real_coaches c ON lower(btrim(p.coach_email)) = c.coach_key
                LEFT JOIN enrolment."Created_users" u ON u.id = p.enrolment_id
                LEFT JOIN curriculum.programmes prg ON prg.programme_id = p.programme_id
                WHERE {REAL_LEARNER_WHERE}
                  AND lower(btrim(p.programme_status)) IN ('active', 'delivery')
            """, [list(EXCLUDED_COACH_EMAILS)])
            rows = cursor.fetchall()
    except DatabaseError:
        return JsonResponse({"error": "Could not load LMS EPA data."}, status=502)

    close_to_epa, overdue, entered = [], [], []
    for row in rows:
        end_date = row[9]
        item = {
            "id": row[0], "fullName": row[1] or "", "email": row[2] or "", "phone": row[3] or "",
            "programStatus": row[4] or "", "coach": row[5] or "", "programme": row[6] or "",
            "organisation": row[7] or "", "managerName": row[8] or "", "managerEmail": "",
            "endDate": end_date.isoformat() if end_date else None,
            "daysUntilEnd": (end_date - today).days if end_date else None,
            "daysOverdue": max(0, (today - end_date).days - 7) if end_date else 0,
            "gatewayReviewDate": row[10].isoformat() if row[10] else None,
            "alertNotifyForEpa": row[11].isoformat() if row[11] else None,
            "enterEpaDate": row[12].isoformat() if row[12] else None,
            "otjHoursStatus": row[13] or "", "dataSource": "lms.learner.learners",
        }
        if row[12]:
            entered.append(item)
        if end_date and 0 <= (end_date - today).days <= 60:
            close_to_epa.append(item)
        if end_date and today > end_date + timedelta(days=7):
            overdue.append(item)
    close_to_epa.sort(key=lambda item: item["endDate"] or "")
    overdue.sort(key=lambda item: item["daysOverdue"], reverse=True)
    entered.sort(key=lambda item: item["enterEpaDate"] or "")
    return JsonResponse({
        "closeToEpa": close_to_epa, "epaOverdue": overdue, "enteredEpa": entered,
        "closeToEpaCount": len(close_to_epa), "epaOverdueCount": len(overdue),
        "enteredEpaCount": len(entered), "dataSource": "lms.learner.learners",
    })


@require_GET
def lms_learner_marking_summary(request):
    """Learner-level view of the same LMS submission queue used by Marking."""
    if "lms" not in settings.DATABASES:
        return JsonResponse({"error": "LMS database is not configured."}, status=503)
    try:
        with connections["lms"].cursor() as cursor:
            cursor.execute(f"""
                {REAL_COACHES_CTE}
                SELECT p.id, p.full_name, lower(btrim(p.email)), c.coach_name,
                       COUNT(s.id) FILTER (WHERE s.status IN ('submitted_for_tutor_review', 'escalated')),
                       COUNT(s.id) FILTER (WHERE s.status IN ('accepted', 'partial')),
                       COUNT(s.id) FILTER (WHERE s.status IN ('referred', 'rejected')),
                       COUNT(s.id), MAX(s.submitted_at)
                FROM "Learner".learners p
                JOIN real_coaches c ON lower(btrim(p.coach_email)) = c.coach_key
                LEFT JOIN "Learner".learning_reflection_submissions s
                  ON p.enrolment_id::text = s.learner_id::text
                WHERE {REAL_LEARNER_WHERE}
                  AND lower(btrim(p.programme_status)) IN ('active', 'delivery')
                GROUP BY p.id, p.full_name, p.email, c.coach_name
                ORDER BY c.coach_name, p.full_name
            """, [list(EXCLUDED_COACH_EMAILS)])
            rows = cursor.fetchall()
    except DatabaseError:
        return JsonResponse({"error": "Could not load LMS learner marking data."}, status=502)

    return JsonResponse([{
        "learnerId": str(row[0]), "fullName": row[1] or "", "email": row[2] or "",
        "caseOwner": row[3] or "", "caseOwnerId": None,
        "countEvidencePending": int(row[4] or 0), "evidenceAccepted": int(row[5] or 0),
        "evidenceReferred": int(row[6] or 0), "totalEvidence": int(row[7] or 0),
        "lastSubDate": row[8].date().isoformat() if row[8] else "",
        "lastFileSubmitDate": row[8].date().isoformat() if row[8] else "",
        "status": "Active", "dataSource": "lms.learning_reflection_submissions",
    } for row in rows], safe=False)
