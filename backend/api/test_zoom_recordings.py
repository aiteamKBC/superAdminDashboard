import json
import os
import requests
from datetime import date, timedelta
from io import BytesIO, StringIO
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from .models import ZoomPhoneCall, ZoomPhoneRecording, ZoomSyncState
from .test_zoom_phone import CREDS, record, response
from .zoom_phone import ZoomClient, ZoomError, normalize_call, sync_account
from .zoom_recordings import MAX_TRANSCRIPT_BYTES, download_audio, fetch_ai_transcript, fetch_transcript, recording_values


TRANSCRIPT = {'type': 'zoom_transcript', 'timeline': [
    {'ts': '00:00:00.000', 'end_ts': '00:00:02.000', 'userId': '101', 'text': 'Hello learner.'},
    {'ts': '00:00:02.000', 'end_ts': '00:00:04.000', 'userId': '102', 'text': 'Please send the review date.'},
]}


def recording(recording_id='recording-one', **extra):
    return {
        'id': recording_id, 'call_id': 'shared-call-id', 'call_log_id': 'history-one',
        'call_element_id': 'element-one', 'date_time': '2026-09-20T09:00:00Z',
        'duration': 100, 'direction': 'outbound', 'owner': {'id': 'owner', 'name': 'Staff'},
        'download_url': 'https://zoom.us/secret-signed-url', **extra,
    }


def file_response(payload, status=200, headers=None):
    result = response(payload, status)
    result.headers = headers or {}
    result.iter_content.return_value = [json.dumps(payload).encode()]
    return result


