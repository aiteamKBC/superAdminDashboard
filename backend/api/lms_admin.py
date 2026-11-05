"""LMS learner snapshot for the super admin allocation and performance screen."""

import logging
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET

from .lms_reporting_scope import (
    CURRENT_PROGRAMME_STATUSES,
    EXCLUDED_COACH_EMAILS,
    REAL_COACHES_CTE,
    REAL_LEARNER_WHERE,
)

logger = logging.getLogger(__name__)


@require_GET
def lms_admin_learners(request):
    if "lms" not in settings.DATABASES:
        return JsonResponse({"error": "LMS database is not configured."}, status=503)

    today = timezone.now().astimezone(ZoneInfo("Europe/London")).date()
    try:
        with connections["lms"].cursor() as cursor:
            cursor.execute(
                f"""
                {REAL_COACHES_CTE},
                event_summary AS (
                    SELECT learner_id,
                        MAX(COALESCE(review_completed_at::date, scheduled_date)) FILTER (
                            WHERE event_type = 'progress-review' AND status = 'completed'
                        ) AS last_pr,
                        MIN(target_date) FILTER (
                            WHERE event_type = 'progress-review'
                              AND status NOT IN ('completed', 'cancelled')
                        ) AS next_pr,
                        BOOL_OR(event_type = 'progress-review' AND status = 'scheduled'
                            AND scheduled_date IS NOT NULL) AS pr_booked,
                        MAX(COALESCE(review_completed_at::date, scheduled_date)) FILTER (
                            WHERE event_type = 'mcr' AND status = 'completed'
                        ) AS last_mcm,
                        MIN(target_date) FILTER (
                            WHERE event_type = 'mcr'
                              AND status NOT IN ('completed', 'cancelled')
                        ) AS next_mcm,
                        BOOL_OR(event_type = 'mcr' AND status = 'scheduled'
                            AND scheduled_date IS NOT NULL) AS mcm_booked
                    FROM "Coach".coach_calendar_event
                    GROUP BY learner_id
                ),
                attendance_latest AS (
                    SELECT DISTINCT ON (learner_profile_id)
                        learner_profile_id, attendance_status,
                        (o.scheduled_start AT TIME ZONE 'Europe/London')::date AS attendance_date
                    FROM curriculum.live_session_learner_attendance AS a
                    JOIN curriculum.live_session_occurrences AS o ON o.id = a.occurrence_id
                    WHERE a.learner_profile_id IS NOT NULL
                    ORDER BY a.learner_profile_id, o.scheduled_start DESC, a.id DESC
                ),
                attendance_missed AS (
                    SELECT a.learner_profile_id, COUNT(*) AS missed_last_10_weeks
                    FROM curriculum.live_session_learner_attendance AS a
                    JOIN curriculum.live_session_occurrences AS o ON o.id = a.occurrence_id
                    WHERE a.attendance_status = 'absent'
                      AND (o.scheduled_start AT TIME ZONE 'Europe/London')::date >= %s::date - 70
                      AND (o.scheduled_start AT TIME ZONE 'Europe/London')::date <= %s::date
                    GROUP BY a.learner_profile_id
                )
                SELECT p.id, p.full_name, p.email, p.phone_number,
                    p.programme_status, c.coach_name, c.coach_key,
                    COALESCE(NULLIF(prg.name, ''), NULLIF(u."Target_programme", ''), '') AS programme,
                    COALESCE(coh.cohort_name, '') AS cohort,
                    COALESCE(gr.group_name, '') AS group_name,
                    COALESCE(NULLIF(u."Orgnization", ''), NULLIF(u."Employer", ''), '') AS organisation,
                    COALESCE(u."Line_manager", '') AS manager_name,
                    p.planned_hours, p.target_hours, p.completed_hours, p.otjh_status,
                    p.start_date, p.end_date,
                    e.last_pr, e.next_pr, COALESCE(e.pr_booked, FALSE),
                    e.last_mcm, e.next_mcm, COALESCE(e.mcm_booked, FALSE),
                    a.attendance_status, a.attendance_date,
                    COALESCE(am.missed_last_10_weeks, 0)
                FROM "Learner".learners AS p
                JOIN real_coaches AS c ON lower(btrim(p.coach_email)) = c.coach_key
                LEFT JOIN enrolment."Created_users" AS u ON u.id = p.enrolment_id
                LEFT JOIN curriculum.programmes AS prg ON prg.programme_id = p.programme_id
                LEFT JOIN curriculum.cohorts AS coh ON coh.cohort_id = p.cohort_id
                LEFT JOIN curriculum.groups AS gr ON gr.group_id = p.group_id
                LEFT JOIN event_summary AS e ON e.learner_id = p.id
                LEFT JOIN attendance_latest AS a ON a.learner_profile_id = p.id
                LEFT JOIN attendance_missed AS am ON am.learner_profile_id = p.id
                WHERE {REAL_LEARNER_WHERE}
                ORDER BY c.coach_name, p.full_name, p.id
                """,
                [list(EXCLUDED_COACH_EMAILS), today, today],
            )
            rows = cursor.fetchall()
    except DatabaseError:
        logger.exception("Could not load LMS admin learners")
        return JsonResponse({"error": "Could not load LMS learner data."}, status=502)

    learners = []
    for row in rows:
        status = (row[4] or "").strip().lower()
        learners.append({
            "id": row[0],
            "fullName": row[1],
            "email": row[2],
            "phone": row[3] or "",
            "programStatus": row[4] or "",
            "current": status in CURRENT_PROGRAMME_STATUSES,
            "coach": row[5],
            "coachEmail": row[6],
            "programme": row[7],
            "cohort": row[8],
            "group": row[9],
            "organisation": row[10],
            "managerName": row[11],
            "plannedOtjHours": float(row[12] or 0),
            "targetOtjHours": float(row[13] or 0),
            "completedOtjHours": float(row[14] or 0),
            "otjhStatus": row[15] or "",
            "startDate": row[16].isoformat() if row[16] else "",
            "endDate": row[17].isoformat() if row[17] else "",
            "lastProgressReviewDate": row[18].isoformat() if row[18] else "",
            "nextProgressReviewDue": row[19].isoformat() if row[19] else "",
            "progressReviewBooked": row[20],
            "lastMonthlyMeetingDate": row[21].isoformat() if row[21] else "",
            "nextMonthlyMeetingDue": row[22].isoformat() if row[22] else "",
            "monthlyMeetingBooked": row[23],
            "lastSessionStatus": row[24] or "",
            "lastSessionDate": row[25].isoformat() if row[25] else "",
            "missedLast10Weeks": row[26],
        })

    return JsonResponse({
        "asOf": today.isoformat(),
        "learners": learners,
        "totals": {
            "all": len(learners),
            "current": sum(learner["current"] for learner in learners),
        },
    })
