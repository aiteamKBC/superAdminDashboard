"""Persist Zoom Phone recording metadata and transcripts, never OAuth/download tokens."""

import json
import time
from tempfile import SpooledTemporaryFile
from datetime import timedelta
from urllib.parse import quote, urljoin, urlsplit

import requests
from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from .models import ZoomPhoneRecording
from .zoom_phone import ZoomError, call_datetime


MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024
MAX_AUDIO_BYTES = 25 * 1024 * 1024
TRANSCRIPTS_PER_SYNC = 200


def renew_lease(lease):
    if not lease.update(locked_until=timezone.now() + timedelta(minutes=10)):
        raise ZoomError('Sync lease expired; another sync has taken over.')


def recording_values(key, account_id, row):
    if not isinstance(row, dict) or not isinstance(row.get('id'), str) or not row['id']:
        raise ZoomError('Zoom returned a recording without a valid ID.')
    owner = row.get('owner') or {}
    if not isinstance(owner, dict):
        raise ZoomError('Zoom returned an invalid recording owner.')
    duration = row.get('duration')
    if duration is not None:
        try:
            number = float(duration)
            if isinstance(duration, bool) or not number.is_integer() or not 0 <= number <= 2147483647:
                raise ValueError
            duration = int(number)
        except (ValueError, TypeError, OverflowError):
            raise ZoomError('Zoom returned an invalid recording duration.') from None
    values = {
        'source_account': key, 'zoom_account_id': account_id, 'recording_id': row['id'],
        **{field: str(row.get(field) or '') for field in (
            'call_id', 'call_log_id', 'call_element_id', 'direction', 'caller_number', 'caller_name',
            'callee_number', 'callee_name', 'recording_type',
        )},
        'owner_id': str(owner.get('id') or ''), 'owner_name': str(owner.get('name') or ''),
        'started_at': call_datetime(row.get('date_time'), required=True),
        'ended_at': call_datetime(row.get('end_time')), 'duration_seconds': duration,
    }
    for field in ZoomPhoneRecording._meta.fields:
        if field.max_length and len(str(values.get(field.name, ''))) > field.max_length:
            raise ZoomError('A Zoom recording field exceeds its supported length.')
    return values


def safe_download_url(url):
    try:
        parsed = urlsplit(url)
        host = (parsed.hostname or '').lower()
        trusted = any(host == domain or host.endswith('.' + domain) for domain in ('zoom.us', 'zoomgov.com'))
        if (parsed.scheme != 'https' or not trusted or parsed.username or parsed.password
                or parsed.port not in (None, 443) or parsed.fragment):
            raise ValueError
    except ValueError:
        raise ZoomError('Zoom returned an untrusted transcript download destination.') from None
    return url


def read_json_file(response):
    try:
        size = int(response.headers.get('Content-Length', '0'))
    except (ValueError, TypeError):
        size = 0
    if size > MAX_TRANSCRIPT_BYTES:
        raise ZoomError('Zoom transcript exceeds the 4 MB import limit.')
    chunks = []
    total = 0
    for chunk in response.iter_content(chunk_size=65536):
        total += len(chunk)
        if total > MAX_TRANSCRIPT_BYTES:
            raise ZoomError('Zoom transcript exceeds the 4 MB import limit.')
        chunks.append(chunk)
    try:
        payload = json.loads(b''.join(chunks).decode('utf-8-sig'))
    except (ValueError, UnicodeError):
        raise ZoomError('Zoom returned an invalid transcript file.') from None
    if not isinstance(payload, dict):
        raise ZoomError('Zoom returned an invalid transcript structure.')
    return payload


def fetch_transcript(client, recording_id):
    path = '/phone/recording_transcript/download/' + quote(recording_id, safe='')
    url = 'https://api.zoom.us/v2' + path
    response = client.api_get(path, stream=True)
    for hop in range(5):
        try:
            if response.status_code in (301, 302, 303, 307, 308):
                location = response.headers.get('Location', '')
                if not location or hop == 4:
                    raise ZoomError('Zoom transcript redirect limit reached.')
                url = safe_download_url(urljoin(url, location))
            else:
                payload = read_json_file(response)
                code = str(payload.get('code', ''))
                statuses = {'12000': 'unavailable', '12001': 'disabled', '12002': 'pending', '404': 'unavailable'}
                if response.status_code in (400, 404) and code in statuses:
                    return statuses[code], '', {}
                if not response.ok:
                    raise ZoomError(f'Zoom transcript request failed (HTTP {response.status_code}); check scopes and license.')
                timeline = payload.get('timeline')
                if not isinstance(timeline, list):
                    raise ZoomError('Zoom transcript has no valid timeline.')
                # Keep text as data; never execute provider content or render it as HTML.
                lines = []
                for segment in timeline:
                    if not isinstance(segment, dict) or not isinstance(segment.get('text', ''), str):
                        raise ZoomError('Zoom transcript contains an invalid segment.')
                    text = segment.get('text', '').strip()
                    if text:
                        lines.append(text)
                text = '\n'.join(lines)
                return ('ready', text, payload) if text else ('pending', '', {})
        finally:
            response.close()
        # Signed Zoom redirects are fetched without forwarding the OAuth bearer token.
        response = client._request('GET', url, stream=True, allow_redirects=False)


