from datetime import timedelta

from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from api.models import AttendanceTicket, EPATicket, MCMTicket, OTJTicket, ProgressReviewTicket, ZoomPhoneCall
from api.zoom_views import current_account_filter
from .models import Agent, CallIntent, CallMatch, CaseCall, CaseTicket, TicketEvent
from .rules import FAILED_RESULTS, OPTIONS, email_key, normalize_phone, retry_at

LEGACY = {'attendance': AttendanceTicket, 'pr': ProgressReviewTicket, 'mcm': MCMTicket,
          'otj': OTJTicket, 'epa': EPATicket}


class Conflict(ValueError):
    pass


def agent_for(user):
    return Agent.objects.filter(user=user, active=True, user__is_active=True).first()


def operating_agent(user, agent_id=None):
    """Resolve the Zoom identity an operator is authorized to use."""
    if not user.is_authenticated or not user.is_active:
        raise PermissionDenied('An active signed-in account is required.')
    own = agent_for(user)
    if user.is_superuser:
        if not agent_id:
            return own
        agent = Agent.objects.filter(pk=agent_id, active=True, user__is_active=True).first()
        if not agent:
            raise PermissionDenied('Choose an active Zoom account.')
        return agent
    if agent_id and (not own or own.pk != agent_id):
        raise PermissionDenied('You cannot operate another Zoom account.')
    return own


def event(ticket, kind, data=None, agent=None, actor=None, call=None):
    who = actor or (agent.display_name if agent else 'System')
    entry = TicketEvent.objects.create(ticket=ticket, kind=kind, data=data or {}, agent=agent, actor=who, call=call)
    CaseTicket.objects.filter(pk=ticket.pk).update(last_actor=who, last_action_at=entry.created_at)
    return entry


def release_fields(ticket):
    ticket.claimed_by = None
    ticket.claimed_at = None
    ticket.last_activity_at = None


def can_work(ticket, user, now=None, acting_agent=None):
    now = now or timezone.now()
    agent = acting_agent or agent_for(user)
    if not agent and not user.is_staff:
        raise PermissionDenied('An active agent profile or manager permission is required.')
    if ticket.claimed_by_id and ticket.last_activity_at and ticket.last_activity_at > now - timedelta(minutes=30):
        if not agent or ticket.claimed_by_id != agent.pk:
            raise Conflict('Another agent is working on this ticket.')
    return agent


@transaction.atomic
def claim(ticket_id, agent, now=None, actor=None):
    now = now or timezone.now()
    if not agent.active or not agent.user.is_active:
        raise PermissionDenied('Agent is inactive.')
    # A single conditional UPDATE is the arbiter, including on SQLite.
    available = Q(claimed_by__isnull=True) | Q(last_activity_at__lte=now - timedelta(minutes=30)) | Q(claimed_by=agent)
    changed = CaseTicket.objects.filter(available, pk=ticket_id, archived=False).exclude(status='resolved').update(
        claimed_by=agent, claimed_at=now, last_activity_at=now, status='in_progress', updated_at=now,
    )
    if not changed:
        raise Conflict('Ticket is claimed, archived or already resolved.')
    ticket = CaseTicket.objects.get(pk=ticket_id)
    event(ticket, 'claimed', agent=agent, actor=actor)
    return ticket


@transaction.atomic
def release(ticket_id, user, acting_agent=None):
    ticket = CaseTicket.objects.select_for_update().get(pk=ticket_id)
    agent = can_work(ticket, user, acting_agent=acting_agent)
    if ticket.status == 'in_progress':
        ticket.status = 'new'
    release_fields(ticket)
    ticket.save()
    event(ticket, 'released', agent=agent, actor=None if agent else user.get_username())


