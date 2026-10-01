import re
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings

LONDON = ZoneInfo('Europe/London')
SLA_DAYS = {'attendance': 2, 'mcm': 3, 'pr': 3, 'otj': 5, 'epa': 5, 'satisfaction': 14}
FAILED_RESULTS = {'no_answer', 'missed', 'busy', 'voicemail', 'rejected'}
WAITING = {'pending_learner', 'pending_verification', 'ai_suggested_close', 'unreachable', 'escalated'}
OPTIONS = {'catch_up_session', 'watch_recording', 'book_mcm', 'book_pr', 'other'}


def email_key(value):
    return str(value or '').strip().lower()


def normalize_phone(value):
    value = str(value or '').strip()
    if not value or re.search(r'[^\d\s()+.\-]', value):
        return ''
    digits = re.sub(r'\D', '', value)
    if value.startswith('00'):
        digits = digits[2:]
    elif digits.startswith('0'):
        digits = '44' + digits[1:]
    elif not value.startswith('+') and not digits.startswith('44'):
        return ''
    if digits.startswith('440'):
        digits = '44' + digits[3:]
    if not 8 <= len(digits) <= 15 or digits.startswith('0'):
        return ''
    if digits.startswith('44') and len(digits) != 12:
        return ''
    return '+' + digits


def working_day(day):
    holidays = getattr(settings, 'CALLCENTRE_HOLIDAYS', [])
    return day.weekday() < 5 and day.isoformat() not in holidays


def add_workdays(moment, count):
    local = moment.astimezone(LONDON)
    day = local.date()
    while count:
        day += timedelta(days=1)
        if working_day(day):
            count -= 1
    return datetime.combine(day, local.timetz(), tzinfo=LONDON)


def due_at(category, now, booking_at=None):
    if category == 'reminder':
        if booking_at is None:
            raise ValueError('Reminder needs a confirmed session time.')
        return booking_at
    return add_workdays(now, SLA_DAYS[category])


def retry_at(call_time, failed_count):
    if failed_count >= 3:
        return None
    if failed_count == 1:
        return call_time + timedelta(hours=2)
    return datetime.combine(add_workdays(call_time, 1).date(), time(9), tzinfo=LONDON)


def priority(ticket, now):
    today = now.astimezone(LONDON).date()
    overdue = max(0, (today - ticket.overdue_since).days) if ticket.overdue_since else 0
    tomorrow = bool(ticket.booking_at and ticket.booking_at.astimezone(LONDON).date() == today + timedelta(days=1))
    return (ticket.risk == 'red', ticket.due_at < now, overdue, ticket.misses, tomorrow, -ticket.attempts)


def parse_moment(value):
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=LONDON)
    if isinstance(value, dict):
        # Microsoft booking values may contain an explicit timezone.
        dt = datetime.fromisoformat(value['dateTime'].replace('Z', '+00:00'))
        if dt.tzinfo:
            return dt
        zone = value.get('timeZone', 'Europe/London')
        return dt.replace(tzinfo=ZoneInfo('Europe/London' if zone == 'GMT Standard Time' else zone))
    dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    return dt if dt.tzinfo else dt.replace(tzinfo=LONDON)
