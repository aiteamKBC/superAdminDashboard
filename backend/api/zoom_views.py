from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.core.cache import cache
from django.db import OperationalError, ProgrammingError, connections, transaction
from django.db.models import Count, Q, Sum
from django.db.models.functions import Substr, TruncDate
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from .models import ZoomPhoneCall, ZoomPhoneRecording, ZoomSyncState
from .zoom_phone import ACCOUNT_LABELS, ZoomError, account_config, missing_credentials, validate_config
from .callcenter.rules import normalize_phone


CONTACT_DIRECTORY_CACHE_KEY = 'zoom-phone-contact-directory-v1'


def contact_directory():
    cached = cache.get(CONTACT_DIRECTORY_CACHE_KEY)
    if isinstance(cached, dict):
        return cached
    buckets = {}

    def add(number, role, name, email):
        phone = normalize_phone(number)
        name = str(name or '').strip()
        email = str(email or '').strip().lower()
        if not phone or not name:
            return
        identity = (role, email or name.casefold())
        buckets.setdefault(phone, {})[identity] = {
            'name': name,
            'email': email,
            'role': role,
        }

    try:
        with transaction.atomic(using='aptem'), connections['aptem'].cursor() as cursor:
            if connections['aptem'].vendor == 'postgresql':
                cursor.execute("SET LOCAL statement_timeout = '20s'")
            cursor.execute('''SELECT "FullName", "Email", "Learner Phone",
                "ManagerName", "ManagerEmail", "Manager Phone"
                FROM public.aptem_auto_extracting''')
            for learner_name, learner_email, learner_phone, manager_name, manager_email, manager_phone in cursor.fetchall():
                add(learner_phone, 'learner', learner_name, learner_email)
                add(manager_phone, 'line_manager', manager_name, manager_email)
    except Exception:
        # Reporting remains available when the read-only source is temporarily down.
        pass

    try:
        from .callcenter.models import CaseTicket
        for phone, name, email in CaseTicket.objects.exclude(learner_phone='').values_list(
                'learner_phone', 'learner_name', 'learner_email').distinct().iterator():
            add(phone, 'learner', name, email)
    except (OperationalError, ProgrammingError):
        pass

    # Shared numbers are deliberately left unresolved instead of guessing a person.
    result = {phone: next(iter(contacts.values())) for phone, contacts in buckets.items() if len(contacts) == 1}
    cache.set(CONTACT_DIRECTORY_CACHE_KEY, result, 300)
    return result


def metrics():
    return {
        'calls': Count('id'),
        'answered': Count('id', filter=Q(result='answered')),
        'not_answered': Count('id', filter=~Q(result__in=['answered', 'other'])),
        'other': Count('id', filter=Q(result='other')),
        'total_duration_seconds': Sum('duration_seconds', default=0),
        'answered_duration_seconds': Sum('duration_seconds', filter=Q(result='answered'), default=0),
        'missing_duration': Count('id', filter=Q(duration_seconds__isnull=True)),
    }


def report_metrics(row):
    row['duration_seconds'] = row.pop('total_duration_seconds')
    return row


