"""Read-only Super Admin reporting for the shared Engagement Centre tables.

The Engagement Centre owns these tables and all operational writes.  This
module deliberately uses SELECT statements only so the Super Admin can audit
the team without becoming a second call-processing application.
"""

import json
from functools import wraps
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import connection
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET


LONDON = ZoneInfo("Europe/London")
FAILED_RESULTS = ("no_answer", "missed", "busy", "voicemail", "rejected")
SYSTEM_CUTOFF = date(2026, 9, 1)


def _admin_only(request):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Authentication required"}, status=401)
    if not (request.user.is_staff or request.user.is_superuser):
        return JsonResponse({"error": "Super Admin access required"}, status=403)
    return None


def admin_api(view):
    """Return JSON authorization errors for every Super Admin API view."""
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        denied = _admin_only(request)
        if denied:
            return denied
        return view(request, *args, **kwargs)
    return wrapped


def _table_exists(cursor, name):
    cursor.execute("SELECT to_regclass(%s)", [f"public.{name}"])
    return cursor.fetchone()[0] is not None


def _period(request):
    # Reuse the exact month validation and labels used by Activity Report.
    from .views import _communication_report_bounds

    month = str(request.GET.get("month") or timezone.now().astimezone(LONDON).strftime("%Y-%m")).strip()
    start, end, label = _communication_report_bounds(month)
    if start is None:
        start = datetime.combine(SYSTEM_CUTOFF, time.min, tzinfo=LONDON)
        end = timezone.now() + timedelta(seconds=1)
    return month, start, end, label


def _working_days(start, end):
    """Elapsed weekdays in the selected range, used only as a target guide."""
    today = timezone.now().astimezone(LONDON).date()
    last = min((end - timedelta(microseconds=1)).astimezone(LONDON).date(), today)
    day = start.astimezone(LONDON).date()
    total = 0
    while day <= last:
        if day.weekday() < 5:
            total += 1
        day += timedelta(days=1)
    return total


def _verified_calls_cte(include_event_calls):
    event_sql = """
        UNION ALL
        SELECT
            z.id AS call_id,
            NULL::bigint AS intent_id,
            eh.agent_id,
            NULL::bigint AS match_id,
            NULL::text AS learner_email,
            z.started_at AS period_at,
            z.started_at AS zoom_started_at,
            z.source_account,
            z.zoom_account_id,
            z.history_id,
            z.call_id AS zoom_call_id,
            z.started_at,
            z.answered_at,
            z.ended_at,
            z.duration_seconds,
            z.result,
            z.direction,
            z.caller_number,
            z.caller_name,
            z.callee_number,
            z.callee_name,
            ''::text AS voicemail,
            TRUE AS event_call,
            TRUE AS matched,
            TRUE AS form_saved
        FROM dashboard_zoom_phone_call z
        INNER JOIN callcenter_event_call eh ON eh.call_id = z.id
        INNER JOIN callcenter_agent event_agent ON event_agent.id = eh.agent_id
        WHERE z.direction = 'outbound'
          AND z.source_account = event_agent.zoom_account
          AND NOT EXISTS (
              SELECT 1
              FROM callcenter_call_intent existing_intent
              WHERE existing_intent.matched_call_id = z.id
                AND existing_intent.agent_id = eh.agent_id
          )
    """ if include_event_calls else ""
    return f"""
        WITH verified_calls AS (
            SELECT DISTINCT
                COALESCE(z.id, -ci.id) AS call_id,
                ci.id AS intent_id,
                ci.agent_id,
                cm.id AS match_id,
                ci.learner_email,
                ci.created_at AS period_at,
                z.started_at AS zoom_started_at,
                z.source_account,
                z.zoom_account_id,
                z.history_id,
                z.call_id AS zoom_call_id,
                CASE WHEN z.direction = 'inbound' THEN z.started_at ELSE ci.created_at END AS started_at,
                z.answered_at,
                z.ended_at,
                CASE WHEN z.result = 'answered' THEN z.duration_seconds ELSE 0 END AS duration_seconds,
                COALESCE(
                    z.result,
                    CASE WHEN ci.created_at > NOW() - INTERVAL '30 minutes' THEN 'waiting' ELSE 'not_matched' END
                ) AS result,
                COALESCE(z.direction, 'outbound') AS direction,
                z.caller_number,
                z.caller_name,
                COALESCE(z.callee_number, ci.number) AS callee_number,
                z.callee_name,
                COALESCE(cm.voicemail, '') AS voicemail,
                FALSE AS event_call,
                z.id IS NOT NULL AS matched,
                (
                    EXISTS (
                        SELECT 1 FROM callcenter_event saved_event
                        WHERE saved_event.kind = 'call_saved'
                          AND saved_event.data->>'intent_id' = ci.id::text
                    )
                    OR EXISTS (
                        SELECT 1 FROM callcenter_event impact_event
                        WHERE impact_event.kind IN ('outcome', 'outcome_pending', 'not_discussed', 'optional_outcome')
                          AND impact_event.data->>'intent_id' = ci.id::text
                    )
                    OR EXISTS (
                        SELECT 1 FROM callcenter_case_call saved_case
                        WHERE saved_case.match_id = cm.id
                          AND NULLIF(BTRIM(saved_case.outcome), '') IS NOT NULL
                    )
                ) AS form_saved
            FROM callcenter_call_intent ci
            INNER JOIN callcenter_agent system_agent ON system_agent.id = ci.agent_id
            LEFT JOIN dashboard_zoom_phone_call z ON z.id = ci.matched_call_id
            LEFT JOIN callcenter_call_match cm
              ON cm.call_id = z.id
             AND cm.agent_id = ci.agent_id
            {event_sql}
        )
    """


