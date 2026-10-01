import hashlib
import json
from contextlib import ExitStack, contextmanager
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from urllib.parse import urlparse

from django.db import connections, transaction
from django.utils import timezone

from api.models import DashboardBooking
from .models import CaseTicket, CycleState, TicketEvent
from .rules import LONDON, due_at, email_key, normalize_phone, parse_moment
from .services import LEGACY, event


@contextmanager
def source_transaction(alias):
    with transaction.atomic(using=alias):
        if connections[alias].vendor == 'postgresql':
            with connections[alias].cursor() as cursor:
                cursor.execute('SET TRANSACTION READ ONLY')
                cursor.execute("SET LOCAL statement_timeout = '20s'")
        yield


def rows(alias, sql, params=()):
    with source_transaction(alias), connections[alias].cursor() as cursor:
        cursor.execute(sql, params)
        columns = [item[0] for item in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]


def profiles():
    data = rows('aptem', '''SELECT "ID", "FullName", "Email", "Learner Phone", "OwnerName",
        "OrganizationName", "Program Name", "ManagerName", "ManagerEmail"
        FROM public.aptem_auto_extracting''')
    result, ambiguous = {}, set()
    for item in data:
        email = email_key(item['Email'])
        if not email:
            continue
        if email in result:
            ambiguous.add(email)
        result[email] = {
            'learner_email': email, 'learner_name': str(item['FullName'] or ''),
            'learner_phone': normalize_phone(item['Learner Phone']), 'coach': str(item['OwnerName'] or ''),
            'organisation': str(item['OrganizationName'] or ''), 'programme': str(item['Program Name'] or ''),
            'manager_name': str(item['ManagerName'] or ''), 'manager_email': email_key(item['ManagerEmail']),
        }
    for email in ambiguous:
        result.pop(email, None)
    return result


def source_health(name, error='', count=0):
    state, _ = CycleState.objects.get_or_create(name='source:' + name)
    state.details = {'error': error, 'count': count, 'checked_at': timezone.now().isoformat()}
    if not error:
        state.last_success_at = timezone.now()
    state.save()


def get_source(name, fn):
    try:
        value = fn()
        source_health(name, count=len(value))
        return value
    except Exception as exc:
        # Provider/DB exceptions may include credentials or personal values.
        source_health(name, error=f'{name} unavailable ({type(exc).__name__}); no automatic resolution from this source.')
        return None


def safe_date(value):
    from api.views import parse_date_safe
    return parse_date_safe(value)


def reason_key(category, email, discriminator):
    digest = hashlib.sha256(str(discriminator).encode()).hexdigest()[:32]
    return f'{category}:{email}:{digest}'


@transaction.atomic
def upsert_case(category, profile, discriminator, *, legacy=None, risk='amber', overdue=None,
                misses=0, booking_at=None, data=None):
    now = timezone.now()
    email = email_key(profile.get('learner_email'))
    if not email:
        return None, False
    key = reason_key(category, email, discriminator)
    existing = CaseTicket.objects.filter(source_type=category, source_id=legacy.pk).first() if legacy else None
    defaults = {**profile, 'learner_email': email, 'learner_phone': normalize_phone(profile.get('learner_phone')),
                'source_type': category, 'source_id': legacy.pk if legacy else None,
                'risk': risk, 'overdue_since': overdue, 'misses': misses, 'booking_at': booking_at,
                'source_data': data or {}, 'due_at': due_at(category, now, booking_at)}
    case, created = (existing, False) if existing else CaseTicket.objects.get_or_create(reason_key=key, defaults=defaults)
    if created:
        event(case, 'created', {'source': category, 'source_id': case.source_id, 'reason': str(discriminator)})
    elif case.status != 'resolved':
        # Refresh contacts/risk, but never reset workflow, claims, SLA or previous decisions.
        changes = {k: defaults[k] for k in profile if k != 'learner_email'}
        changes.update(risk=risk, misses=misses)
        if legacy and case.source_id is None:
            changes['source_id'] = legacy.pk
        CaseTicket.objects.filter(pk=case.pk).update(**changes)
    return case, created