@never_cache
@require_GET
def zoom_call_report(request):
    if not request.user.is_authenticated or not request.user.is_active:
        return JsonResponse({'detail': 'Sign in to view call reports.'}, status=401)
    try:
        report_zone = ZoneInfo(settings.ZOOM_REPORT_TIME_ZONE)
    except ZoneInfoNotFoundError:
        return JsonResponse({'detail': 'The call reporting time zone is not configured correctly.'}, status=503)
    today = timezone.now().astimezone(report_zone).date()
    try:
        start = date.fromisoformat(request.GET.get('from', today.replace(day=1).isoformat()))
        end = date.fromisoformat(request.GET.get('to', today.isoformat()))
        page = int(request.GET.get('page', '1'))
        page_size = int(request.GET.get('page_size', '50'))
        if start > end or end == date.max or (end - start).days > 365 or not 1 <= page <= 1000000 or not 1 <= page_size <= 100:
            raise ValueError
    except (ValueError, TypeError):
        return JsonResponse({'detail': 'Use a valid date range of at most 366 days and a positive page.'}, status=400)
    source = request.GET.get('account', 'all')
    direction = request.GET.get('direction', 'outbound')
    if source not in ('all', *ACCOUNT_LABELS) or direction not in ('all', 'inbound', 'outbound'):
        return JsonResponse({'detail': 'Invalid account or call direction.'}, status=400)
    start_time = datetime.combine(start, time.min, tzinfo=report_zone)
    end_time = datetime.combine(end + timedelta(days=1), time.min, tzinfo=report_zone)
    configured_ids = Q(pk__in=[])
    for key in ACCOUNT_LABELS:
        account_id = account_config(key)['account_id']
        if account_id:
            configured_ids |= Q(source_account=key, zoom_account_id=account_id)
    try:
        base = ZoomPhoneCall.objects.filter(configured_ids, started_at__gte=start_time, started_at__lt=end_time)
        if direction != 'all':
            base = base.filter(direction=direction)
        states = {state.source_account: state for state in ZoomSyncState.objects.all()}
        accounts = []
        for key, label in ACCOUNT_LABELS.items():
            state = states.get(key)
            if state and state.zoom_account_id != account_config(key)['account_id']:
                state = None
            try:
                validate_config(key)
                configured = True
                configuration_error = ''
            except ZoomError:
                configured = False
                configuration_error = 'Zoom account setup is incomplete.'
            accounts.append({
                'key': key, 'label': label, 'configured': configured,
                'missing_settings': missing_credentials(key),
                'last_success_at': state.last_success_at if state else None,
                'covered_through': state.covered_through if state else None,
                'syncing': bool(state and state.locked_until and state.locked_until > timezone.now()),
                'error': configuration_error or (state.last_error if state else ''),
                'recordings_last_success_at': state.recordings_last_success_at if state else None,
                'recordings_error': state.recordings_error if state else '',
                **report_metrics(base.filter(source_account=key).aggregate(**metrics())),
            })
        selected = base if source == 'all' else base.filter(source_account=source)
        totals = report_metrics(selected.aggregate(**metrics()))
        daily = [report_metrics(row) for row in selected.order_by()
                 .annotate(date=TruncDate('started_at', tzinfo=report_zone))
                 .values('date', 'source_account').annotate(**metrics()).order_by('-date', 'source_account')]
        fields = (
            'id', 'source_account', 'history_id', 'call_id', 'direction', 'caller_number',
            'caller_name', 'caller_user_id', 'caller_email', 'callee_number', 'callee_name',
            'started_at', 'answered_at', 'ended_at', 'duration_seconds', 'result', 'raw_result',
        )
        offset = (page - 1) * page_size
        calls = list(selected.values(*fields)[offset:offset + page_size])
        directory = contact_directory()
        for call in calls:
            number = call['callee_number'] if call['direction'] == 'outbound' else call['caller_number']
            contact = directory.get(normalize_phone(number), {})
            call['contact_name'] = contact.get('name', '')
            call['contact_email'] = contact.get('email', '')
            call['contact_role'] = contact.get('role', '')
    except (OperationalError, ProgrammingError):
        return JsonResponse({'detail': 'Call reporting is temporarily unavailable.'}, status=503)
    return JsonResponse({
        'from': start, 'to': end, 'timezone': settings.ZOOM_REPORT_TIME_ZONE,
        'account': source, 'direction': direction, 'accounts': accounts, 'totals': totals,
        'daily': daily, 'calls': calls, 'page': page, 'page_size': page_size,
        'total_records': totals['calls'], 'has_next': offset + page_size < totals['calls'],
    })


def current_account_filter():
    query = Q(pk__in=[])
    for key in ACCOUNT_LABELS:
        account_id = account_config(key)['account_id']
        if account_id:
            query |= Q(source_account=key, zoom_account_id=account_id)
    return query