def _iso(value):
    return value.isoformat() if value else None


def _rows(cursor):
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, values)) for values in cursor.fetchall()]


def _json_array(value):
    """Normalize JSON/JSONB arrays across psycopg decoder configurations."""
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
            return decoded if isinstance(decoded, list) else []
        except (TypeError, ValueError):
            return []
    return []


def _attention(agent):
    notes = []
    if agent["openSlaBreaches"]:
        notes.append({"key": "sla", "level": "critical", "label": f"{agent['openSlaBreaches']} open SLA breach(es)"})
    if agent["overdueFollowups"]:
        notes.append({"key": "followup", "level": "critical", "label": f"{agent['overdueFollowups']} overdue follow-up(s)"})
    if agent["missingOutcomes"]:
        notes.append({"key": "outcome", "level": "warning", "label": f"{agent['missingOutcomes']} call form(s) incomplete"})
    if agent["missingRecordings"]:
        notes.append({"key": "recording", "level": "warning", "label": f"{agent['missingRecordings']} answered call(s) without recording"})
    if agent["badCalls"]:
        notes.append({"key": "quality", "level": "warning", "label": f"{agent['badCalls']} call(s) rated bad — human review required"})
    if agent["targetSeconds"] and agent["talkSeconds"] < agent["targetSeconds"] * 0.7:
        notes.append({"key": "talk", "level": "review", "label": "Talk time below 70% of configured target"})
    if agent["calls"] >= 10 and agent["answerRate"] < 35:
        notes.append({"key": "answer", "level": "review", "label": "Answer rate below 35%"})
    return notes


