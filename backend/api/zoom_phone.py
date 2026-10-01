"""Zoom Phone ingestion. Credentials stay on the server; reports read stored calls."""

import os
import time
import uuid
from datetime import timedelta

import requests
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .models import ZoomPhoneCall, ZoomSyncState


ACCOUNT_LABELS = {'student': 'Student', 'office': 'Office (Accountant)'}
CREDENTIAL_FIELDS = ('ACCOUNT_ID', 'CLIENT_ID', 'CLIENT_SECRET')


class ZoomError(Exception):
    """Public error text must never contain Zoom responses or credentials."""


def account_config(key):
    if key not in ACCOUNT_LABELS:
        raise ZoomError('Unknown Zoom account.')
    return {field.lower(): os.getenv(f'ZOOM_{key.upper()}_{field}', '').strip()
            for field in CREDENTIAL_FIELDS}


def missing_credentials(key):
    config = account_config(key)
    return [f'ZOOM_{key.upper()}_{field}' for field in CREDENTIAL_FIELDS
            if not config[field.lower()]]


def validate_config(key):
    missing = missing_credentials(key)
    if missing:
        raise ZoomError('Missing settings: ' + ', '.join(missing))
    config = account_config(key)
    other = 'office' if key == 'student' else 'student'
    if config['account_id'] == account_config(other)['account_id']:
        raise ZoomError('Student and Office (Accountant) must use different Zoom account IDs.')
    return config


class ZoomClient:
    def __init__(self, config):
        self.config = config
        self.session = requests.Session()
        self.token = ''
        self.expires_at = 0

    def close(self):
        self.session.close()

    def _request(self, method, url, **kwargs):
        kwargs.setdefault('allow_redirects', False)
        for attempt in range(3):
            try:
                response = self.session.request(method, url, timeout=(10, 45), **kwargs)
            except requests.RequestException:
                if attempt == 2:
                    raise ZoomError('Zoom connection failed; the next sync will retry.') from None
                time.sleep(2 ** attempt)
                continue
            if response.status_code in (429, 500, 502, 503, 504) and attempt < 2:
                try:
                    delay = max(1, int(response.headers.get('Retry-After', 2 ** attempt)))
                except (ValueError, TypeError):
                    delay = 2 ** attempt
                if delay > 30:
                    response.close()
                    raise ZoomError('Zoom rate limit reached; retry on the next scheduled sync.')
                response.close()
                time.sleep(delay)
                continue
            return response

    @staticmethod
    def _json(response):
        if not response.ok:
            try:
                code = str(response.json().get('code', ''))
            except (ValueError, AttributeError):
                code = ''
            if code == '2031':
                raise ZoomError('Zoom Phone is not enabled for this account (Zoom 2031).')
            raise ZoomError(f'Zoom request failed (HTTP {response.status_code}); check app credentials, scopes and license.')
        if 300 <= response.status_code < 400:
            raise ZoomError('Zoom API returned an unexpected redirect.')
        try:
            payload = response.json()
        except ValueError:
            raise ZoomError('Zoom returned an invalid JSON response.') from None
        if not isinstance(payload, dict):
            raise ZoomError('Zoom returned an unexpected response structure.')
        return payload

    def _authorize(self):
        response = self._request(
            'POST', 'https://zoom.us/oauth/token',
            auth=(self.config['client_id'], self.config['client_secret']),
            data={'grant_type': 'account_credentials', 'account_id': self.config['account_id']},
        )
        payload = self._json(response)
        if not isinstance(payload.get('access_token'), str) or not payload['access_token']:
            raise ZoomError('Zoom did not return an access token.')
        self.token = payload['access_token']
        try:
            lifetime = max(0, int(payload.get('expires_in', 3600)) - 60)
        except (ValueError, TypeError):
            raise ZoomError('Zoom returned an invalid token lifetime.') from None
        self.expires_at = time.monotonic() + lifetime

    def api_get(self, path, **kwargs):
        if time.monotonic() >= self.expires_at:
            self._authorize()
        response = self._request('GET', 'https://api.zoom.us/v2' + path,
                                 headers={'Authorization': f'Bearer {self.token}'}, **kwargs)
        if response.status_code == 401:
            response.close()
            self._authorize()
            response = self._request('GET', 'https://api.zoom.us/v2' + path,
                                     headers={'Authorization': f'Bearer {self.token}'}, **kwargs)
        return response

    def pages(self, start, end):
        yield from self._pages('/phone/call_history', ('call_history', 'call_logs'), start, end)

    def recording_pages(self, start, end):
        yield from self._pages('/phone/recordings', ('recordings',), start, end)

    def _pages(self, path, keys, start, end):
        token = ''
        seen = set()
        while True:
            params = {'from': start.isoformat(), 'to': end.isoformat(), 'page_size': 300}
            if token:
                params['next_page_token'] = token
            response = self.api_get(path, params=params)
            try:
                payload = self._json(response)
            finally:
                response.close()
            rows = next((payload[key] for key in keys if key in payload), None)
            # Zoom can omit the collection on a successful, explicitly empty response.
            if rows is None and payload.get('total_records') == 0 and not payload.get('next_page_token'):
                rows = []
            if not isinstance(rows, list):
                raise ZoomError('Zoom returned an invalid collection; sync was not marked complete.')
            yield rows
            token = payload.get('next_page_token') or ''
            if not token:
                break
            if not isinstance(token, str) or token in seen or len(seen) >= 10000:
                raise ZoomError('Zoom pagination repeated or exceeded the page limit.')
            seen.add(token)


