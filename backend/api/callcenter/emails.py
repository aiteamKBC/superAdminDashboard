from datetime import timedelta
from html import escape
from urllib.parse import urlparse

import requests
from django.conf import settings
from django.core import signing
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.utils import timezone

from .booking_links import booking_links
from .models import CaseTicket, EmailDelivery, EmailQuota, EmployerSatisfaction, TicketEvent
from .rules import LONDON, due_at, email_key
from .services import event, release_fields
from .sources import reason_key


def survey_token(survey):
    return signing.dumps({'id': survey.pk, 'nonce': str(survey.nonce)}, salt='callcentre-survey')


@transaction.atomic
def generate_surveys(people):
    now = timezone.now()
    today = now.astimezone(LONDON).date()
    quarter = f'{today.year}-Q{(today.month - 1) // 3 + 1}'
    managers = {}
    for person in people.values():
        email = email_key(person.get('manager_email'))
        try:
            validate_email(email)
        except ValidationError:
            continue
        managers.setdefault(email, []).append(person)
    issued = set(EmployerSatisfaction.objects.filter(quarter=quarter).values_list('manager_email', flat=True))
    existing = {c.reason_key: c for c in CaseTicket.objects.filter(source_type='satisfaction')}
    new, pending = [], []
    for email, learners in managers.items():
        if email in issued:
            continue
        key = reason_key('satisfaction', email, quarter)
        case = existing.get(key)
        if not case:
            case = CaseTicket(learner_email=email, learner_name=learners[0]['manager_name'] or email,
                organisation=', '.join(sorted({p['organisation'] for p in learners}))[:255],
                manager_email=email, manager_name=learners[0]['manager_name'], source_type='satisfaction',
                reason_key=key, due_at=due_at('satisfaction', now),
                source_data={'quarter': quarter, 'learner_count': len(learners)})
            new.append(case)
        pending.append((email, case))
    CaseTicket.objects.bulk_create(new, batch_size=200)
    TicketEvent.objects.bulk_create([TicketEvent(ticket=case, kind='created', data={'quarter': quarter}) for case in new], batch_size=200)
    EmployerSatisfaction.objects.bulk_create([EmployerSatisfaction(ticket=case, manager_email=email,
        quarter=quarter, organisation=case.organisation, expires_at=now + timedelta(days=30)) for email, case in pending], batch_size=200)
    return len(managers)


def render_email(ticket, kind):
    links = booking_links(ticket.coach)
    if kind in ('escalation', 'low_score'):
        subject = f'KBC: follow-up required - case #{ticket.pk}'
        body = f'{ticket.learner_name} has an unresolved {ticket.source_type} case. Please contact the KBC support team.'
        if kind == 'low_score':
            body = f'Employer satisfaction case #{ticket.pk} received a score of {ticket.survey.score}/5. Manager follow-up is required.'
    elif ticket.source_type == 'satisfaction':
        subject = 'KBC: quarterly employer feedback'
        body = 'Please rate your experience with Kent Business College from 1 (poor) to 5 (excellent).'
        origin = settings.CALLCENTRE_PUBLIC_URL
        if urlparse(origin).scheme == 'https' and urlparse(origin).netloc:
            token = survey_token(ticket.survey)
            links = {f'Rate {score}/5': f'{origin}/api/callcentre/survey/{token}/?score={score}' for score in range(1, 6)}
        else:
            links = {}
            body += '\nSurvey link unavailable: public URL is not configured.'
    elif ticket.source_type == 'reminder':
        subject = 'KBC: your upcoming session'
        start = ticket.booking_at.astimezone(LONDON).strftime('%d %b %Y at %H:%M')
        body = f'Hello {ticket.learner_name},\nYour {ticket.source_data.get("session_type", "support")} session is on {start} (UK time). Please confirm with your coach.'
    else:
        subject = f'KBC: {ticket.source_type.upper()} follow-up'
        body = f'Hello {ticket.learner_name},\nPlease contact {ticket.coach or "your coach"} about your outstanding {ticket.source_type} activity.'
        if ticket.source_type == 'attendance':
            body += '\nYou can arrange a catch-up session or watch the lecture recording offline.'
            recording_url = ticket.source_data.get('recording_url', '')
            if urlparse(recording_url).scheme == 'https' and urlparse(recording_url).netloc:
                links['Watch lecture recording'] = recording_url
            else:
                body += '\nRecording link is currently unavailable; please contact your coach.'
        elif ticket.source_type in ('mcm', 'pr'):
            body += '\nPlease book your next session using the relevant link below.'
    label = {'pr': 'Book progress review', 'mcm': 'Book MCM', 'support': 'Contact / book coach support'}
    link_html = ''.join(f'<p><a style="color:#80560F" href="{escape(url, quote=True)}">{escape(label.get(name, name))}</a></p>'
                        for name, url in links.items())
    html = ('<!doctype html><html><body style="margin:0;background:#F9F4EC;font-family:Arial,sans-serif">'
            '<table role="presentation" style="width:100%;max-width:420px;margin:auto;background:white"><tr><td style="padding:30px">'
            '<img src="https://kentbusinesscollege.org/email-assets/logo.png" alt="Kent Business College" width="180">'
            f'<h2 style="color:#241453">{escape(subject)}</h2><p style="color:#4C4C4C;line-height:1.6">'
            + escape(body).replace('\n', '<br>') + '</p>' + link_html
            + '<p>Kind regards,<br>KBC Learner Support</p></td></tr></table></body></html>')
    text = body + '\n' + '\n'.join(f'{label.get(key, key)}: {url}' for key, url in links.items())
    return subject, text, html