def _team_data(request, only_agent_id=None):
    from .views import _communication_case_scope

    month, start, end, label = _period(request)
    workdays = _working_days(start, end)
    scope_sql, scope_params = _communication_case_scope()

    with connection.cursor() as cursor:
        event_calls_available = _table_exists(cursor, "callcenter_event_call")
        recordings_available = _table_exists(cursor, "dashboard_zoom_phone_recording")
        analysis_available = recordings_available and _table_exists(cursor, "callcenter_ai_analysis")
        cte = _verified_calls_cte(event_calls_available)

        agent_filter = "AND a.id = %s" if only_agent_id is not None else ""
        agent_params = [only_agent_id] if only_agent_id is not None else []
        cursor.execute(f"""
            SELECT a.id, a.display_name, a.zoom_email, a.zoom_phone_number,
                   a.zoom_account, a.daily_talk_target_minutes
            FROM callcenter_agent a
            INNER JOIN auth_user u ON u.id = a.user_id
            WHERE a.active = TRUE AND u.is_active = TRUE {agent_filter}
            ORDER BY a.display_name
        """, agent_params)
        base_agents = _rows(cursor)
        if only_agent_id is not None and not base_agents:
            return None

        agent_ids = [row["id"] for row in base_agents]
        metrics = {agent_id: {} for agent_id in agent_ids}

        cursor.execute(f"""
            {cte}
            SELECT
                agent_id,
                COUNT(*) FILTER (WHERE direction = 'outbound') AS calls,
                COUNT(*) FILTER (
                    WHERE direction = 'outbound' AND result = 'answered' AND voicemail = ''
                ) AS answered,
                COUNT(*) FILTER (
                    WHERE direction = 'outbound'
                      AND ((result = 'answered' AND voicemail <> '') OR result = ANY(%s))
                ) AS not_answered,
                COALESCE(SUM(duration_seconds) FILTER (WHERE result = 'answered'), 0) AS talk_seconds,
                COUNT(*) FILTER (WHERE event_call) AS event_calls,
                COUNT(DISTINCT learner_email) FILTER (
                    WHERE result = 'answered' AND voicemail = '' AND learner_email IS NOT NULL
                ) AS learners_reached,
                COUNT(*) FILTER (
                    WHERE NOT event_call AND matched AND NOT form_saved
                ) AS missing_outcomes
            FROM verified_calls
            WHERE zoom_started_at >= %s AND zoom_started_at < %s
            GROUP BY agent_id
        """, [list(FAILED_RESULTS), start, end])
        for row in _rows(cursor):
            metrics.setdefault(row["agent_id"], {}).update(row)

        cursor.execute(f"""
            {cte}
            SELECT agent_id,
                   timezone('Europe/London', zoom_started_at)::date AS day,
                   COUNT(*) FILTER (WHERE direction = 'outbound') AS calls,
                   COUNT(*) FILTER (
                       WHERE direction = 'outbound' AND result = 'answered' AND voicemail = ''
                   ) AS answered,
                   COALESCE(SUM(duration_seconds) FILTER (WHERE result = 'answered'), 0) AS talk_seconds
            FROM verified_calls
            WHERE zoom_started_at >= %s AND zoom_started_at < %s
            GROUP BY agent_id, day
            ORDER BY day
        """, [start, end])
        daily = {agent_id: [] for agent_id in agent_ids}
        for row in _rows(cursor):
            daily.setdefault(row["agent_id"], []).append({
                "date": row["day"].isoformat(),
                "calls": row["calls"],
                "answered": row["answered"],
                "talkSeconds": row["talk_seconds"],
            })

        cursor.execute(f"""
            SELECT c.claimed_by_id AS agent_id,
                   COUNT(*) AS open_cases,
                   COUNT(*) FILTER (WHERE c.sla_breached OR c.due_at < NOW()) AS open_sla_breaches,
                   COUNT(*) FILTER (WHERE c.next_followup_at < NOW()) AS overdue_followups
            FROM callcenter_case c
            WHERE c.claimed_by_id IS NOT NULL
              AND c.status <> 'resolved' AND c.archived = FALSE
              AND ({scope_sql})
            GROUP BY c.claimed_by_id
        """, scope_params)
        for row in _rows(cursor):
            metrics.setdefault(row["agent_id"], {}).update(row)

        cursor.execute("""
            SELECT resolved_agent_id AS agent_id, COUNT(*) AS resolved
            FROM callcenter_case
            WHERE resolved_agent_id IS NOT NULL
              AND resolved_at >= %s AND resolved_at < %s
            GROUP BY resolved_agent_id
        """, [start, end])
        for row in _rows(cursor):
            metrics.setdefault(row["agent_id"], {}).update(row)

        cursor.execute(f"""
            SELECT e.agent_id,
                   COUNT(DISTINCT e.ticket_id) FILTER (WHERE e.kind = 'session_booked') AS sessions_booked,
                   COUNT(*) FILTER (WHERE e.kind = 'email_accepted') AS emails_sent,
                   COUNT(DISTINCT e.ticket_id) FILTER (
                       WHERE c.status <> 'resolved' AND c.archived = FALSE
                   ) AS pending_worked
            FROM callcenter_event e
            INNER JOIN callcenter_case c ON c.id = e.ticket_id
            WHERE e.agent_id IS NOT NULL
              AND e.created_at >= %s AND e.created_at < %s
              AND ({scope_sql})
            GROUP BY e.agent_id
        """, [start, end, *scope_params])
        for row in _rows(cursor):
            metrics.setdefault(row["agent_id"], {}).update(row)

        missing_recordings = {}
        if recordings_available:
            cursor.execute(f"""
                {cte}
                SELECT vc.agent_id, COUNT(*) AS missing_recordings
                FROM verified_calls vc
                WHERE vc.zoom_started_at >= %s AND vc.zoom_started_at < %s
                  AND vc.matched = TRUE
                  AND vc.event_call = FALSE
                  AND vc.result = 'answered'
                  AND vc.duration_seconds >= 30
                  AND vc.ended_at <= NOW() - INTERVAL '3 hours'
                  AND NOT EXISTS (
                      SELECT 1 FROM dashboard_zoom_phone_recording r
                      WHERE r.source_account = vc.source_account
                        AND r.zoom_account_id = vc.zoom_account_id
                        AND (
                            (NULLIF(r.call_log_id, '') IS NOT NULL AND r.call_log_id = vc.history_id)
                            OR (NULLIF(r.call_id, '') IS NOT NULL AND r.call_id = vc.zoom_call_id)
                        )
                  )
                GROUP BY vc.agent_id
            """, [start, end])
            missing_recordings = {row["agent_id"]: row["missing_recordings"] for row in _rows(cursor)}

        call_quality = {}
        if analysis_available:
            cursor.execute(f"""
                {cte}
                SELECT vc.agent_id,
                       COUNT(*) FILTER (WHERE review.rating IN ('excellent', 'good', 'bad')) AS rated_calls,
                       COUNT(*) FILTER (WHERE review.rating = 'bad') AS bad_calls
                FROM verified_calls vc
                INNER JOIN LATERAL (
                    SELECT r.id
                    FROM dashboard_zoom_phone_recording r
                    WHERE r.source_account = vc.source_account
                      AND r.zoom_account_id = vc.zoom_account_id
                      AND ((NULLIF(r.call_log_id, '') IS NOT NULL AND r.call_log_id = vc.history_id)
                        OR (NULLIF(r.call_id, '') IS NOT NULL AND r.call_id = vc.zoom_call_id))
                    ORDER BY r.started_at DESC, r.id DESC
                    LIMIT 1
                ) rec ON TRUE
                INNER JOIN LATERAL (
                    SELECT aa.result->>'call_rating' AS rating
                    FROM callcenter_ai_analysis aa
                    WHERE aa.recording_id = rec.id AND aa.state = 'ready'
                    ORDER BY aa.created_at DESC, aa.id DESC
                    LIMIT 1
                ) review ON TRUE
                WHERE vc.zoom_started_at >= %s AND vc.zoom_started_at < %s
                GROUP BY vc.agent_id
            """, [start, end])
            call_quality = {row["agent_id"]: row for row in _rows(cursor)}

    agents = []
    for base in base_agents:
        row = metrics.get(base["id"], {})
        calls = int(row.get("calls") or 0)
        answered = int(row.get("answered") or 0)
        talk_seconds = int(row.get("talk_seconds") or 0)
        target_seconds = int(base["daily_talk_target_minutes"] or 0) * 60 * workdays
        quality = call_quality.get(base["id"], {})
        agent = {
            "id": base["id"],
            "name": base["display_name"],
            "email": base["zoom_email"],
            "phone": base["zoom_phone_number"],
            "account": base["zoom_account"],
            "dailyTargetMinutes": base["daily_talk_target_minutes"],
            "workdays": workdays,
            "targetSeconds": target_seconds,
            "calls": calls,
            "answered": answered,
            "notAnswered": int(row.get("not_answered") or 0),
            "answerRate": round(answered * 100 / calls, 1) if calls else 0,
            "talkSeconds": talk_seconds,
            "targetAttainment": round(talk_seconds * 100 / target_seconds, 1) if target_seconds else 0,
            "eventCalls": int(row.get("event_calls") or 0),
            "learnersReached": int(row.get("learners_reached") or 0),
            "resolved": int(row.get("resolved") or 0),
            "openCases": int(row.get("open_cases") or 0),
            "pendingWorked": int(row.get("pending_worked") or 0),
            "openSlaBreaches": int(row.get("open_sla_breaches") or 0),
            "overdueFollowups": int(row.get("overdue_followups") or 0),
            "missingOutcomes": int(row.get("missing_outcomes") or 0),
            "missingRecordings": int(missing_recordings.get(base["id"], 0)),
            "ratedCalls": int(quality.get("rated_calls") or 0),
            "badCalls": int(quality.get("bad_calls") or 0),
            "sessionsBooked": int(row.get("sessions_booked") or 0),
            "emailsSent": int(row.get("emails_sent") or 0),
            "daily": daily.get(base["id"], []),
        }
        agent["attention"] = _attention(agent)
        agents.append(agent)

    return {
        "period": {
            "value": month,
            "label": label,
            "from": start.astimezone(LONDON).date().isoformat(),
            "to": (end - timedelta(microseconds=1)).astimezone(LONDON).date().isoformat(),
            "timezone": "Europe/London",
            "workdays": workdays,
        },
        "agents": agents,
        "dataCoverage": {
            "verifiedZoomCallsOnly": True,
            "eventCallsAvailable": event_calls_available,
            "recordingsAvailable": recordings_available,
            "callQualityAvailable": analysis_available,
            "notice": "Missing Zoom coverage alone must not be treated as evidence of inactivity.",
        },
    }