@transaction.atomic
def import_legacy(people):
    now = timezone.now()
    existing = list(CaseTicket.objects.filter(source_type__in=LEGACY))
    by_source = {(case.source_type, case.source_id): case for case in existing if case.source_id}
    by_reason = {case.reason_key: case for case in existing}
    new, changed = [], {}
    contact_fields = ['learner_name', 'learner_phone', 'coach', 'organisation', 'programme', 'manager_name', 'manager_email']
    for category, model in LEGACY.items():
        for old in model.objects.filter(is_archived=False).exclude(status__in=['resolved', 'covered']).iterator():
            email = email_key(old.learner_email)
            profile = people.get(email, {
                'learner_email': email, 'learner_name': old.learner_name,
                'learner_phone': normalize_phone(old.learner_phone), 'coach': getattr(old, 'coach_name', ''),
                'organisation': old.organisation, 'programme': old.programme,
            })
            activity_date = getattr(old, 'attendance_date', None) or getattr(old, 'next_pr_date', None)
            if category == 'mcm':
                activity_date = safe_date(old.next_mcm_date)
            if category == 'epa':
                activity_date = old.end_date + timedelta(days=7) if old.end_date else None
            module = getattr(old, 'attendance_module', '')
            discriminator = f'{activity_date}:{module}' if activity_date else f'legacy:{old.pk}'
            key = reason_key(category, email, discriminator)
            case = by_source.get((category, old.pk)) or by_reason.get(key)
            if case:
                if case.status == 'resolved':
                    continue
                dirty = False
                for field in contact_fields:
                    if field in profile and getattr(case, field) != profile[field]:
                        setattr(case, field, profile[field])
                        dirty = True
                if case.source_id is None:
                    case.source_id = old.pk
                    dirty = True
                if dirty and case.pk:
                    changed[case.pk] = case
                continue
            case = CaseTicket(**profile, reason_key=key, source_type=category, source_id=old.pk,
                              risk=old.risk, overdue_since=activity_date, misses=getattr(old, 'overdue_count', 0),
                              due_at=due_at(category, now), source_data={'module': module, 'legacy_ref': old.ticket_ref})
            new.append(case)
            by_reason[key] = case
            by_source[(category, old.pk)] = case
    CaseTicket.objects.bulk_create(new, batch_size=200)
    TicketEvent.objects.bulk_create([TicketEvent(ticket=case, kind='created', data={
        'source': case.source_type, 'source_id': case.source_id, 'reason': case.reason_key,
    }) for case in new], batch_size=200)
    if changed:
        CaseTicket.objects.bulk_update(list(changed.values()), contact_fields + ['source_id'], batch_size=100)
    return len(new)


def read_summary(fn):
    # Reuse the existing read-only calculations, without invoking any auto-create endpoint.
    with ExitStack() as stack:
        for alias in ('default', 'aptem'):
            stack.enter_context(source_transaction(alias))
        response = fn(SimpleNamespace(GET={}))
        if response.status_code != 200:
            raise ValueError('Source summary failed.')
        return json.loads(response.content)


def generate_risks(people):
    from api import views
    today = timezone.now().astimezone(LONDON).date()
    total = 0
    existing = list(CaseTicket.objects.exclude(status='resolved').values('source_type', 'learner_email', 'overdue_since', 'source_data'))
    open_reasons = {(c['source_type'], c['learner_email'], c['overdue_since'] if c['source_type'] == 'attendance' else None,
                     c['source_data'].get('module', '') if c['source_type'] == 'attendance' else '') for c in existing}
    loaders = {
        'pr': lambda: read_summary(views.progress_review_summary),
        'mcm': lambda: read_summary(views.mcr_summary),
        'otj': lambda: read_summary(views.otj_at_risk_summary),
        'epa': lambda: read_summary(views.epa_summary)['epaOverdue'],
    }
    # Include recent weeks plus all existing legacy attendance tickets.
    def attendance():
        output = []
        monday = today - timedelta(days=today.weekday())
        with source_transaction('default'), source_transaction('aptem'):
            for week in range(4):
                start = monday - timedelta(weeks=week)
                output.extend(views._attendance_missing_learners_for_week(start, min(today, start + timedelta(days=6))))
        return output
    loaders['attendance'] = attendance
    for category, loader in loaders.items():
        data = get_source(category, loader)
        if data is None:
            continue
        resolved = list(LEGACY[category].objects.filter(status__in=['resolved', 'covered']))
        for item in data:
            email = email_key(item.get('email'))
            if email not in people:
                continue
            count, risk, overdue, module = 1, 'amber', None, ''
            if category == 'pr':
                count = item.get('overduePrCount', 0)
                overdue = safe_date(item.get('duePrDate'))
                risk = 'red' if item.get('reviewStatus') == 'Due' else 'amber'
            elif category == 'mcm':
                payload = views._mcm_payload_from_summary_row(item)
                count, risk = payload['overdue_count'], payload['risk']
                overdue = safe_date(payload['next_mcm_date'])
            elif category == 'otj':
                count = int(str(item.get('otjHoursStatus', '')).lower() == 'at risk')
            elif category == 'epa':
                end = safe_date(item.get('endDate'))
                overdue = end + timedelta(days=7) if end else None
                risk = 'red'
            else:
                count = item.get('missed_count', 1)
                overdue = safe_date(item.get('attendance_date'))
                module = item.get('attendance_module', '')
                risk = views._attendance_ticket_risk(count)
            if not count:
                continue
            # Preserve historical human resolutions of the same legacy reason.
            matching_resolved = [r for r in resolved if email_key(r.learner_email) == email]
            if category == 'attendance':
                matching_resolved = [r for r in matching_resolved if r.attendance_date == overdue and r.attendance_module == module]
            elif category == 'pr':
                matching_resolved = [r for r in matching_resolved if r.next_pr_date == overdue]
            elif category == 'mcm':
                matching_resolved = [r for r in matching_resolved if safe_date(r.next_mcm_date) == overdue]
            elif category == 'epa':
                matching_resolved = [r for r in matching_resolved if r.end_date and r.end_date + timedelta(days=7) == overdue]
            if matching_resolved:
                continue
            open_key = (category, email, overdue if category == 'attendance' else None, module if category == 'attendance' else '')
            if open_key in open_reasons:
                continue
            discriminator = f'{overdue}:{module}' if overdue else f"source:{item.get('id', email)}"
            # Resolved source reasons stay closed until a distinct dated issue appears.
            _, fresh = upsert_case(category, people[email], discriminator, risk=risk, overdue=overdue,
                                   misses=count, data={'module': module, 'source_learner_id': str(item.get('id', ''))})
            total += fresh
            open_reasons.add(open_key)
    return total