@transaction.atomic
def send_ticket_email(ticket_id, stage):
    ticket = CaseTicket.objects.select_for_update().get(pk=ticket_id)
    if (ticket.status == 'resolved' and stage != 'low_score') or ticket.archived:
        return None
    mode = settings.CALLCENTRE_EMAIL_MODE
    if mode not in ('dry_run', 'live'):
        raise ValueError('CALLCENTRE_EMAIL_MODE must be dry_run or live.')
    key = f'{ticket.pk}:{stage}:{mode}'
    if ticket.evidence_after:
        key += ':' + ticket.evidence_after.isoformat()
    if EmailDelivery.objects.filter(dedupe_key=key).exists():
        return None
    recipient = email_key(ticket.manager_email if stage in ('escalation', 'low_score') else ticket.learner_email)
    try:
        validate_email(recipient)
    except ValidationError:
        if not ticket.events.filter(kind='email_blocked', data__stage=stage).exists():
            event(ticket, 'email_blocked', {'stage': stage, 'reason': 'Valid recipient missing.'})
        return None
    if ticket.source_type == 'satisfaction' and stage != 'low_score':
        if ticket.survey.expires_at <= timezone.now() or ticket.survey.responded_at:
            return None
        if mode == 'live' and (not settings.CALLCENTRE_PUBLIC_URL.startswith('https://')):
            return None
    day = timezone.now().astimezone(LONDON).date()
    quota, _ = EmailQuota.objects.get_or_create(recipient=recipient, day=day)
    quota = EmailQuota.objects.select_for_update().get(pk=quota.pk)
    if quota.count >= max(0, settings.CALLCENTRE_EMAIL_DAILY_CAP):
        return None
    subject, text, html = render_email(ticket, stage)
    cc = email_key(settings.CALLCENTRE_ESCALATION_EMAIL) if stage in ('escalation', 'low_score') else ''
    if stage == 'low_score' and not cc:
        if not ticket.events.filter(kind='email_blocked', data__stage=stage).exists():
            event(ticket, 'email_blocked', {'stage': stage, 'reason': 'Internal escalation CC is not configured.'})
        return None
    if cc:
        validate_email(cc)
    delivery = EmailDelivery.objects.create(ticket=ticket, dedupe_key=key, recipient=recipient, kind=stage,
        mode=mode, subject=subject, html=html, text=text, cc=cc, status='dry_run' if mode == 'dry_run' else 'sending')
    quota.count += 1
    quota.save(update_fields=['count'])
    if mode == 'live':
        # A timeout is indeterminate: never blindly retry and double-send.
        payload = {'subject': subject, 'body': html, 'bodyFormat': 'html', 'isHtml': True,
            'senderName': 'KBC Learner Support', 'kpiCategory': ticket.source_type, 'idempotencyKey': key,
            'recipients': [{'learnerEmail': recipient, 'learnerName': ticket.learner_name, 'cc': [cc] if cc else [], 'ccEmail': cc,
                            'renderedSubject': subject, 'renderedTextBody': text, 'renderedHtmlBody': html, 'renderedBody': html}]}
        try:
            response = requests.post(settings.N8N_EMAIL_WEBHOOK, json=payload,
                                     headers={'Idempotency-Key': key}, timeout=30, allow_redirects=False)
            if 200 <= response.status_code < 300:
                delivery.status, delivery.sent_at = 'accepted', timezone.now()
            else:
                delivery.status, delivery.error = 'failed', f'Email gateway HTTP {response.status_code}; review before retry.'
        except requests.RequestException:
            delivery.status, delivery.error = 'unknown', 'Delivery uncertain. Check gateway before retrying.'
        delivery.save(update_fields=['status', 'error', 'sent_at'])
    event(ticket, 'email_' + delivery.status, {'delivery_id': delivery.pk, 'stage': stage, 'recipient': recipient, 'mode': mode})
    return delivery


def process_emails(limit=200):
    now = timezone.now()
    processed = 0
    for ticket in CaseTicket.objects.filter(archived=False).exclude(status='resolved').order_by('created_at').iterator():
        age = (now.astimezone(LONDON).date() - (ticket.evidence_after or ticket.created_at).astimezone(LONDON).date()).days
        stages = ['initial']
        if age >= 2:
            stages = ['day7' if age >= 7 else 'day5' if age >= 5 else 'day2']
        if age >= 7 or ticket.status == 'unreachable':
            stages.append('escalation')
        for stage in stages:
            delivery = send_ticket_email(ticket.pk, stage)
            if delivery:
                processed += 1
                if stage == 'escalation':
                    with transaction.atomic():
                        locked = CaseTicket.objects.select_for_update().get(pk=ticket.pk)
                        if locked.status != 'resolved' and not locked.escalated:
                            locked.escalated = True
                            locked.status = 'escalated'
                            release_fields(locked)
                            locked.save()
                            event(locked, 'escalated', {'reason': 'Reminder schedule exhausted', 'email_mode': delivery.mode})
            if processed >= limit:
                return processed
    for survey in EmployerSatisfaction.objects.filter(score__lte=2):
        if send_ticket_email(survey.ticket_id, 'low_score'):
            processed += 1
        if processed >= limit:
            break
    return processed
