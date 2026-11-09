"""Canonical read-only OTJH reporting from the LMS learner tables."""

import logging

from django.conf import settings
from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from .lms_reporting_scope import (
    CURRENT_PROGRAMME_STATUSES,
    EXCLUDED_COACH_EMAILS,
    REAL_COACHES_CTE,
    REAL_LEARNER_WHERE,
)

logger = logging.getLogger(__name__)


def load_lms_otjh_rows():
    """Return the one authoritative OTJH snapshot used by every admin screen."""
    if "lms" not in settings.DATABASES:
        raise DatabaseError("LMS database is not configured.")

    with connections["lms"].cursor() as cursor:
        cursor.execute(
            f"""
            {REAL_COACHES_CTE}
            SELECT
                p.id,
                p.full_name,
                p.email,
                p.phone_number,
                p.programme_status,
                c.coach_name,
                c.coach_key,
                COALESCE(NULLIF(prg.name, ''), NULLIF(u."Target_programme", ''), '') AS programme,
                COALESCE(coh.cohort_name, '') AS cohort,
                COALESCE(gr.group_name, '') AS group_name,
                COALESCE(NULLIF(u."Orgnization", ''), NULLIF(u."Employer", ''), '') AS organisation,
                COALESCE(u."Line_manager", '') AS manager_name,
                p.minimum_hours,
                COALESCE(p.planned_hours, 0) AS planned_hours,
                COALESCE(p.completed_hours, 0) AS completed_hours,
                COALESCE(p.target_hours, 0) AS target_hours,
                COALESCE(p.progress_hours, 0) AS progress_hours,
                COALESCE(p.progress_variance, 0) AS progress_variance,
                COALESCE(p.otjh_status, '') AS otjh_status,
                p.start_date,
                p.end_date
            FROM "Learner".learners AS p
            JOIN real_coaches AS c ON lower(btrim(p.coach_email)) = c.coach_key
            LEFT JOIN enrolment."Created_users" AS u ON u.id = p.enrolment_id
            LEFT JOIN curriculum.programmes AS prg ON prg.programme_id = p.programme_id
            LEFT JOIN curriculum.cohorts AS coh ON coh.cohort_id = p.cohort_id
            LEFT JOIN curriculum.groups AS gr ON gr.group_id = p.group_id
            WHERE {REAL_LEARNER_WHERE}
              AND lower(btrim(COALESCE(p.programme_status, ''))) = ANY(%s)
            ORDER BY c.coach_name, p.full_name, p.id
            """,
            [list(EXCLUDED_COACH_EMAILS), list(CURRENT_PROGRAMME_STATUSES)],
        )
        rows = cursor.fetchall()

        # Keep the daily target snapshot separate from the learner/enrolment
        # query. This avoids an expensive cross-schema join while preserving
        # learner_id as the single exact identity key.
        cursor.execute(
            """
            SELECT learner_id, planned_hours, target_hours, start_date,
                planned_end_date, programme_days, elapsed_days, as_of_date,
                status, status_reason, formula_version, calculation_method,
                source_system
            FROM "Learner".learner_target_hours_current
            """
        )
        target_rows = cursor.fetchall()

    targets_by_learner = {
        row[0]: {
            "plannedHours": row[1],
            "targetHours": row[2],
            "startDate": row[3],
            "endDate": row[4],
            "totalDays": row[5],
            "elapsedDays": row[6],
            "asOfDate": row[7],
            "status": row[8],
            "statusReason": row[9],
            "formulaVersion": row[10],
            "calculationMethod": row[11],
            "sourceSystem": row[12],
        }
        for row in target_rows
    }

    results = []
    for row in rows:
        target = targets_by_learner.get(row[0], {})
        start_date = target.get("startDate") or row[19]
        end_date = target.get("endDate") or row[20]
        results.append({
            "id": str(row[0]),
            "fullName": row[1] or "",
            "email": (row[2] or "").strip().lower(),
            "learnerPhone": row[3] or "",
            "phone": row[3] or "",
            "programStatus": row[4] or "",
            "current": True,
            "ownerName": row[5] or "",
            "coach": row[5] or "",
            "ownerEmail": (row[6] or "").strip().lower(),
            "coachEmail": (row[6] or "").strip().lower(),
            "programName": row[7] or "",
            "programme": row[7] or "",
            "cohort": row[8] or "",
            "group": row[9] or "",
            "organizationName": row[10] or "",
            "organisation": row[10] or "",
            "managerName": row[11] or "",
            "otjMinimum": float(row[12] or 0),
            "otjPlanned": float(target.get("plannedHours") or row[13] or 0),
            "otjSubmitted": 0.0,
            "otjCompleted": float(row[14] or 0),
            "otjForecast": 0.0,
            "otjExpected": float(target.get("targetHours") or row[15] or 0),
            "progressHours": str(row[16] or 0),
            "progressVariance": str(row[17] or 0),
            "otjHoursStatus": row[18] or "",
            "startDate": start_date.isoformat() if start_date else None,
            "endDate": end_date.isoformat() if end_date else None,
            "totalDays": target.get("totalDays"),
            "elapsedDays": target.get("elapsedDays"),
            "targetAsOfDate": target["asOfDate"].isoformat() if target.get("asOfDate") else None,
            "targetStatus": target.get("status") or "",
            "targetStatusReason": target.get("statusReason") or "",
            "targetFormulaVersion": target.get("formulaVersion") or "",
            "targetCalculationMethod": target.get("calculationMethod") or "",
            "targetSourceSystem": target.get("sourceSystem") or "",
            # Compatibility fields used by the broader learner screens. Their
            # OTJH values above always come from LMS; absent enrichment is blank.
            "prStatusLast12Weeks": "",
            "mcmStatusLast4Weeks": "",
            "ksbStatus": "",
            "compStatus": "",
            "completedCompPct": "",
            "targetCompPct": "",
            "totalCompCount": None,
            "targetCompCount": None,
            "completedCompCount": None,
            "coachRag": "",
            "managerEmail": "",
            "managerPhone": "",
            "employerRepresentative": "",
            "employerEmail": "",
            "subscriptionStatus": "",
            "levyOrNot": "",
            "workingHours": "",
            "gender": "",
            "disability": "",
        })
    return results


def load_lms_otjh_by_email():
    return {
        row["email"]: row
        for row in load_lms_otjh_rows()
        if row.get("email")
    }


@require_GET
def lms_otjh_summary(request):
    try:
        rows = load_lms_otjh_rows()
    except DatabaseError:
        logger.exception("Could not load canonical LMS OTJH data")
        return JsonResponse({"error": "Could not load LMS OTJH data."}, status=502)

    response = JsonResponse(rows, safe=False)
    response["Cache-Control"] = "private, no-store"
    response["X-OTJH-Source"] = "LMS Learner.learners + Learner.learner_target_hours_current"
    return response