def expire_claims(now):
    for pk in CaseTicket.objects.filter(claimed_by__isnull=False, last_activity_at__lte=now - timedelta(minutes=30)).values_list('pk', flat=True):
        with transaction.atomic():
            ticket = CaseTicket.objects.select_for_update().get(pk=pk)
            if ticket.last_activity_at and ticket.last_activity_at <= now - timedelta(minutes=30):
                agent = ticket.claimed_by
                release_fields(ticket)
                if ticket.status == 'in_progress':
                    ticket.status = 'new'
                ticket.save()
                event(ticket, 'claim_expired', {'previous_agent': agent.pk if agent else None})


@transaction.atomic
def create_intent(ticket_id, agent, actor=None):
    now = timezone.now()
    ticket = CaseTicket.objects.get(pk=ticket_id)
    if ticket.source_type == 'satisfaction' or ticket.attempts >= 3:
        raise Conflict('This case needs email or manager follow-up, not another automatic call.')
    if ticket.next_followup_at and ticket.next_followup_at > now:
        raise Conflict('The next follow-up is not due yet.')
    number = normalize_phone(ticket.learner_phone)
    if not number:
        raise ValueError('A valid learner telephone number is required.')
    if not agent.zoom_email or not agent.zoom_account:
        raise ValueError('Configure the agent Zoom identity first.')
    # Claim every active issue included in the intent, or roll back the entire operation.
    tickets = list(CaseTicket.objects.filter(learner_email=ticket.learner_email, archived=False, attempts__lt=3)
                   .exclude(status='resolved').exclude(source_type='satisfaction').order_by('pk'))
    for item in tickets:
        claim(item.pk, agent, now, actor=actor)
    prior = CallIntent.objects.filter(agent=agent, learner_email=ticket.learner_email, number=number,
                                      matched_call__isnull=True, created_at__gte=now - timedelta(minutes=10)).first()
    if prior:
        return prior
    intent = CallIntent.objects.create(agent=agent, learner_email=ticket.learner_email, number=number)
    intent.tickets.add(*tickets)
    for item in tickets:
        event(item, 'dial_requested', {'intent_id': intent.pk, 'number': number}, agent=agent, actor=actor)
    return intent


def writeback(ticket, reopen=False):
    model = LEGACY.get(ticket.source_type)
    if not model or not ticket.source_id:
        return
    old = model.objects.select_for_update().filter(pk=ticket.source_id).first()
    if not old or email_key(old.learner_email) != ticket.learner_email:
        raise Conflict('Linked legacy ticket identity changed. Manager review required.')
    before = {'status': old.status, 'action': old.action}
    if reopen:
        previous = ticket.events.filter(kind='legacy_updated').order_by('-id').first()
        if not previous or before != previous.data['after']:
            event(ticket, 'legacy_writeback_skipped', {'reason': 'Legacy state changed independently; preserved.', 'current': before})
            return
        after = previous.data['before']
    else:
        after = {'status': 'resolved', 'action': old.action}
    old.status, old.action = after['status'], after['action']
    old.save(update_fields=['status', 'action', 'updated_at'])
    event(ticket, 'legacy_reopened' if reopen else 'legacy_updated', {'before': before, 'after': after, 'source_id': old.pk})


@transaction.atomic
def resolve(ticket_id, user=None, evidence=None, note='', option='other', acting_agent=None):
    ticket = CaseTicket.objects.select_for_update().get(pk=ticket_id)
    if ticket.status == 'resolved':
        return ticket
    if option not in OPTIONS:
        raise ValueError('Invalid resolution option.')
    agent = can_work(ticket, user, acting_agent=acting_agent) if user else None
    if user is None:
        from .evidence import valid_evidence
        if not valid_evidence(ticket, evidence):
            raise ValueError('New, unambiguous source evidence is required.')
    elif not note.strip():
        raise ValueError('A resolution reason is required.')
    writeback(ticket)
    previous = ticket.status
    ticket.status = 'resolved'
    ticket.resolved_at = timezone.now()
    ticket.resolved_by = 'agent' if user else 'system'
    ticket.resolved_agent = agent
    ticket.resolution_option = option
    ticket.next_followup_at = ticket.promised_at = None
    release_fields(ticket)
    ticket.save()
    event(ticket, 'resolved', {'previous': previous, 'note': note, 'evidence': evidence,
                              'resolved_by': ticket.resolved_by}, agent, None if agent or not user else user.get_username())
    return ticket