def mapped_result(value):
    value = str(value or '').strip().lower().replace('-', '_').replace(' ', '_')
    return {
        'answered': 'answered', 'connected': 'answered', 'completed': 'answered',
        'unanswered': 'no_answer', 'not_answered': 'no_answer', 'no_answer': 'no_answer',
        'hang_up': 'no_answer', 'missed': 'missed', 'busy': 'busy',
        'rejected': 'rejected', 'declined': 'rejected', 'denied': 'rejected',
        'voicemail': 'voicemail', 'voice_mail': 'voicemail',
    }.get(value, 'other')


def call_datetime(value, required=False):
    if value in (None, '') and not required:
        return None
    try:
        parsed = parse_datetime(str(value))
    except (ValueError, TypeError):
        parsed = None
    if parsed is None or timezone.is_naive(parsed):
        raise ZoomError('A Zoom call has a missing or invalid timestamp; sync will retry.')
    return parsed


def normalize_call(key, account_id, row):
    if not isinstance(row, dict):
        raise ZoomError('Zoom returned an invalid call record.')
    history_id = row.get('id') or row.get('call_history_uuid')
    if not history_id or row.get('direction') not in ('inbound', 'outbound'):
        raise ZoomError('A Zoom call has no history ID or valid direction; sync will retry.')
    duration = row.get('duration')
    if duration is not None:
        try:
            number = float(duration)
            if isinstance(duration, bool) or not number.is_integer() or number < 0 or number > 2147483647:
                raise ValueError
            duration = int(number)
        except (ValueError, TypeError, OverflowError):
            raise ZoomError('Zoom returned an invalid call duration.') from None
    # Keep Zoom's own duration. End minus start can include ringing/waiting time.
    values = {
        'source_account': key, 'zoom_account_id': account_id, 'history_id': str(history_id),
        'call_id': str(row.get('call_id') or ''), 'direction': row['direction'],
        'caller_number': str(row.get('caller_did_number') or row.get('caller_number') or ''),
        'caller_name': str(row.get('caller_name') or ''),
        'caller_user_id': str(row.get('caller_ext_id') or ''),
        'caller_email': str(row.get('caller_email') or ''),
        'callee_number': str(row.get('callee_did_number') or row.get('callee_number') or ''),
        'callee_name': str(row.get('callee_name') or ''),
        'started_at': call_datetime(row.get('start_time'), required=True),
        'answered_at': call_datetime(row.get('answer_time')),
        'ended_at': call_datetime(row.get('end_time')),
        'duration_seconds': duration,
        'raw_result': str(row.get('call_result') or row.get('result') or ''),
        'result': mapped_result(row.get('call_result') or row.get('result')),
    }
    for field in ZoomPhoneCall._meta.fields:
        if field.max_length and len(str(values.get(field.name, ''))) > field.max_length:
            raise ZoomError('A Zoom call field exceeds its supported length.')
    return values


