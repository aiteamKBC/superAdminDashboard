import os
from datetime import date, timedelta
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from .models import ZoomPhoneCall, ZoomSyncState
from .zoom_phone import ZoomClient, ZoomError, mapped_result, normalize_call, sync_account


CREDS = {
    'ZOOM_STUDENT_ACCOUNT_ID': 'student-account', 'ZOOM_STUDENT_CLIENT_ID': 'student-client',
    'ZOOM_STUDENT_CLIENT_SECRET': 'student-secret', 'ZOOM_OFFICE_ACCOUNT_ID': 'office-account',
    'ZOOM_OFFICE_CLIENT_ID': 'office-client', 'ZOOM_OFFICE_CLIENT_SECRET': 'office-secret',
}


def record(history_id='history-one', **extra):
    return {
        'id': history_id, 'call_id': 'shared-call-id', 'direction': 'outbound',
        'caller_did_number': '+441111111111', 'callee_did_number': '+442222222222',
        'caller_ext_id': 'staff-one', 'caller_email': 'staff@example.test',
        'start_time': '2026-09-20T09:00:00Z', 'end_time': '2026-09-20T09:02:00Z',
        'duration': 100, 'call_result': 'connected', **extra,
    }


def response(payload, status=200):
    return Mock(status_code=status, ok=200 <= status < 300, headers={}, json=Mock(return_value=payload))


class NormalizeTests(SimpleTestCase):
    def test_negative_results_are_never_answered(self):
        for result in ('unanswered', 'not answered', 'no-answer'):
            self.assertEqual(mapped_result(result), 'no_answer')

    def test_missing_duration_is_not_inferred_from_timestamps(self):
        data = normalize_call('student', 'student-account', record(duration=None))
        self.assertIsNone(data['duration_seconds'])
        self.assertEqual(data['caller_user_id'], 'staff-one')

    def test_malformed_records_fail_instead_of_silently_losing_calls(self):
        for row in (record(id=''), record(start_time='bad'), record(duration=-1), record(duration=1.2)):
            with self.assertRaises(ZoomError):
                normalize_call('student', 'student-account', row)

    def test_new_history_uuid_is_preserved(self):
        data = normalize_call('office', 'office-account', record(id=None, call_history_uuid='uuid'))
        self.assertEqual(data['history_id'], 'uuid')
        self.assertEqual(data['duration_seconds'], 100)


class ClientTests(SimpleTestCase):
    def setUp(self):
        self.client = ZoomClient({'account_id': 'account', 'client_id': 'client', 'client_secret': 'secret'})
        self.addCleanup(self.client.close)

    @patch('api.zoom_phone.requests.Session.request')
    def test_all_pages_and_both_supported_response_shapes(self, request):
        request.side_effect = [response({'access_token': 'token', 'expires_in': 3600}),
                               response({'call_history': [record()], 'next_page_token': 'page-two'}),
                               response({'call_logs': [record('second')]})]
        pages = list(self.client.pages(date(2026, 9, 20), date(2026, 9, 20)))
        self.assertEqual(len(pages), 2)
        self.assertEqual(request.call_args.kwargs['params']['next_page_token'], 'page-two')

    @patch('api.zoom_phone.requests.Session.request')
    def test_expired_token_refreshes_once(self, request):
        request.side_effect = [response({'access_token': 'first'}), response({}, 401),
                               response({'access_token': 'second'}), response({'call_history': []})]
        self.assertEqual(list(self.client.pages(date(2026, 9, 20), date(2026, 9, 20))), [[]])
        self.assertEqual(request.call_args.kwargs['headers']['Authorization'], 'Bearer second')

    @patch('api.zoom_phone.time.sleep')
    @patch('api.zoom_phone.requests.Session.request')
    def test_transient_errors_retry_and_do_not_expose_response(self, request, sleep):
        request.side_effect = [response({'secret': 'private-provider-message'}, 503),
                               response({'access_token': 'token'}), response({'call_history': []})]
        list(self.client.pages(date(2026, 9, 20), date(2026, 9, 20)))
        sleep.assert_called_once()
        with self.assertRaises(ZoomError) as error:
            self.client._json(response({'secret': 'private-provider-message'}, 403))
        self.assertNotIn('private-provider-message', str(error.exception))

    @patch('api.zoom_phone.requests.Session.request')
    def test_repeated_page_token_fails(self, request):
        request.side_effect = [response({'access_token': 'token'}),
                               response({'call_history': [], 'next_page_token': 'repeat'}),
                               response({'call_history': [], 'next_page_token': 'repeat'})]
        with self.assertRaises(ZoomError):
            list(self.client.pages(date(2026, 9, 20), date(2026, 9, 20)))


