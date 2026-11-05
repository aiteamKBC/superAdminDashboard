"""Read-only calendar of sessions recorded in the LMS."""

import logging

from django.conf import settings
from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from .lms_reporting_scope import EXCLUDED_COACH_EMAILS, REAL_COACHES_CTE, REAL_LEARNER_WHERE


logger = logging.getLogger(__name__)

SESSION_TYPES = {
    "progress-review": "PR",
    "mcr": "MCM",
    "student-support": "Support",
}


@require_GET
def lms_calendar_events(request):
    if "lms" not in settings.DATABASES:
        return JsonResponse({"error": "LMS database is not configured."}, status=503)

    try:
        with connections["lms"].cursor() as cursor:
            cursor.execute(
                f"""
                {REAL_COACHES_CTE}
                SELECT e.id, p.full_name, p.email, c.coach_name, e.event_type,
                       e.scheduled_date, e.scheduled_time, e.status, e.notes,
                       e.meeting_link, e.graph_web_link
                FROM "Coach".coach_calendar_event AS e
                JOIN real_coaches AS c ON lower(btrim(e.owner_email)) = c.coach_key
                JOIN "Learner".learners AS p ON p.id = e.learner_id
                WHERE {REAL_LEARNER_WHERE}
                  AND e.scheduled_date IS NOT NULL
                  AND e.status IN ('scheduled', 'in-progress', 'awaiting-signature', 'completed')
                ORDER BY e.scheduled_date, e.scheduled_time, e.id
                """,
                [list(EXCLUDED_COACH_EMAILS)],
            )
            rows = cursor.fetchall()
    except DatabaseError:
        logger.exception("Failed to read LMS calendar events")
        return JsonResponse({"error": "Could not load LMS calendar events."}, status=503)

    return JsonResponse(
        [
            {
                "id": row[0],
                "learnerName": row[1],
                "learnerEmail": row[2] or "",
                "coach": row[3],
                "sessionType": SESSION_TYPES.get(row[4], "Other"),
                "eventType": row[4],
                "date": row[5].isoformat(),
                "time": row[6].strftime("%H:%M") if row[6] else "",
                "status": row[7],
                "notes": row[8] or "",
                "bookingUrl": row[9] or row[10] or "",
            }
            for row in rows
        ],
        safe=False,
    )