def ai_transcription_enabled():
    return bool(settings.ZOOM_AI_TRANSCRIPTION_ENABLED and settings.OPENAI_API_KEY
                and settings.OPENAI_TRANSCRIPTION_MODEL)


def download_audio(client, download_url):
    url = safe_download_url(download_url)
    if time.monotonic() >= client.expires_at:
        client._authorize()
    response = client._request('GET', url, headers={'Authorization': f'Bearer {client.token}'},
                               stream=True, allow_redirects=False)
    for hop in range(5):
        try:
            if response.status_code in (301, 302, 303, 307, 308):
                location = response.headers.get('Location', '')
                if not location or hop == 4:
                    raise ZoomError('Zoom recording redirect limit reached.')
                url = safe_download_url(urljoin(url, location))
            else:
                if not response.ok:
                    raise ZoomError(f'Zoom recording download failed (HTTP {response.status_code}).')
                content_type = response.headers.get('Content-Type', '').split(';', 1)[0].strip().lower()
                extensions = {
                    'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/mp4': '.m4a',
                    'audio/x-m4a': '.m4a', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
                    'application/octet-stream': '.mp3',
                }
                if content_type not in extensions:
                    raise ZoomError('Zoom returned an unsupported recording format.')
                try:
                    declared_size = int(response.headers.get('Content-Length', '0'))
                except (ValueError, TypeError):
                    declared_size = 0
                if declared_size > MAX_AUDIO_BYTES:
                    raise ZoomError('Zoom recording exceeds the 25 MB transcription limit.')
                audio = SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode='w+b')
                total = 0
                for chunk in response.iter_content(chunk_size=65536):
                    total += len(chunk)
                    if total > MAX_AUDIO_BYTES:
                        audio.close()
                        raise ZoomError('Zoom recording exceeds the 25 MB transcription limit.')
                    audio.write(chunk)
                if total == 0:
                    audio.close()
                    raise ZoomError('Zoom returned an empty recording.')
                audio.seek(0)
                return audio, 'zoom-call' + extensions[content_type], content_type
        finally:
            response.close()
        # Signed Zoom redirects are fetched without forwarding the OAuth token.
        response = client._request('GET', url, stream=True, allow_redirects=False)


def fetch_ai_transcript(client, download_url):
    if not ai_transcription_enabled():
        raise ZoomError('AI transcription is not configured.')
    audio, filename, content_type = download_audio(client, download_url)
    try:
        payload = None
        for attempt in range(3):
            audio.seek(0)
            try:
                response = requests.post(
                    'https://api.openai.com/v1/audio/transcriptions',
                    headers={'Authorization': f'Bearer {settings.OPENAI_API_KEY}'},
                    data={
                        'model': settings.OPENAI_TRANSCRIPTION_MODEL,
                        'prompt': 'Kent Business College learner support call. Preserve names, dates, and action items.',
                    },
                    files={'file': (filename, audio, content_type)},
                    # requests also applies the connect timeout while streaming the upload body.
                    timeout=(120, 600),
                    allow_redirects=False,
                )
            except requests.RequestException:
                if attempt == 2:
                    raise ZoomError('AI transcription connection failed; the next sync will retry.') from None
                time.sleep(2 ** attempt)
                continue
            try:
                if response.status_code == 429 or response.status_code >= 500:
                    if attempt == 2:
                        raise ZoomError(
                            f'AI transcription is temporarily unavailable (HTTP {response.status_code}).'
                        )
                elif not response.ok or 300 <= response.status_code < 400:
                    raise ZoomError(f'AI transcription failed (HTTP {response.status_code}).')
                else:
                    try:
                        payload = response.json()
                    except ValueError:
                        raise ZoomError('AI transcription returned an invalid response.') from None
                    break
            finally:
                response.close()
            time.sleep(2 ** attempt)
        if payload is None:
            raise ZoomError('AI transcription is temporarily unavailable; the next sync will retry.')
        text = payload.get('text') if isinstance(payload, dict) else None
        metadata = {
            'type': 'ai_audio_transcript',
            'model': settings.OPENAI_TRANSCRIPTION_MODEL,
            'languages': payload.get('languages', []),
        }
        if not isinstance(text, str) or not text.strip():
            return 'unavailable', '', {**metadata, 'reason': 'no_speech_detected'}
        return 'ready', text.strip(), metadata
    except requests.RequestException:
        raise ZoomError('AI transcription connection failed; the next sync will retry.') from None
    finally:
        audio.close()


