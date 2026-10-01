from datetime import datetime, time, timedelta

from django.db.models import Q
from django.utils import timezone

from api.models import ZoomPhoneCall, ZoomSyncState
from api.zoom_phone import account_config
from api.zoom_views import current_account_filter
from .models import Agent, CallMatch, CaseTicket, TicketEvent
from .rules import FAILED_RESULTS, LONDON, working_day
from .services import identify_agent


def gaps_for_day(calls, day, now):
    start = datetime.combine(day, time(9), tzinfo=LONDON)
    end = min(datetime.combine(day, time(17), tzinfo=LONDON), now)
    if start >= end or not working_day(day):
        return [], False
    if any(call.ended_at is None for call in calls):
        return [], True
    intervals = sorted((max(start, call.started_at), min(end, call.ended_at)) for call in calls
                       if call.ended_at > start and call.started_at < end)
    result, cursor = [], start
    for left, right in intervals:
        if left > cursor + timedelta(minutes=30):
            result.append({'from': cursor.isoformat(), 'to': left.isoformat(), 'minutes': round((left - cursor).total_seconds() / 60)})
        cursor = max(cursor, right)
    if end > cursor + timedelta(minutes=30):
        result.append({'from': cursor.isoformat(), 'to': end.isoformat(), 'minutes': round((end - cursor).total_seconds() / 60)})
    return result, False


def performance(start, end):
    lower = datetime.combine(start, time.min, tzinfo=LONDON)
    upper = datetime.combine(end + timedelta(days=1), time.min, tzinfo=LONDON)
    now = timezone.now()
    report = []
    agents = list(Agent.objects.filter(active=True, user__is_active=True).order_by('display_name'))
    for agent in agents:
        identity = Q(caller_email__iexact=agent.zoom_email)
        if agent.zoom_user_id:
            identity |= Q(caller_user_id=agent.zoom_user_id)
        calls = list(ZoomPhoneCall.objects.filter(current_account_filter(), identity, source_account=agent.zoom_account,
                     direction='outbound', started_at__gte=lower, started_at__lt=upper).order_by('started_at'))
        calls = [call for call in calls if (identified := identify_agent(call, agents)) and identified.pk == agent.pk]
        daily = []
        day = start
        while day <= end:
            current = [call for call in calls if call.started_at.astimezone(LONDON).date() == day]
            answered = [call for call in current if call.result == 'answered']
            gaps, unknown = gaps_for_day(current, day, now)
            daily.append({'date': day.isoformat(), 'calls': len(current), 'answered': len(answered),
                'not_answered': sum(c.result in FAILED_RESULTS for c in current),
                'seconds': sum(c.duration_seconds or 0 for c in answered),
                'missing_duration': sum(c.duration_seconds is None for c in answered),
                'first_call': current[0].started_at if current else None, 'last_call': current[-1].started_at if current else None,
                'gaps': gaps, 'gaps_unknown': unknown})
            day += timedelta(days=1)
        state = ZoomSyncState.objects.filter(source_account=agent.zoom_account,
                                            zoom_account_id=account_config(agent.zoom_account)['account_id']).first()
        events = TicketEvent.objects.filter(created_at__gte=lower, created_at__lt=upper)
        breaches = list(events.filter(kind='sla_breached').values('ticket_id', 'data'))
        worked_ids = TicketEvent.objects.filter(agent=agent).values_list('ticket_id', flat=True).distinct()
        report.append({
            'id': agent.pk, 'name': agent.display_name, 'account': agent.zoom_account,
            'zoom_phone_number': agent.zoom_phone_number,
            'daily_target_minutes': agent.daily_talk_target_minutes, 'daily': daily,
            'calls': len(calls), 'answered': sum(d['answered'] for d in daily),
            'not_answered': sum(d['not_answered'] for d in daily),
            'seconds': sum(d['seconds'] for d in daily),
            'missing_duration': sum(c.duration_seconds is None for c in calls),
            'answered_missing_duration': sum(d['missing_duration'] for d in daily),
            'unique_learners': CallMatch.objects.filter(agent=agent, call_id__in=[c.pk for c in calls if c.result == 'answered'])
                .exclude(cases__outcome='wrong_number').values('learner_email').distinct().count(),
            'resolved': CaseTicket.objects.filter(resolved_agent=agent, resolved_at__gte=lower, resolved_at__lt=upper).count(),
            'pending': CaseTicket.objects.filter(pk__in=worked_ids, archived=False).exclude(status='resolved').count(),
            'sla_breaches': len({b['ticket_id'] for b in breaches if agent.pk in b['data'].get('agent_ids', [])}),
            'emails': events.filter(ticket_id__in=worked_ids, kind='email_accepted').count(),
            'reminders': events.filter(ticket_id__in=worked_ids, kind='email_accepted', data__stage__in=['day2', 'day5', 'day7']).count(),
            'sync': {'last_success_at': state.last_success_at if state else None,
                     'error': state.last_error if state else 'Account has not synced.',
                     'recordings_error': state.recordings_error if state else ''},
        })
    resolved = CaseTicket.objects.filter(resolved_at__gte=lower, resolved_at__lt=upper)
    return {'agents': report, 'from': start, 'to': end, 'timezone': 'Europe/London',
            'resolutions': {kind: resolved.filter(resolved_by=kind).count() for kind in ('agent', 'ai', 'system')},
            'unclaimed_breaches': TicketEvent.objects.filter(kind='sla_breached', created_at__gte=lower,
                created_at__lt=upper, data__unclaimed=True).count()}