@transaction.atomic
def reopen(ticket_id, user, note, acting_agent=None):
    ticket = CaseTicket.objects.select_for_update().get(pk=ticket_id)
    agent = can_work(ticket, user, acting_agent=acting_agent)
    if ticket.status != 'resolved' or not note.strip():
        raise ValueError('A resolved ticket and reopening reason are required.')
    writeback(ticket, reopen=True)
    ticket.status = 'new'
    ticket.resolved_at = None
    ticket.resolved_by = ''
    ticket.resolved_agent = None
    ticket.archived = False
    ticket.evidence_after = timezone.now()
    ticket.save()
    event(ticket, 'reopened', {'note': note}, agent, None if agent else user.get_username())


def identify_agent(call, agents=None):
    if agents is None:
        agents = Agent.objects.filter(active=True, user__is_active=True, zoom_account=call.source_account)
    matches = [a for a in agents if a.zoom_account == call.source_account and (
        (a.zoom_user_id and a.zoom_user_id == call.caller_user_id)
        or (a.zoom_email and a.zoom_email == email_key(call.caller_email)))]
    return matches[0] if len(matches) == 1 else None


@transaction.atomic
def match_call(call_id):
    call = ZoomPhoneCall.objects.select_for_update().filter(current_account_filter(), pk=call_id, direction='outbound').first()
    if not call or call.started_at > timezone.now():
        return None
    match = CallMatch.objects.filter(call=call).first()
    if match:
        apply_call_result(match)
        return match
    agent = identify_agent(call)
    number = normalize_phone(call.callee_number)
    if not agent or not number:
        return None
    intents = list(CallIntent.objects.select_for_update().filter(
        agent=agent, number=number, matched_call__isnull=True,
        created_at__lte=call.started_at, created_at__gte=call.started_at - timedelta(minutes=10),
    )[:2])
    if len(intents) > 1:
        return None
    intent = intents[0] if intents else None
    candidates = CaseTicket.objects.filter(created_at__lte=call.started_at)
    if intent:
        candidates = candidates.filter(intents=intent, learner_email=intent.learner_email)
        learner_email = intent.learner_email
    else:
        candidates = candidates.filter(Q(status='resolved', resolved_at__gte=call.started_at) | ~Q(status='resolved'))
        # Include historical cases in ambiguity detection, even if one is resolved.
        emails = list(CaseTicket.objects.filter(learner_phone=number).exclude(source_type='satisfaction')
                      .values_list('learner_email', flat=True).distinct()[:2])
        if len(emails) != 1:
            return None
        learner_email = emails[0]
        # The queue is not a complete address book. Confirm uniqueness across the
        # latest successful Aptem contact snapshot, including learners without cases.
        from .models import CycleState
        directory = CycleState.objects.filter(name='phone_directory').first()
        if not directory or not directory.last_success_at or directory.last_success_at < timezone.now() - timedelta(hours=24):
            return None
        if directory.details.get(number) != [learner_email]:
            return None
        candidates = candidates.filter(learner_phone=number, learner_email=learner_email)
    tickets = list(candidates.exclude(source_type='satisfaction').order_by('pk'))
    if not tickets:
        return None
    match = CallMatch.objects.create(call=call, agent=agent, learner_email=learner_email, manual=intent is None)
    if intent:
        intent.matched_call = call
        intent.save(update_fields=['matched_call'])
    for ticket in tickets:
        CaseCall.objects.create(ticket=ticket, match=match)
        event(ticket, 'zoom_call', {'manual': match.manual, 'match_id': match.pk}, agent=agent, call=call)
    apply_call_result(match)
    return match