def sync_recordings(client, key, account_id, state, lease, start, end):
    checkpoint = state.recordings_covered_through
    download_urls = {}

    def store_rows(rows):
        renew_lease(lease)
        recordings = []
        for row in rows:
            values = recording_values(key, account_id, row)
            recordings.append(ZoomPhoneRecording(**values))
            if isinstance(row.get('download_url'), str) and row['download_url']:
                download_urls[values['recording_id']] = row['download_url']
        metadata_fields = [
            field.name for field in ZoomPhoneRecording._meta.fields
            if field.name not in (
                'id', 'zoom_account_id', 'recording_id', 'transcript_status',
                'transcript_text', 'transcript_data', 'transcript_error',
                'transcript_checked_at', 'transcript_next_retry_at',
            )
        ]
        ZoomPhoneRecording.objects.bulk_create(
            recordings,
            update_conflicts=True,
            update_fields=metadata_fields,
            unique_fields=['zoom_account_id', 'recording_id'],
            batch_size=300,
        )
        renew_lease(lease)

    current = start or (checkpoint - timedelta(days=7) if checkpoint else end - timedelta(days=10))
    while current <= end:
        window_end = min(current + timedelta(days=27), end)
        for rows in client.recording_pages(current, window_end):
            store_rows(rows)
        if checkpoint is None or current <= checkpoint + timedelta(days=1):
            checkpoint = max(window_end, checkpoint or window_end)
            lease.update(recordings_covered_through=checkpoint)
        current = window_end + timedelta(days=1)

    # Retry pending/failed transcripts even after their recording leaves the normal overlap window.
    queue = ZoomPhoneRecording.objects.filter(source_account=key, zoom_account_id=account_id).exclude(
        transcript_status='ready',
    ).filter(Q(transcript_next_retry_at__isnull=True) | Q(transcript_next_retry_at__lte=timezone.now()))
    first_error = ''
    ai_remaining = settings.ZOOM_AI_TRANSCRIPTS_PER_SYNC if ai_transcription_enabled() else 0
    ai_queue = queue.filter(transcript_status__in=('disabled', 'unavailable'))
    if ai_remaining:
        oldest = ai_queue.order_by('started_at', 'id').values('recording_id', 'started_at').first()
        if oldest and oldest['recording_id'] not in download_urls:
            target_day = oldest['started_at'].date()
            for rows in client.recording_pages(target_day, target_day):
                store_rows(rows)

    ai_ids = list(ai_queue.filter(recording_id__in=download_urls).order_by(
        'transcript_next_retry_at', 'id',
    ).values_list('pk', flat=True)[:ai_remaining])
    regular_queue = queue.exclude(pk__in=ai_ids)
    if ai_transcription_enabled():
        regular_queue = regular_queue.exclude(transcript_status__in=('disabled', 'unavailable'))
    regular_ids = list(regular_queue.order_by('transcript_next_retry_at', 'id').values_list(
        'pk', flat=True,
    )[:max(0, TRANSCRIPTS_PER_SYNC - len(ai_ids))])
    ids = ai_ids + regular_ids
    for pk in ids:
        renew_lease(lease)
        recording = ZoomPhoneRecording.objects.get(pk=pk)
        retry_delay = None
        try:
            status, text, payload = fetch_transcript(client, recording.recording_id)
            download_url = download_urls.get(recording.recording_id, '')
            if status in ('disabled', 'unavailable') and ai_remaining and download_url:
                ai_remaining -= 1
                native_status = status
                try:
                    status, text, payload = fetch_ai_transcript(client, download_url)
                except ZoomError as exc:
                    # Native Zoom transcript settings must not stop calls/recordings syncing.
                    status, text, payload = native_status, '', {}
                    error = ('AI fallback: ' + str(exc))[:255]
                    retry_delay = 60
                except Exception:
                    status, text, payload = native_status, '', {}
                    error = 'AI fallback failed; the next sync will retry.'
                    retry_delay = 60
                else:
                    error = ''
            else:
                error = ''
                if status in ('disabled', 'unavailable') and ai_transcription_enabled() and download_url:
                    retry_delay = 5
        except ZoomError as exc:
            status, text, payload = 'error', '', {}
            error = str(exc)[:255]
            first_error = first_error or error
        except Exception:
            status, text, payload = 'error', '', {}
            error = 'Transcript download failed; the next sync will retry.'
            first_error = first_error or error
        renew_lease(lease)
        now = timezone.now()
        if isinstance(payload, dict) and payload.get('reason') == 'no_speech_detected':
            retry_delay = 365 * 24 * 60
        delay = retry_delay or {'pending': 30, 'error': 60, 'disabled': 1440, 'unavailable': 1440}.get(status, 60)
        ZoomPhoneRecording.objects.filter(pk=pk).update(
            transcript_status=status, transcript_text=text, transcript_data=payload,
            transcript_error=error, transcript_checked_at=now,
            transcript_next_retry_at=None if status == 'ready' else now + timedelta(minutes=delay),
        )
    lease.update(recordings_last_success_at=timezone.now(), recordings_error=first_error)
    if first_error:
        raise ZoomError(first_error)