class RecordingClientTests(SimpleTestCase):
    def setUp(self):
        self.client = ZoomClient({'account_id': 'account', 'client_id': 'client', 'client_secret': 'secret'})
        self.addCleanup(self.client.close)

    @patch('api.zoom_phone.requests.Session.request')
    def test_zero_records_collection_may_be_omitted(self, request):
        request.side_effect = [response({'access_token': 'token'}), response({'total_records': 0})]
        self.assertEqual(list(self.client.recording_pages(date(2026, 9, 20), date(2026, 9, 20))), [[]])

    @patch('api.zoom_phone.requests.Session.request')
    def test_all_recording_pages_are_read(self, request):
        request.side_effect = [response({'access_token': 'token'}),
                               response({'recordings': [recording()], 'next_page_token': 'next'}),
                               response({'recordings': [recording('second')]})]
        self.assertEqual(len(list(self.client.recording_pages(date(2026, 9, 20), date(2026, 9, 20)))), 2)
        self.assertEqual(request.call_args.kwargs['params']['next_page_token'], 'next')

    def test_recording_metadata_does_not_store_download_urls(self):
        values = recording_values('student', 'student-account', recording())
        self.assertNotIn('download_url', values)
        for changes in ({'id': ''}, {'duration': -1}, {'date_time': 'invalid'}):
            with self.assertRaises(ZoomError):
                recording_values('student', 'student-account', recording(**changes))

    def test_json_transcript_is_preserved_with_speakers_and_timestamps(self):
        client = Mock()
        client.api_get.return_value = file_response(TRANSCRIPT)
        status, text, data = fetch_transcript(client, 'recording/id')
        self.assertEqual(status, 'ready')
        self.assertIn('Hello learner.', text)
        self.assertEqual(data['timeline'][0]['userId'], '101')
        self.assertIn('recording%2Fid', client.api_get.call_args.args[0])
        client.api_get.return_value.close.assert_called_once()

    def test_safe_redirect_does_not_forward_bearer_token(self):
        client = Mock()
        client.api_get.return_value = file_response({}, 302, {'Location': 'https://us02web.zoom.us/download/transcript'})
        client._request.return_value = file_response(TRANSCRIPT)
        self.assertEqual(fetch_transcript(client, 'id')[0], 'ready')
        self.assertNotIn('headers', client._request.call_args.kwargs)
        self.assertFalse(client._request.call_args.kwargs['allow_redirects'])

    def test_untrusted_redirects_are_never_requested(self):
        for url in ('http://zoom.us/test', 'https://zoom.us.attacker.test/test',
                    'https://127.0.0.1/test', 'https://user:pass@zoom.us/test', 'https://zoom.us:8000/test'):
            client = Mock()
            client.api_get.return_value = file_response({}, 302, {'Location': url})
            with self.assertRaises(ZoomError):
                fetch_transcript(client, 'id')
            client._request.assert_not_called()

    def test_known_provider_states_and_empty_text_are_not_ready(self):
        for code, expected in ((12000, 'unavailable'), (12001, 'disabled'), (12002, 'pending'), (404, 'unavailable')):
            client = Mock()
            client.api_get.return_value = file_response({'code': code, 'message': 'private message'}, 400)
            self.assertEqual(fetch_transcript(client, 'id'), (expected, '', {}))
        client.api_get.return_value = file_response({'timeline': []})
        self.assertEqual(fetch_transcript(client, 'id'), ('pending', '', {}))

    def test_malformed_or_oversized_transcripts_fail_safely(self):
        for payload, headers in (({}, {}), ({'timeline': 'bad'}, {}),
                                 (TRANSCRIPT, {'Content-Length': str(MAX_TRANSCRIPT_BYTES + 1)})):
            client = Mock()
            client.api_get.return_value = file_response(payload, headers=headers)
            with self.assertRaises(ZoomError):
                fetch_transcript(client, 'id')

    def test_transcript_http_error_never_includes_provider_message(self):
        client = Mock()
        client.api_get.return_value = file_response({'message': 'private-token'}, 403)
        with self.assertRaises(ZoomError) as error:
            fetch_transcript(client, 'id')
        self.assertNotIn('private-token', str(error.exception))

    def test_audio_download_strips_oauth_from_signed_redirect(self):
        client = Mock(token='token', expires_at=float('inf'))
        first = file_response({}, 302, {'Location': 'https://file.zoom.us/signed-audio'})
        second = file_response({})
        second.headers = {'Content-Type': 'audio/mpeg', 'Content-Length': '5'}
        second.iter_content.return_value = [b'audio']
        client._request.side_effect = [first, second]
        audio, filename, content_type = download_audio(client, 'https://zoom.us/recording')
        self.addCleanup(audio.close)
        self.assertEqual(audio.read(), b'audio')
        self.assertEqual(filename, 'zoom-call.mp3')
        self.assertEqual(content_type, 'audio/mpeg')
        self.assertIn('headers', client._request.call_args_list[0].kwargs)
        self.assertNotIn('headers', client._request.call_args_list[1].kwargs)

    @override_settings(ZOOM_AI_TRANSCRIPTION_ENABLED=True, OPENAI_API_KEY='test-key',
                       OPENAI_TRANSCRIPTION_MODEL='gpt-transcribe')
    @patch('api.zoom_recordings.requests.post')
    @patch('api.zoom_recordings.download_audio')
    def test_ai_fallback_returns_text_without_persisting_audio_url(self, download, post):
        download.side_effect = [
            (BytesIO(b'audio'), 'zoom-call.mp3', 'audio/mpeg'),
            (BytesIO(b'audio'), 'zoom-call.mp3', 'audio/mpeg'),
        ]
        post.return_value = file_response({'text': 'AI transcript.', 'languages': [{'code': 'en'}]})
        status, text, payload = fetch_ai_transcript(Mock(), 'https://zoom.us/private')
        self.assertEqual((status, text), ('ready', 'AI transcript.'))
        self.assertEqual(payload['type'], 'ai_audio_transcript')
        self.assertNotIn('https://zoom.us/private', str(payload))

        post.return_value = file_response({'text': '', 'languages': []})
        self.assertEqual(fetch_ai_transcript(Mock(), 'https://zoom.us/private')[0], 'unavailable')

    @override_settings(ZOOM_AI_TRANSCRIPTION_ENABLED=True, OPENAI_API_KEY='test-key',
                       OPENAI_TRANSCRIPTION_MODEL='gpt-transcribe')
    @patch('api.zoom_recordings.time.sleep')
    @patch('api.zoom_recordings.requests.post')
    @patch('api.zoom_recordings.download_audio')
    def test_ai_fallback_retries_temporary_failures(self, download, post, sleep):
        download.return_value = (BytesIO(b'audio'), 'zoom-call.mp3', 'audio/mpeg')
        post.side_effect = [requests.ConnectionError(), file_response({'text': 'Recovered.'})]
        self.assertEqual(fetch_ai_transcript(Mock(), 'https://zoom.us/private')[:2], ('ready', 'Recovered.'))
        self.assertEqual(post.call_count, 2)
        sleep.assert_called_once_with(1)


