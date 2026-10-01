import uuid
from datetime import timedelta

from django.db import transaction
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

from api.models import ZoomPhoneCall
from api.zoom_phone import ACCOUNT_LABELS, sync_account
from api.zoom_views import current_account_filter
from .ai import process_ai
from .emails import generate_surveys, process_emails
from .evidence import EvidenceSnapshot, check_evidence
from .models import CaseCall, CaseTicket, CycleState
from .services import Conflict, event, expire_claims, match_call, release_fields, resolve
from .sources import generate_reminders, generate_risks, get_source, import_legacy, load_bookings, profiles, refresh_recording_links, source_health


def maintenance(now):
    expire_claims(now)
    pending = Q(due_at__lt=now, sla_breached=False) | Q(next_followup_at__lte=now, status__in=['pending_learner', 'pending_verification'])
    for pk in CaseTicket.objects.filter(pending, archived=False).exclude(status='resolved').values_list('pk', flat=True).iterator():
        with transaction.atomic():
            ticket = CaseTicket.objects.select_for_update().get(pk=pk)
            if ticket.due_at < now and not ticket.sla_breached:
                agents = list(ticket.events.exclude(agent=None).values_list('agent_id', flat=True).distinct())
                ticket.sla_breached = True
                event(ticket, 'sla_breached', {'agent_ids': sorted(agents), 'unclaimed': not agents, 'due_at': ticket.due_at.isoformat()})
            if ticket.next_followup_at and ticket.next_followup_at <= now and ticket.status in ('pending_learner', 'pending_verification'):
                ticket.status = 'new'
                ticket.next_followup_at = None
                release_fields(ticket)
                event(ticket, 'followup_due', {'promised_at': ticket.promised_at.isoformat() if ticket.promised_at else None})
            ticket.save()


def evidence_cycle():
    resolved, errors = 0, {}
    tickets = list(CaseTicket.objects.filter(archived=False).exclude(status='resolved').select_related('survey'))
    snapshot = EvidenceSnapshot(tickets)
    for ticket in tickets:
        if ticket.source_type in errors:
            continue
        try:
            evidence = check_evidence(ticket, snapshot)
            if evidence:
                resolve(ticket.pk, evidence=evidence)
                resolved += 1
        except Conflict:
            event(ticket, 'resolution_blocked', {'reason': 'Legacy identity requires manager review.'})
        except Exception as exc:
            errors[ticket.source_type] = type(exc).__name__
    source_health('evidence', error='; '.join(f'{k}: {v}' for k, v in errors.items()), count=resolved)
    return resolved


def run_cycle(*, skip_zoom=False, skip_ai=False, skip_emails=False):
    token = str(uuid.uuid4())
    now = timezone.now()
    CycleState.objects.get_or_create(name='cycle')
    if not CycleState.objects.filter(Q(locked_until__isnull=True) | Q(locked_until__lt=now), name='cycle').update(
            token=token, locked_until=now + timedelta(hours=2)):
        return {'skipped': 'Another cycle is running.'}
    result = {}
    try:
        if not skip_zoom:
            for account in ACCOUNT_LABELS:
                try:
                    result['zoom_' + account] = sync_account(account, include_recordings=True)
                except Exception as exc:
                    result['zoom_' + account] = f'Unavailable ({type(exc).__name__}); inspect Zoom account status.'
        people = get_source('profiles', profiles)
        if people is not None:
            directory = {}
            for person in people.values():
                if person['learner_phone']:
                    directory.setdefault(person['learner_phone'], []).append(person['learner_email'])
            CycleState.objects.update_or_create(name='phone_directory', defaults={'details': directory, 'last_success_at': timezone.now()})
            result['legacy_created'] = import_legacy(people)
            result['source_created'] = generate_risks(people)
            bookings = get_source('bookings', lambda: load_bookings(people))
            if bookings is not None:
                result['reminders_created'] = generate_reminders(people, bookings)
            result['manager_surveys'] = generate_surveys(people)
        get_source('recording_links', refresh_recording_links)
        # Evidence wins over returning a promised-date case to the queue.
        result['resolved'] = evidence_cycle()
        maintenance(timezone.now())
        earliest = CaseTicket.objects.order_by('created_at').values_list('created_at', flat=True).first()
        result['matched'] = 0
        if earliest:
            # Calls before the module's first case cannot be its contact attempts.
            changed_result = CaseCall.objects.filter(match__call_id=OuterRef('pk')).exclude(processed_result=OuterRef('result'))
            calls = ZoomPhoneCall.objects.filter(current_account_filter(), direction='outbound', started_at__gte=earliest).annotate(
                needs_result=Exists(changed_result)).filter(Q(callmatch__isnull=True) | Q(needs_result=True)).order_by('started_at')
            for pk in calls.values_list('pk', flat=True).iterator():
                if match_call(pk):
                    result['matched'] += 1
        if not skip_ai:
            result['analyses'] = process_ai()
        if not skip_emails:
            result['emails_processed'] = process_emails()
        CycleState.objects.filter(name='cycle', token=token).update(last_success_at=timezone.now(), details=result)
        return result
    finally:
        CycleState.objects.filter(name='cycle', token=token).update(locked_until=None, token='')
