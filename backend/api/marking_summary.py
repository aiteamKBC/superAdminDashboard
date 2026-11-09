"""Read-only reporting over the LMS coach marking queue."""

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


ASSIGNMENT_TYPES = ("assignment", "extra_activity")
PENDING_STATUSES = ("submitted_for_tutor_review", "escalated")
DECIDED_STATUSES = ("accepted", "partial", "referred", "rejected")
logger = logging.getLogger(__name__)


@require_GET
def lms_marking_summary(request):
    if "lms" not in settings.DATABASES:
        return JsonResponse({"error": "LMS database is not configured."}, status=503)

    # Use the same current learner and real-coach scope as every LMS dashboard.
    # Decisions are attributed to reviewed_by, which can differ from that owner.
    today = timezone.now().astimezone(ZoneInfo("Europe/London")).date()
    try:
        with connections["lms"].cursor() as cursor:
            cursor.execute(
                f"""
                {REAL_COACHES_CTE},
                learner_roster AS (
                    SELECT p.*,
                        COALESCE(
                            NULLIF(lower(btrim(p.coach_email)), ''),
                            'name:' || NULLIF(
                                lower(regexp_replace(btrim(p.coach_name), '\\s+', ' ', 'g')),
                                ''
                            ),
                            'unassigned'
                        ) AS roster_coach_key,
                        COALESCE(
                            NULLIF(regexp_replace(btrim(p.coach_name), '\\s+', ' ', 'g'), ''),
                            NULLIF(btrim(p.coach_email), ''),
                            'Unassigned'
                        ) AS roster_coach_name
                    FROM "Learner".learners AS p
                    JOIN real_coaches AS c ON lower(btrim(p.coach_email)) = c.coach_key
                    WHERE {REAL_LEARNER_WHERE}
                )
                SELECT
                    p.roster_coach_key,
                    p.roster_coach_name,
                    COUNT(DISTINCT p.id) AS total_learners,
                    COUNT(DISTINCT p.id) FILTER (
                        WHERE lower(btrim(p.programme_status)) = ANY(%s)
                    ) AS current_learners,
                    COUNT(DISTINCT p.id) FILTER (WHERE s.id IS NOT NULL) AS learners_awaiting_review,
                    COUNT(s.id) FILTER (WHERE lower(btrim(s.activity_type)) = ANY(%s)) AS assignments,
                    COUNT(s.id) FILTER (WHERE lower(btrim(s.activity_type)) <> ALL(%s)) AS reflections,
                    MIN(s.submitted_at) AS oldest_submitted_at,
                    MAX(s.submitted_at) AS newest_submitted_at
                FROM learner_roster AS p
                LEFT JOIN "Learner".learning_reflection_submissions AS s
                  ON p.enrolment_id::text = s.learner_id::text AND s.status = ANY(%s)
                GROUP BY p.roster_coach_key, p.roster_coach_name
                ORDER BY COUNT(s.id) DESC, p.roster_coach_name
                """,
                [list(EXCLUDED_COACH_EMAILS), list(CURRENT_PROGRAMME_STATUSES), list(ASSIGNMENT_TYPES),
                 list(ASSIGNMENT_TYPES), list(PENDING_STATUSES)],
            )
            pending_rows = cursor.fetchall()

            cursor.execute(
                f"""
                {REAL_COACHES_CTE}
                SELECT
                    COALESCE(NULLIF(btrim(s.reviewed_by), ''), 'Unknown reviewer') AS reviewer,
                    COUNT(*) FILTER (WHERE s.status IN ('accepted', 'partial')) AS accepted,
                    COUNT(*) FILTER (WHERE s.status IN ('referred', 'rejected')) AS returned,
                    COUNT(*) FILTER (WHERE lower(btrim(s.activity_type)) = ANY(%s)) AS assignments,
                    COUNT(*) FILTER (WHERE lower(btrim(s.activity_type)) <> ALL(%s)) AS reflections,
                    COUNT(*) FILTER (WHERE %s::date - (s.reviewed_at AT TIME ZONE 'Europe/London')::date = 0) AS day0,
                    COUNT(*) FILTER (WHERE %s::date - (s.reviewed_at AT TIME ZONE 'Europe/London')::date = 1) AS day1,
                    COUNT(*) FILTER (WHERE %s::date - (s.reviewed_at AT TIME ZONE 'Europe/London')::date = 2) AS day2,
                    COUNT(*) FILTER (WHERE %s::date - (s.reviewed_at AT TIME ZONE 'Europe/London')::date = 3) AS day3,
                    COUNT(*) FILTER (WHERE %s::date - (s.reviewed_at AT TIME ZONE 'Europe/London')::date = 4) AS day4,
                    COUNT(*) FILTER (WHERE %s::date - (s.reviewed_at AT TIME ZONE 'Europe/London')::date = 5) AS day5,
                    COUNT(*) FILTER (WHERE %s::date - (s.reviewed_at AT TIME ZONE 'Europe/London')::date = 6) AS day6,
                    COUNT(*) FILTER (WHERE %s::date - (s.reviewed_at AT TIME ZONE 'Europe/London')::date = 7) AS day7,
                    MAX(s.reviewed_at) AS last_reviewed_at
                FROM "Learner".learning_reflection_submissions AS s
                JOIN "Learner".learners AS p ON p.enrolment_id::text = s.learner_id::text
                JOIN real_coaches AS c ON lower(btrim(p.coach_email)) = c.coach_key
                WHERE s.status = ANY(%s)
                  AND s.reviewed_at IS NOT NULL
                  AND {REAL_LEARNER_WHERE}
                  AND lower(COALESCE(s.reviewed_by, '')) !~ 'test|qa|demo|dummy'
                GROUP BY reviewer
                ORDER BY COUNT(*) DESC, reviewer
                """,
                [list(EXCLUDED_COACH_EMAILS), list(ASSIGNMENT_TYPES), list(ASSIGNMENT_TYPES), *([today] * 8), list(DECIDED_STATUSES)],
            )
            reviewed_rows = cursor.fetchall()
    except DatabaseError:
        logger.exception("Could not load LMS marking summary")
        return JsonResponse({"error": "Could not load LMS marking data."}, status=502)

    pending = [{
        "key": row[0],
        "coach": row[1],
        "totalLearners": row[2],
        "currentLearners": row[3],
        "learnersAwaitingReview": row[4],
        "assignments": row[5],
        "reflections": row[6],
        "total": row[5] + row[6],
        "oldestSubmittedAt": row[7].isoformat() if row[7] else None,
        "newestSubmittedAt": row[8].isoformat() if row[8] else None,
    } for row in pending_rows]
    reviewed = [{
        "reviewer": row[0],
        "accepted": row[1],
        "returned": row[2],
        "assignments": row[3],
        "reflections": row[4],
        "total": row[1] + row[2],
        "days": list(row[5:13]),
        "lastReviewedAt": row[13].isoformat() if row[13] else None,
    } for row in reviewed_rows]
    return JsonResponse({
        "asOf": today.isoformat(),
        "timezone": "Europe/London",
        "pending": pending,
        "reviewed": reviewed,
        "totals": {
            "totalLearners": sum(row["totalLearners"] for row in pending),
            "currentLearners": sum(row["currentLearners"] for row in pending),
            "learnersAwaitingReview": sum(row["learnersAwaitingReview"] for row in pending),
            "pendingAssignments": sum(row["assignments"] for row in pending),
            "pendingReflections": sum(row["reflections"] for row in pending),
            "pending": sum(row["total"] for row in pending),
            "accepted": sum(row["accepted"] for row in reviewed),
            "returned": sum(row["returned"] for row in reviewed),
            "reviewed": sum(row["total"] for row in reviewed),
            "reviewedLastEightDays": sum(sum(row["days"]) for row in reviewed),
            "lastReviewedAt": max((row["lastReviewedAt"] for row in reviewed if row["lastReviewedAt"]), default=None),
        },
    })