@require_GET
def engagement_team_report(request):
    denied = _admin_only(request)
    if denied:
        return denied
    try:
        payload = _team_data(request)
    except (TypeError, ValueError) as exc:
        return JsonResponse({"error": str(exc) or "Invalid report filters"}, status=400)
    except Exception as exc:
        return JsonResponse({
            "error": "Engagement team data is temporarily unavailable",
            "detail": str(exc) if settings.DEBUG else "",
        }, status=503)

    agents = payload["agents"]
    payload["summary"] = {
        "specialists": len(agents),
        "calls": sum(agent["calls"] for agent in agents),
        "answered": sum(agent["answered"] for agent in agents),
        "talkSeconds": sum(agent["talkSeconds"] for agent in agents),
        "resolved": sum(agent["resolved"] for agent in agents),
        "openCases": sum(agent["openCases"] for agent in agents),
        "openSlaBreaches": sum(agent["openSlaBreaches"] for agent in agents),
        "overdueFollowups": sum(agent["overdueFollowups"] for agent in agents),
        "needsAttention": sum(bool(agent["attention"]) for agent in agents),
    }
    return JsonResponse(payload)


def _call_filters(request, start, end):
    conditions = ["report.period_at >= %s", "report.period_at < %s"]
    params = [start, end]
    agent_id = str(request.GET.get("agent_id") or "").strip()
    if agent_id:
        if not agent_id.isdigit():
            raise ValueError("agent_id must be a number")
        conditions.append("report.agent_id = %s")
        params.append(int(agent_id))
    result = str(request.GET.get("result") or "all").strip().lower()
    if result == "answered":
        conditions.append("report.result = 'answered' AND report.voicemail = ''")
    elif result == "not_answered":
        conditions.append("((report.result = 'answered' AND report.voicemail <> '') OR report.result = ANY(%s))")
        params.append(list(FAILED_RESULTS))
    elif result == "voicemail":
        conditions.append("(report.result = 'voicemail' OR (report.result = 'answered' AND report.voicemail <> ''))")
    elif result == "missing_outcome":
        conditions.append("report.event_call = FALSE AND report.form_saved = FALSE")
    elif result != "all":
        conditions.append("lower(report.result) = %s")
        params.append(result)
    search = str(request.GET.get("search") or "").strip()[:200]
    if search:
        value = f"%{search}%"
        conditions.append("""
            (report.agent_name ILIKE %s OR report.learner_email ILIKE %s
             OR report.caller_name ILIKE %s OR report.callee_name ILIKE %s
             OR report.caller_number ILIKE %s OR report.callee_number ILIKE %s
             OR COALESCE(report.case_search, '') ILIKE %s)
        """)
        params.extend([value] * 7)
    return " AND ".join(f"({condition})" for condition in conditions), params