@patch.dict(os.environ, CREDS)
class SyncTests(TestCase):
    @patch('api.zoom_phone.ZoomClient')
    def test_repeat_sync_updates_without_duplicates_and_keeps_accounts_separate(self, client):
        client.return_value.pages.return_value = [[record(), record('second-history')]]
        sync_account('student', date(2026, 9, 20), date(2026, 9, 20))
        client.return_value.pages.return_value = [[record(duration=200), record('second-history')]]
        sync_account('student', date(2026, 9, 20), date(2026, 9, 20))
        sync_account('office', date(2026, 9, 20), date(2026, 9, 20))
        self.assertEqual(ZoomPhoneCall.objects.count(), 4)
        self.assertEqual(ZoomPhoneCall.objects.get(source_account='student', history_id='history-one').duration_seconds, 200)

    @patch('api.zoom_phone.ZoomClient')
    def test_failed_later_page_does_not_advance_checkpoint_and_retry_is_safe(self, client):
        def pages(*args):
            yield [record()]
            raise ZoomError('Second page failed.')
        client.return_value.pages.side_effect = pages
        with self.assertRaises(ZoomError):
            sync_account('student', date(2026, 9, 20), date(2026, 9, 20))
        state = ZoomSyncState.objects.get(pk='student')
        self.assertIsNone(state.covered_through)
        self.assertIsNone(state.last_success_at)
        self.assertIsNone(state.locked_until)
        client.return_value.pages.side_effect = None
        client.return_value.pages.return_value = [[record()], [record('second')]]
        sync_account('student', date(2026, 9, 20), date(2026, 9, 20))
        self.assertEqual(ZoomPhoneCall.objects.count(), 2)
        self.assertIsNotNone(ZoomSyncState.objects.get(pk='student').last_success_at)

    @patch('api.zoom_phone.ZoomClient')
    def test_active_sync_lease_prevents_second_worker(self, client):
        ZoomSyncState.objects.create(source_account='student', zoom_account_id='student-account',
                                     locked_until=timezone.now() + timedelta(minutes=5))
        with self.assertRaises(ZoomError):
            sync_account('student')
        client.assert_not_called()

    @patch('api.zoom_phone.ZoomClient')
    def test_backfill_splits_date_ranges_into_bounded_requests(self, client):
        client.return_value.pages.return_value = [[]]
        sync_account('student', date(2026, 7, 1), date(2026, 9, 20))
        ranges = [call.args for call in client.return_value.pages.call_args_list]
        self.assertGreater(len(ranges), 1)
        for start, end in ranges:
            self.assertLessEqual((end - start).days, 27)
        self.assertEqual(ZoomSyncState.objects.get(pk='student').covered_through, date(2026, 9, 20))


@patch.dict(os.environ, CREDS)
class ReportTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='report-user')

    def test_report_requires_login(self):
        self.assertEqual(self.client.get('/api/zoom/calls/').status_code, 401)

    def test_account_date_direction_and_pagination_filters(self):
        self.client.force_login(self.user)
        for key in ('student', 'office'):
            ZoomPhoneCall.objects.create(**normalize_call(key, f'{key}-account', record(duration=3600)))
        ZoomPhoneCall.objects.create(**normalize_call('student', 'student-account', record('incoming', direction='inbound', duration=500)))
        ZoomPhoneCall.objects.create(**normalize_call('student', 'student-account', record('no-duration', duration=None, call_result='unanswered')))
        ZoomPhoneCall.objects.create(**normalize_call('student', 'student-account', record('next-day', start_time='2026-09-20T23:30:00Z')))
        result = self.client.get('/api/zoom/calls/', {'from': '2026-09-20', 'to': '2026-09-20', 'account': 'student', 'page_size': 1}).json()
        self.assertEqual(result['total_records'], 2)
        self.assertEqual(result['totals']['duration_seconds'], 3600)
        self.assertEqual(result['totals']['answered'], 1)
        self.assertEqual(result['totals']['not_answered'], 1)
        self.assertEqual(result['totals']['missing_duration'], 1)
        self.assertTrue(result['has_next'])
        self.assertEqual(len(result['calls']), 1)
        self.assertEqual(len(result['daily']), 1)
        self.assertEqual(result['timezone'], 'Europe/London')
        self.assertNotIn('client_secret', str(result))

    def test_invalid_filters_return_400(self):
        self.client.force_login(self.user)
        for query in ({'page': '0'}, {'account': 'other'}, {'direction': 'bad'}, {'from': 'bad'},
                      {'from': '2026-09-20', 'to': '2026-09-10'}, {'page_size': '1000'}):
            self.assertEqual(self.client.get('/api/zoom/calls/', query).status_code, 400)

    def test_reconfigured_account_does_not_expose_old_accounts_calls(self):
        self.client.force_login(self.user)
        ZoomPhoneCall.objects.create(**normalize_call('student', 'old-account', record()))
        result = self.client.get('/api/zoom/calls/', {'from': '2026-09-01', 'to': '2026-09-30'}).json()
        self.assertEqual(result['total_records'], 0)

    @patch('api.zoom_views.contact_directory', return_value={
        '+442222222222': {'name': 'Learner One', 'email': 'learner@example.test', 'role': 'learner'},
    })
    def test_report_enriches_recipient_from_phone_directory(self, directory):
        self.client.force_login(self.user)
        ZoomPhoneCall.objects.create(**normalize_call('student', 'student-account', record()))
        call = self.client.get('/api/zoom/calls/', {
            'from': '2026-09-20', 'to': '2026-09-20', 'account': 'student',
        }).json()['calls'][0]
        self.assertEqual(call['contact_name'], 'Learner One')
        self.assertEqual(call['contact_email'], 'learner@example.test')
        self.assertEqual(call['contact_role'], 'learner')