def apply_call_result(match):
    call = match.call
    if not call.ended_at or call.result not in FAILED_RESULTS | {'answered'}:
        return
    for link in match.cases.select_for_update().select_related('ticket'):
        if link.processed_result == call.result:
            continue
        ticket = CaseTicket.objects.select_for_update().get(pk=link.ticket_id)
        link.processed_result = call.result
        link.save(update_fields=['processed_result'])
        # Recompute from distinct real calls so re-syncs and out-of-order imports cannot inflate counts.
        failed = ticket.calls.filter(processed_result__in=FAILED_RESULTS)
        ticket.attempts = failed.count()
        latest = ticket.calls.exclude(processed_result='').select_related('match__call').order_by('-match__call__started_at', '-match__call_id').first()
        other_claim = (ticket.claimed_by_id and ticket.claimed_by_id != match.agent_id and ticket.last_activity_at
                       and ticket.last_activity_at > timezone.now() - timedelta(minutes=30))
        before_reopen = bool(latest and ticket.evidence_after and latest.match.call.started_at <= ticket.evidence_after)
        if ticket.status != 'resolved' and latest and not other_claim and not before_reopen:
            last = latest.match.call
            ticket.last_contact_at = last.started_at
            if last.result in FAILED_RESULTS:
                ticket.next_followup_at = retry_at(last.ended_at, ticket.attempts)
                ticket.status = 'unreachable' if ticket.attempts >= 3 else 'pending_learner'
                ticket.escalated = ticket.escalated or ticket.attempts >= 3
            else:
                ticket.status = 'pending_verification'
                ticket.next_followup_at = None
            release_fields(ticket)
            ticket.save()
        else:
            ticket.save(update_fields=['attempts'])
        event(ticket, 'zoom_result', {'result': call.result, 'failed_attempts': ticket.attempts}, agent=match.agent, call=call)


@transaction.atomic
def record_outcome(ticket_id, user, call_id, outcome, option='', note='', callback_at=None, acting_agent=None):
    ticket = CaseTicket.objects.select_for_update().get(pk=ticket_id)
    agent = can_work(ticket, user, acting_agent=acting_agent)
    if ticket.status == 'resolved':
        raise Conflict('Reopen the case before recording another outcome.')
    link = CaseCall.objects.select_related('match__call', 'match__agent').filter(ticket=ticket, match__call_id=call_id).first()
    if not link:
        raise ValueError('An actual linked Zoom call is required.')
    if not user.is_superuser and link.match.agent_id != agent.pk:
        raise PermissionDenied('Only the calling agent or a manager can record this outcome.')
    if outcome not in {'reached', 'no_answer', 'wrong_number', 'callback'}:
        raise ValueError('Invalid outcome.')
    if outcome == 'no_answer' and link.match.call.result not in FAILED_RESULTS:
        raise ValueError('Zoom does not report this call as unanswered.')
    if outcome in {'reached', 'callback'} and link.match.call.result != 'answered':
        raise ValueError('Zoom must confirm an answered call.')
    if option and option not in OPTIONS:
        raise ValueError('Invalid resolution option.')
    if outcome == 'callback' and (not callback_at or callback_at <= timezone.now()):
        raise ValueError('Choose a future callback time.')
    if outcome == 'wrong_number' and not note.strip():
        raise ValueError('Explain why this is the wrong number.')
    link.outcome, link.outcome_at = outcome, timezone.now()
    link.save(update_fields=['outcome', 'outcome_at'])
    ticket.resolution_option = option
    if outcome == 'callback':
        ticket.status, ticket.next_followup_at = 'pending_learner', callback_at
    elif outcome == 'wrong_number':
        ticket.status, ticket.next_followup_at = 'escalated', None
        ticket.escalated = True
    elif outcome == 'reached':
        ticket.status, ticket.next_followup_at = 'pending_verification', None
    release_fields(ticket)
    ticket.save()
    event(ticket, 'outcome', {'outcome': outcome, 'option': option, 'note': note,
                             'callback_at': callback_at.isoformat() if callback_at else None},
          agent, None if agent else user.get_username(), call=link.match.call)