def sync_account(key, start=None, end=None, include_recordings=False):
    config = validate_config(key)
    end = end or timezone.now().date()
    if end > timezone.now().date():
        raise ZoomError('Cannot import future call history.')
    if start and start > end:
        raise ZoomError('The start date must not be after the end date.')
    state, _ = ZoomSyncState.objects.get_or_create(
        source_account=key, defaults={'zoom_account_id': config['account_id']},
    )
    now = timezone.now()
    lock_token = str(uuid.uuid4())
    owned = ZoomSyncState.objects.filter(pk=key).filter(
        Q(locked_until__isnull=True) | Q(locked_until__lt=now),
    ).update(locked_until=now + timedelta(minutes=10), lock_token=lock_token)
    if not owned:
        raise ZoomError('This account is already syncing.')
    lease = ZoomSyncState.objects.filter(pk=key, lock_token=lock_token)
    client = ZoomClient(config)
    total = 0
    calls_complete = False
    requested_start = start
    try:
        if state.zoom_account_id != config['account_id']:
            state.covered_through = None
            state.recordings_covered_through = None
            lease.update(zoom_account_id=config['account_id'], covered_through=None, last_success_at=None,
                         recordings_covered_through=None, recordings_last_success_at=None, recordings_error='')
        start = start or ((state.covered_through - timedelta(days=2)) if state.covered_through
                          else end - timedelta(days=10))
        current = start
        while current <= end:
            window_end = min(current + timedelta(days=27), end)
            for rows in client.pages(current, window_end):
                if not lease.update(locked_until=timezone.now() + timedelta(minutes=10)):
                    raise ZoomError('Sync lease expired; another sync has taken over.')
                unique = {}
                for row in rows:
                    values = normalize_call(key, config['account_id'], row)
                    unique[values['history_id']] = ZoomPhoneCall(**values)
                fields = [field.name for field in ZoomPhoneCall._meta.fields
                          if field.name not in ('id', 'zoom_account_id', 'history_id')]
                with transaction.atomic():
                    ZoomPhoneCall.objects.bulk_create(
                        list(unique.values()), update_conflicts=True, update_fields=fields,
                        unique_fields=['zoom_account_id', 'history_id'], batch_size=300,
                    )
                total += len(unique)
            # Only advance a contiguous checkpoint after every page in this window succeeded.
            if state.covered_through is None or current <= state.covered_through + timedelta(days=1):
                state.covered_through = max(window_end, state.covered_through or window_end)
                lease.update(covered_through=state.covered_through)
            current = window_end + timedelta(days=1)
        lease.update(last_success_at=timezone.now(), last_error='')
        calls_complete = True
        if include_recordings:
            from .zoom_recordings import sync_recordings
            sync_recordings(client, key, config['account_id'], state, lease, requested_start, end)
        return total
    except ZoomError as exc:
        lease.update(**{('recordings_error' if calls_complete else 'last_error'): str(exc)[:255]})
        raise
    except Exception:
        lease.update(**{('recordings_error' if calls_complete else 'last_error'):
                        'Zoom storage failed; check the database and migrations.'})
        raise ZoomError('Zoom storage failed; check the database and migrations.') from None
    finally:
        client.close()
        lease.update(locked_until=None, lock_token='')