@never_cache
@require_GET
def zoom_transcript_report(request):
    if not request.user.is_authenticated or not request.user.is_active:
        return JsonResponse({'detail': 'Sign in to view transcripts.'}, status=401)
    try:
        report_zone = ZoneInfo(settings.ZOOM_REPORT_TIME_ZONE)
    except ZoneInfoNotFoundError:
        return JsonResponse({'detail': 'The call reporting time zone is not configured correctly.'}, status=503)
    today = timezone.now().astimezone(report_zone).date()
    try:
        start = date.fromisoformat(request.GET.get('from', today.replace(day=1).isoformat()))
        end = date.fromisoformat(request.GET.get('to', today.isoformat()))
        page = int(request.GET.get('page', '1'))
        page_size = int(request.GET.get('page_size', '25'))
        if start > end or end == date.max or (end - start).days > 365 or not 1 <= page <= 1000000 or not 1 <= page_size <= 50:
            raise ValueError
    except (ValueError, TypeError):
        return JsonResponse({'detail': 'Use a valid date range of at most 366 days and a positive page.'}, status=400)
    source = request.GET.get('account', 'all')
    status = request.GET.get('status', 'all')
    statuses = ('ready', 'pending', 'disabled', 'unavailable', 'error')
    if source not in ('all', *ACCOUNT_LABELS) or status not in ('all', *statuses):
        return JsonResponse({'detail': 'Invalid transcript filter.'}, status=400)
    start_time = datetime.combine(start, time.min, tzinfo=report_zone)
    end_time = datetime.combine(end + timedelta(days=1), time.min, tzinfo=report_zone)
    try:
        base = ZoomPhoneRecording.objects.filter(
            current_account_filter(), started_at__gte=start_time, started_at__lt=end_time,
        )
        if source != 'all':
            base = base.filter(source_account=source)
        summary = {
            'total': base.count(),
            **{item: base.filter(transcript_status=item).count() for item in statuses},
        }
        accounts = []
        for key, label in ACCOUNT_LABELS.items():
            rows = base.filter(source_account=key)
            accounts.append({
                'key': key,
                'label': label,
                'total': rows.count(),
                **{item: rows.filter(transcript_status=item).count() for item in statuses},
            })
        selected = base if status == 'all' else base.filter(transcript_status=status)
        total_records = selected.count()
        offset = (page - 1) * page_size
        records = list(selected.annotate(preview=Substr('transcript_text', 1, 240)).values(
            'id', 'source_account', 'recording_type', 'owner_name', 'started_at',
            'duration_seconds', 'transcript_status', 'transcript_error',
            'transcript_checked_at', 'preview',
        ).order_by('-started_at', '-id')[offset:offset + page_size])
    except (OperationalError, ProgrammingError):
        return JsonResponse({'detail': 'Transcripts are temporarily unavailable.'}, status=503)
    return JsonResponse({
        'from': start,
        'to': end,
        'timezone': settings.ZOOM_REPORT_TIME_ZONE,
        'account': source,
        'status': status,
        'summary': summary,
        'accounts': accounts,
        'records': records,
        'page': page,
        'page_size': page_size,
        'total_records': total_records,
        'has_next': offset + page_size < total_records,
    })


@never_cache
@require_GET
def zoom_call_recordings(request, call_pk):
    if not request.user.is_authenticated or not request.user.is_active:
        return JsonResponse({'detail': 'Sign in to view recordings.'}, status=401)
    try:
        call = ZoomPhoneCall.objects.filter(current_account_filter(), pk=call_pk).first()
        if call is None:
            return JsonResponse({'detail': 'Call not found.'}, status=404)
        match = Q(call_log_id=call.history_id)
        if call.call_id:
            match |= Q(call_id=call.call_id)
        recordings = ZoomPhoneRecording.objects.filter(
            match, source_account=call.source_account, zoom_account_id=call.zoom_account_id,
        )
        return JsonResponse({'call_id': call.pk, 'recordings': list(recordings.values(
            'id', 'recording_id', 'call_id', 'call_log_id', 'call_element_id', 'recording_type',
            'owner_name', 'started_at', 'duration_seconds', 'transcript_status',
            'transcript_error', 'transcript_checked_at',
        ))})
    except (OperationalError, ProgrammingError):
        return JsonResponse({'detail': 'Recordings are temporarily unavailable.'}, status=503)


@never_cache
@require_GET
def zoom_recording_transcript(request, recording_pk):
    if not request.user.is_authenticated or not request.user.is_active:
        return JsonResponse({'detail': 'Sign in to view transcripts.'}, status=401)
    try:
        recording = ZoomPhoneRecording.objects.filter(current_account_filter(), pk=recording_pk).first()
        if recording is None:
            return JsonResponse({'detail': 'Recording not found.'}, status=404)
        return JsonResponse({
            'id': recording.pk, 'source_account': recording.source_account,
            'status': recording.transcript_status, 'text': recording.transcript_text,
            'transcript': recording.transcript_data, 'error': recording.transcript_error,
            'checked_at': recording.transcript_checked_at,
        })
    except (OperationalError, ProgrammingError):
        return JsonResponse({'detail': 'Transcripts are temporarily unavailable.'}, status=503)