@patch.dict(os.environ, CREDS)
class RecordingSyncTests(TestCase):
    def run_sync(self, key='student', start=date(2026, 9, 20), end=date(2026, 9, 20)):
        return sync_account(key, start, end, include_recordings=True)

    @patch('api.zoom_recordings.fetch_transcript', return_value=('ready', 'Hello learner.', TRANSCRIPT))
    @patch('api.zoom_phone.ZoomClient')
    def test_both_accounts_upsert_and_keep_counts_separate(self, client, fetch):
        client.return_value.pages.return_value = [[record(duration=3600)]]
        client.return_value.recording_pages.return_value = [[recording()]]
        for key in ('student', 'office', 'student', 'office'):
            self.run_sync(key)
        self.assertEqual(ZoomPhoneCall.objects.count(), 2)
        self.assertEqual(ZoomPhoneRecording.objects.count(), 2)
        self.assertEqual(fetch.call_count, 2)
        self.assertTrue(all(r.transcript_data == TRANSCRIPT for r in ZoomPhoneRecording.objects.all()))
        user = get_user_model().objects.create_user(username='reporter')
        self.client.force_login(user)
        report = self.client.get('/api/zoom/calls/', {'from': '2026-09-20', 'to': '2026-09-20'}).json()
        self.assertEqual(report['totals']['calls'], 2)
        self.assertEqual(report['totals']['duration_seconds'], 7200)
        self.assertEqual([a['calls'] for a in report['accounts']], [1, 1])

    @patch('api.zoom_recordings.fetch_transcript', return_value=('ready', 'Updated transcript.', TRANSCRIPT))
    @patch('api.zoom_phone.ZoomClient')
    def test_recording_bulk_upsert_preserves_existing_transcript(self, client, fetch):
        client.return_value.pages.return_value = [[]]
        client.return_value.recording_pages.return_value = [[recording(duration=100)]]
        self.run_sync()
        saved = ZoomPhoneRecording.objects.get()
        self.assertEqual(saved.transcript_status, 'ready')
        self.assertEqual(saved.transcript_text, 'Updated transcript.')

        client.return_value.recording_pages.return_value = [[recording(duration=250, owner={'id': 'owner', 'name': 'Updated Staff'})]]
        self.run_sync()
        saved.refresh_from_db()
        self.assertEqual(saved.duration_seconds, 250)
        self.assertEqual(saved.owner_name, 'Updated Staff')
        self.assertEqual(saved.transcript_status, 'ready')
        self.assertEqual(saved.transcript_text, 'Updated transcript.')

    @patch('api.zoom_recordings.fetch_transcript')
    @patch('api.zoom_phone.ZoomClient')
    def test_pending_transcript_retried_outside_overlap_window(self, client, fetch):
        client.return_value.pages.return_value = [[]]
        client.return_value.recording_pages.return_value = [[recording()]]
        fetch.return_value = ('pending', '', {})
        self.run_sync(start=date(2026, 8, 1), end=date(2026, 8, 1))
        rec = ZoomPhoneRecording.objects.get()
        self.assertEqual(rec.transcript_status, 'pending')
        self.assertGreater(rec.transcript_next_retry_at, timezone.now())
        client.return_value.recording_pages.return_value = [[]]
        ZoomPhoneRecording.objects.update(transcript_next_retry_at=timezone.now() - timedelta(minutes=1))
        fetch.return_value = ('ready', 'Ready later.', TRANSCRIPT)
        self.run_sync(start=date(2026, 9, 20), end=date(2026, 9, 20))
        rec.refresh_from_db()
        self.assertEqual(rec.transcript_status, 'ready')
        self.assertEqual(rec.transcript_text, 'Ready later.')

    @patch('api.zoom_recordings.fetch_transcript')
    @patch('api.zoom_phone.ZoomClient')
    def test_recording_failure_does_not_lose_successful_call_sync(self, client, fetch):
        client.return_value.pages.return_value = [[record()]]
        client.return_value.recording_pages.side_effect = ZoomError('Recordings scope missing.')
        with self.assertRaises(ZoomError):
            self.run_sync()
        self.assertEqual(ZoomPhoneCall.objects.count(), 1)
        state = ZoomSyncState.objects.get(pk='student')
        self.assertIsNotNone(state.last_success_at)
        self.assertEqual(state.last_error, '')
        self.assertEqual(state.recordings_error, 'Recordings scope missing.')
        self.assertIsNone(state.recordings_covered_through)
        self.assertIsNone(state.locked_until)

    @patch('api.zoom_recordings.fetch_transcript')
    @patch('api.zoom_phone.ZoomClient')
    def test_partial_recording_page_failure_keeps_checkpoint_for_retry(self, client, fetch):
        def pages(*args):
            yield [recording()]
            raise ZoomError('Next page unavailable.')
        client.return_value.pages.return_value = [[]]
        client.return_value.recording_pages.side_effect = pages
        with self.assertRaises(ZoomError):
            self.run_sync()
        self.assertEqual(ZoomPhoneRecording.objects.count(), 1)
        self.assertIsNone(ZoomSyncState.objects.get(pk='student').recordings_covered_through)

    @patch('api.zoom_recordings.fetch_transcript', side_effect=ZoomError('Transcript scope missing.'))
    @patch('api.zoom_phone.ZoomClient')
    def test_transcript_failure_preserves_recording_and_schedules_retry(self, client, fetch):
        client.return_value.pages.return_value = [[record()]]
        client.return_value.recording_pages.return_value = [[recording()]]
        with self.assertRaises(ZoomError):
            self.run_sync()
        rec = ZoomPhoneRecording.objects.get()
        self.assertEqual(rec.transcript_status, 'error')
        self.assertGreater(rec.transcript_next_retry_at, timezone.now())
        self.assertIsNotNone(ZoomSyncState.objects.get(pk='student').last_success_at)

    @override_settings(ZOOM_AI_TRANSCRIPTION_ENABLED=True, OPENAI_API_KEY='test-key',
                       OPENAI_TRANSCRIPTION_MODEL='gpt-transcribe', ZOOM_AI_TRANSCRIPTS_PER_SYNC=10)
    @patch('api.zoom_recordings.fetch_ai_transcript', side_effect=ZoomError('AI temporarily unavailable.'))
    @patch('api.zoom_recordings.fetch_transcript', return_value=('disabled', '', {}))
    @patch('api.zoom_phone.ZoomClient')
    def test_ai_failure_does_not_fail_recording_sync(self, client, fetch, ai_fetch):
        client.return_value.pages.return_value = [[record()]]
        client.return_value.recording_pages.return_value = [[recording()]]
        self.run_sync()
        rec = ZoomPhoneRecording.objects.get()
        self.assertEqual(rec.transcript_status, 'disabled')
        self.assertIn('AI fallback:', rec.transcript_error)
        self.assertLess(rec.transcript_next_retry_at, timezone.now() + timedelta(minutes=61))
        state = ZoomSyncState.objects.get(pk='student')
        self.assertEqual(state.recordings_error, '')
        self.assertIsNotNone(state.recordings_last_success_at)

    @override_settings(ZOOM_AI_TRANSCRIPTION_ENABLED=True, OPENAI_API_KEY='test-key',
                       OPENAI_TRANSCRIPTION_MODEL='gpt-transcribe', ZOOM_AI_TRANSCRIPTS_PER_SYNC=10)
    @patch('api.zoom_recordings.fetch_ai_transcript', return_value=('ready', 'Historical transcript.', TRANSCRIPT))
    @patch('api.zoom_recordings.fetch_transcript', return_value=('disabled', '', {}))
    @patch('api.zoom_phone.ZoomClient')
    def test_ai_backfill_fetches_the_historical_recording_day(self, client, fetch, ai_fetch):
        old_row = recording(date_time='2026-09-01T09:00:00Z')
        ZoomPhoneRecording.objects.create(
            **recording_values('student', 'student-account', old_row),
            transcript_status='disabled',
            transcript_next_retry_at=timezone.now() - timedelta(minutes=1),
        )
        client.return_value.pages.return_value = [[]]
        client.return_value.recording_pages.side_effect = [[], [[old_row]]]
        self.run_sync(start=date(2026, 9, 20), end=date(2026, 9, 20))
        saved = ZoomPhoneRecording.objects.get()
        self.assertEqual(saved.transcript_status, 'ready')
        self.assertEqual(saved.transcript_text, 'Historical transcript.')
        self.assertEqual(client.return_value.recording_pages.call_args_list[1].args,
                         (date(2026, 9, 1), date(2026, 9, 1)))

    @patch('api.management.commands.sync_zoom_calls.sync_account')
    def test_command_continues_to_office_when_student_fails(self, sync):
        sync.side_effect = [ZoomError('Student unavailable.'), 2]
        with self.assertRaises(CommandError):
            call_command('sync_zoom_calls', stdout=StringIO(), stderr=StringIO())
        self.assertEqual([call.args[0] for call in sync.call_args_list], ['student', 'office'])
        self.assertTrue(sync.call_args.kwargs['include_recordings'])