def _calls_data(request, forced_agent_id=None, forced_page_size=None):
    month, start, end, label = _period(request)
    page = max(1, int(request.GET.get("page", 1)))
    page_size = forced_page_size or min(100, max(10, int(request.GET.get("page_size", 50))))

    with connection.cursor() as cursor:
        event_calls_available = _table_exists(cursor, "callcenter_event_call")
        recordings_available = _table_exists(cursor, "dashboard_zoom_phone_recording")
        analysis_available = recordings_available and _table_exists(cursor, "callcenter_ai_analysis")
        cte = _verified_calls_cte(event_calls_available)
        if forced_agent_id is not None:
            request.GET = request.GET.copy()
            request.GET["agent_id"] = str(forced_agent_id)

        case_lateral = """
            LEFT JOIN LATERAL (
                SELECT
                    jsonb_agg(jsonb_build_object(
                        'id', c.id,
                        'reference', 'CC-' || LPAD(c.id::text, 6, '0'),
                        'learnerName', c.learner_name,
                        'sourceType', c.source_type,
                        'status', c.status,
                        'outcome', cc.outcome
                    ) ORDER BY c.id) AS cases,
                    string_agg(COALESCE(c.learner_name, '') || ' ' || COALESCE(c.learner_email, ''), ' ') AS case_search,
                    string_agg(NULLIF(BTRIM(cc.outcome), ''), ', ' ORDER BY c.id) AS outcome
                FROM callcenter_call_intent_tickets intent_case
                INNER JOIN callcenter_case c ON c.id = intent_case.caseticket_id
                LEFT JOIN callcenter_case_call cc
                  ON cc.ticket_id = c.id
                 AND cc.match_id = vc.match_id
                WHERE intent_case.callintent_id = vc.intent_id
            ) cd ON TRUE
        """
        where_sql, where_params = _call_filters(request, start, end)

        recording_lateral = """
            LEFT JOIN LATERAL (
                SELECT r.id, r.transcript_status, r.duration_seconds
                FROM dashboard_zoom_phone_recording r
                WHERE r.source_account = vc.source_account
                  AND r.zoom_account_id = vc.zoom_account_id
                  AND ((NULLIF(r.call_log_id, '') IS NOT NULL AND r.call_log_id = vc.history_id)
                    OR (NULLIF(r.call_id, '') IS NOT NULL AND r.call_id = vc.zoom_call_id))
                ORDER BY r.started_at DESC, r.id DESC
                LIMIT 1
            ) rec ON TRUE
        """ if recordings_available else ""
        analysis_lateral = """
            LEFT JOIN LATERAL (
                SELECT aa.result->>'call_rating' AS rating
                FROM callcenter_ai_analysis aa
                WHERE aa.recording_id = rec.id AND aa.state = 'ready'
                ORDER BY aa.created_at DESC, aa.id DESC
                LIMIT 1
            ) review ON TRUE
        """ if analysis_available else ""
        recording_select = (
            "rec.id AS recording_id, rec.transcript_status, review.rating"
            if analysis_available else
            "rec.id AS recording_id, rec.transcript_status, NULL::text AS rating"
            if recordings_available else
            "NULL::bigint AS recording_id, NULL::text AS transcript_status, NULL::text AS rating"
        )

        common = f"""
            {cte}
            SELECT vc.*, a.display_name AS agent_name,
                   COALESCE(cd.cases, '[]'::jsonb) AS cases,
                   cd.case_search, cd.outcome,
                   {recording_select}
            FROM verified_calls vc
            INNER JOIN callcenter_agent a ON a.id = vc.agent_id
            {case_lateral}
            {recording_lateral}
            {analysis_lateral}
        """
        cursor.execute(f"SELECT COUNT(*) FROM ({common}) report WHERE {where_sql}", where_params)
        total = cursor.fetchone()[0]
        pages = max(1, (total + page_size - 1) // page_size)
        page = min(page, pages)

        cursor.execute(f"""
            SELECT
                report.call_id, report.intent_id, report.agent_id, report.agent_name, report.learner_email,
                report.started_at, report.ended_at, report.duration_seconds,
                CASE WHEN report.result = 'answered' AND report.voicemail <> ''
                     THEN 'voicemail' ELSE report.result END AS effective_result,
                report.caller_number, report.caller_name, report.callee_number, report.callee_name,
                report.direction, report.event_call, report.matched, report.form_saved,
                report.cases, report.outcome,
                report.recording_id, report.transcript_status, report.rating
            FROM ({common}) report
            WHERE {where_sql}
            ORDER BY report.started_at DESC, report.call_id DESC
            LIMIT %s OFFSET %s
        """, [*where_params, page_size, (page - 1) * page_size])
        calls = []
        for row in _rows(cursor):
            linked_cases = _json_array(row["cases"])
            calls.append({
                "id": row["call_id"],
                "intentId": row["intent_id"],
                "agentId": row["agent_id"],
                "agentName": row["agent_name"],
                "learnerEmail": row["learner_email"] or "",
                "startedAt": _iso(row["started_at"]),
                "endedAt": _iso(row["ended_at"]),
                "durationSeconds": row["duration_seconds"],
                "result": row["effective_result"],
                "callerNumber": row["caller_number"],
                "callerName": row["caller_name"],
                "calleeNumber": row["callee_number"],
                "calleeName": row["callee_name"],
                "direction": row["direction"],
                "eventCall": row["event_call"],
                "matched": row["matched"],
                "formSaved": row["form_saved"],
                "cases": linked_cases,
                "outcome": row["outcome"] or "",
                "recordingId": row["recording_id"],
                "transcriptStatus": row["transcript_status"] or "",
                "rating": row["rating"] or "",
            })

        cursor.execute(f"""
            SELECT COUNT(*) AS calls,
                   COUNT(*) FILTER (WHERE report.result = 'answered' AND report.voicemail = '') AS answered,
                   COALESCE(SUM(report.duration_seconds) FILTER (WHERE report.result = 'answered'), 0) AS talk_seconds,
                   COUNT(*) FILTER (
                       WHERE NOT report.event_call AND report.form_saved = FALSE
                   ) AS missing_outcomes,
                   COUNT(*) FILTER (
                       WHERE NOT report.event_call AND report.matched = TRUE
                         AND report.result = 'answered' AND report.duration_seconds >= 30
                         AND report.ended_at <= NOW() - INTERVAL '3 hours'
                         AND report.recording_id IS NULL
                   ) AS missing_recordings
            FROM ({common}) report
            WHERE {where_sql}
        """, where_params)
        summary_row = cursor.fetchone()
        cursor.execute("""
            SELECT a.id, a.display_name
            FROM callcenter_agent a INNER JOIN auth_user u ON u.id = a.user_id
            WHERE a.active = TRUE AND u.is_active = TRUE
            ORDER BY a.display_name
        """)
        agents = [{"id": row[0], "name": row[1]} for row in cursor.fetchall()]

    return {
        "period": {"value": month, "label": label, "timezone": "Europe/London"},
        "summary": {
            "calls": summary_row[0], "answered": summary_row[1], "talkSeconds": summary_row[2],
            "missingOutcomes": summary_row[3], "missingRecordings": summary_row[4],
        },
        "agents": agents,
        "calls": calls,
        "pagination": {"page": page, "pageSize": page_size, "total": total, "pages": pages},
        "dataCoverage": {
            "eventCallsAvailable": event_calls_available,
            "recordingsAvailable": recordings_available,
        },
    }


@require_GET
def engagement_calls(request):
    denied = _admin_only(request)
    if denied:
        return denied
    try:
        return JsonResponse(_calls_data(request))
    except (TypeError, ValueError) as exc:
        return JsonResponse({"error": str(exc) or "Invalid call filters"}, status=400)
    except Exception as exc:
        return JsonResponse({
            "error": "Engagement calls are temporarily unavailable",
            "detail": str(exc) if settings.DEBUG else "",
        }, status=503)


@require_GET
def engagement_call_transcript(request, recording_id):
    denied = _admin_only(request)
    if denied:
        return denied

    with connection.cursor() as cursor:
        if not _table_exists(cursor, "dashboard_zoom_phone_recording"):
            return JsonResponse({"detail": "Call transcripts are not available."}, status=503)
        event_scope = """
            OR EXISTS (
                SELECT 1 FROM callcenter_event_call event_call
                WHERE event_call.call_id = zoom_call.id
            )
        """ if _table_exists(cursor, "callcenter_event_call") else ""
        cursor.execute(f"""
            SELECT recording.id, recording.transcript_status, recording.transcript_text,
                   recording.transcript_error, recording.transcript_checked_at,
                   zoom_call.id AS call_id, zoom_call.started_at
            FROM dashboard_zoom_phone_recording recording
            INNER JOIN LATERAL (
                SELECT zoom_call.id, zoom_call.started_at
                FROM dashboard_zoom_phone_call zoom_call
                WHERE zoom_call.source_account = recording.source_account
                  AND zoom_call.zoom_account_id = recording.zoom_account_id
                  AND (
                      (NULLIF(recording.call_log_id, '') IS NOT NULL
                       AND recording.call_log_id = zoom_call.history_id)
                      OR (NULLIF(recording.call_id, '') IS NOT NULL
                          AND recording.call_id = zoom_call.call_id)
                  )
                  AND (
                      EXISTS (
                          SELECT 1 FROM callcenter_call_intent intent
                          WHERE intent.matched_call_id = zoom_call.id
                      )
                      {event_scope}
                  )
                ORDER BY zoom_call.started_at DESC, zoom_call.id DESC
                LIMIT 1
            ) zoom_call ON TRUE
            WHERE recording.id = %s
        """, [recording_id])
        row = cursor.fetchone()

    if not row:
        return JsonResponse({"detail": "Transcript not found for this Engagement Centre call."}, status=404)

    response = JsonResponse({
        "recordingId": row[0],
        "status": row[1] or "pending",
        "text": row[2] or "",
        "error": row[3] or "",
        "checkedAt": _iso(row[4]),
        "callId": row[5],
        "startedAt": _iso(row[6]),
    })
    response["Cache-Control"] = "private, no-store"
    return response


@require_GET
def engagement_specialist_detail(request, agent_id):
    denied = _admin_only(request)
    if denied:
        return denied
    from .views import _communication_case_scope

    try:
        team = _team_data(request, only_agent_id=agent_id)
        if team is None:
            return JsonResponse({"error": "Specialist not found"}, status=404)
        calls = _calls_data(request, forced_agent_id=agent_id, forced_page_size=20)
        scope_sql, scope_params = _communication_case_scope()
        with connection.cursor() as cursor:
            cursor.execute(f"""
                SELECT linked.*
                FROM (
                    SELECT DISTINCT ON (c.id)
                        c.id, c.source_type, c.learner_name, c.learner_email, c.coach,
                        c.status, c.risk, c.due_at, c.next_followup_at, c.sla_breached,
                        c.attempts, c.last_activity_at, c.claimed_by_id = %s AS owned
                    FROM callcenter_case c
                    LEFT JOIN callcenter_event e ON e.ticket_id = c.id AND e.agent_id = %s
                    WHERE c.status <> 'resolved' AND c.archived = FALSE
                      AND (c.claimed_by_id = %s OR e.agent_id = %s)
                      AND ({scope_sql})
                    ORDER BY c.id, e.created_at DESC NULLS LAST
                ) linked
                ORDER BY (linked.sla_breached OR linked.due_at < NOW()) DESC,
                         (linked.next_followup_at < NOW()) DESC,
                         linked.due_at, linked.id DESC
                LIMIT 100
            """, [agent_id, agent_id, agent_id, agent_id, *scope_params])
            open_cases = [{
                "id": row["id"],
                "reference": f"CC-{row['id']:06d}",
                "sourceType": row["source_type"],
                "learnerName": row["learner_name"],
                "learnerEmail": row["learner_email"],
                "coach": row["coach"],
                "status": row["status"],
                "risk": row["risk"],
                "dueAt": _iso(row["due_at"]),
                "nextFollowupAt": _iso(row["next_followup_at"]),
                "slaBreached": bool(row["sla_breached"] or (row["due_at"] and row["due_at"] < timezone.now())),
                "attempts": row["attempts"],
                "lastActivityAt": _iso(row["last_activity_at"]),
                "owned": row["owned"],
            } for row in _rows(cursor)]

            cursor.execute(f"""
                SELECT COUNT(DISTINCT c.id)
                FROM callcenter_case c
                LEFT JOIN callcenter_event e ON e.ticket_id = c.id AND e.agent_id = %s
                WHERE c.status <> 'resolved' AND c.archived = FALSE
                  AND (c.claimed_by_id = %s OR e.agent_id = %s)
                  AND ({scope_sql})
            """, [agent_id, agent_id, agent_id, *scope_params])
            linked_cases_total = cursor.fetchone()[0]

            cursor.execute("""
                SELECT e.id, e.kind, e.actor, e.created_at, e.ticket_id,
                       c.learner_name, c.source_type
                FROM callcenter_event e
                INNER JOIN callcenter_case c ON c.id = e.ticket_id
                WHERE e.agent_id = %s
                ORDER BY e.created_at DESC, e.id DESC
                LIMIT 50
            """, [agent_id])
            activity = [{
                "id": row["id"], "kind": row["kind"], "actor": row["actor"],
                "createdAt": _iso(row["created_at"]), "caseId": row["ticket_id"],
                "learnerName": row["learner_name"], "sourceType": row["source_type"],
            } for row in _rows(cursor)]

        return JsonResponse({
            "period": team["period"],
            "agent": team["agents"][0],
            "openCases": open_cases,
            "linkedCasesTotal": linked_cases_total,
            "recentCalls": calls["calls"],
            "activity": activity,
            "dataCoverage": team["dataCoverage"],
        })
    except (TypeError, ValueError) as exc:
        return JsonResponse({"error": str(exc) or "Invalid specialist filters"}, status=400)
    except Exception as exc:
        return JsonResponse({
            "error": "Specialist detail is temporarily unavailable",
            "detail": str(exc) if settings.DEBUG else "",
        }, status=503)