def refresh_recording_links():
    data = rows('default', '''SELECT s.module, s.session_date, r.recording_url_written
        FROM public.lecture_sessions s JOIN public.lecture_recording_links r ON r.lecture_id = s.lecture_id
        WHERE s.is_cancelled IS NOT TRUE AND r.recording_url_written IS NOT NULL''')
    links = {}
    for row in data:
        url = str(row['recording_url_written'] or '').strip()
        if urlparse(url).scheme == 'https' and urlparse(url).netloc:
            links.setdefault((str(row['module']), str(row['session_date'])), set()).add(url)
    changed = 0
    for ticket in CaseTicket.objects.filter(source_type='attendance', archived=False).exclude(status='resolved'):
        urls = links.get((ticket.source_data.get('module'), str(ticket.overdue_since)), set())
        url = next(iter(urls)) if len(urls) == 1 else ''
        if ticket.source_data.get('recording_url', '') != url:
            data = {**ticket.source_data, 'recording_url': url}
            CaseTicket.objects.filter(pk=ticket.pk).update(source_data=data)
            changed += 1
    return list(links)


def decode_json(value):
    return json.loads(value) if isinstance(value, str) else value


def load_bookings(people):
    tomorrow = timezone.now().astimezone(LONDON).date() + timedelta(days=1)
    result = {}
    for item in DashboardBooking.objects.filter(booking_date=tomorrow):
        email = email_key(item.learner_email)
        if email not in people:
            continue
        start = datetime.combine(item.booking_date, item.booking_time, tzinfo=LONDON)
        category = item.session_type.lower()
        key = f'{email}:{category}:{start.isoformat()}'
        result[key] = {'email': email, 'start': start, 'type': category, 'id': str(item.pk), 'source': 'dashboard_bookings'}
    coach_rows = rows('default', '''SELECT case_owner, "booked_students_PR" AS pr,
        "booked_students_MCM" AS mcm, "booked_students_StSupport" AS support FROM public.coaches_data''')
    for coach in coach_rows:
        for field, category in [('pr', 'pr'), ('mcm', 'mcm'), ('support', 'support')]:
            raw = decode_json(coach.get(field)) or {}
            items = raw.get('students', []) if isinstance(raw, dict) else []
            for item in items:
                email = email_key(item.get('customerEmail'))
                if email not in people or (item.get('matched_student_email') and email_key(item['matched_student_email']) != email):
                    continue
                try:
                    start = parse_moment(item.get('startDateTime'))
                except (ValueError, TypeError, KeyError):
                    continue
                if start.astimezone(LONDON).date() != tomorrow:
                    continue
                key = f'{email}:{category}:{start.astimezone(LONDON).isoformat()}'
                result.setdefault(key, {'email': email, 'start': start, 'type': category,
                                        'id': str(item.get('appointmentId', '')), 'source': 'coaches_data'})
    return list(result.values())


def generate_reminders(people, bookings):
    count = 0
    for booking in bookings:
        _, created = upsert_case('reminder', people[booking['email']],
            f"{booking['type']}:{booking['start'].astimezone(LONDON).isoformat()}", booking_at=booking['start'],
            data={'booking_id': booking['id'], 'booking_source': booking['source'], 'session_type': booking['type']})
        count += created
    return count