@patch.dict(os.environ, CREDS)
class RecordingViewTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='transcript-viewer')
        self.call = ZoomPhoneCall.objects.create(**normalize_call('student', 'student-account', record()))
        self.recording = ZoomPhoneRecording.objects.create(
            **recording_values('student', 'student-account', recording()),
            transcript_status='ready', transcript_text='Hello learner.', transcript_data=TRANSCRIPT,
        )

    def test_login_required_for_metadata_and_text(self):
        self.assertEqual(self.client.get(f'/api/zoom/calls/{self.call.pk}/recordings/').status_code, 401)
        self.assertEqual(self.client.get(f'/api/zoom/recordings/{self.recording.pk}/transcript/').status_code, 401)
        self.assertEqual(self.client.get('/api/zoom/transcripts/').status_code, 401)

    def test_call_recordings_do_not_mix_accounts_or_expose_tokens(self):
        self.client.force_login(self.user)
        ZoomPhoneRecording.objects.create(**recording_values('office', 'office-account', recording()))
        result = self.client.get(f'/api/zoom/calls/{self.call.pk}/recordings/').json()
        self.assertEqual(len(result['recordings']), 1)
        self.assertNotIn('download_url', str(result))
        transcript = self.client.get(f'/api/zoom/recordings/{self.recording.pk}/transcript/').json()
        self.assertEqual(transcript['text'], 'Hello learner.')

    def test_account_change_hides_old_transcripts(self):
        self.client.force_login(self.user)
        with patch.dict(os.environ, {'ZOOM_STUDENT_ACCOUNT_ID': 'replacement-account'}):
            self.assertEqual(self.client.get(f'/api/zoom/calls/{self.call.pk}/recordings/').status_code, 404)
            self.assertEqual(self.client.get(f'/api/zoom/recordings/{self.recording.pk}/transcript/').status_code, 404)

    def test_transcript_report_combines_accounts_and_filters_status(self):
        self.client.force_login(self.user)
        ZoomPhoneRecording.objects.create(
            **recording_values('office', 'office-account', recording('office-recording')),
            transcript_status='disabled',
        )
        response = self.client.get('/api/zoom/transcripts/', {
            'from': '2026-09-01', 'to': '2026-09-30', 'account': 'all', 'status': 'all',
        })
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload['summary']['total'], 2)
        self.assertEqual(payload['summary']['ready'], 1)
        self.assertEqual(payload['summary']['disabled'], 1)
        self.assertEqual({row['source_account'] for row in payload['records']}, {'student', 'office'})
        self.assertEqual(payload['accounts'][0]['ready'], 1)
        self.assertEqual(payload['accounts'][1]['disabled'], 1)

        ready = self.client.get('/api/zoom/transcripts/', {
            'from': '2026-09-01', 'to': '2026-09-30', 'status': 'ready',
        }).json()
        self.assertEqual(ready['total_records'], 1)
        self.assertEqual(ready['records'][0]['preview'], 'Hello learner.')
