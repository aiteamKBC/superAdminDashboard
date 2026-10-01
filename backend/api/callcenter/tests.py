from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from threading import Barrier
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import OperationalError, close_old_connections, connections
from django.test import Client, TestCase, TransactionTestCase, override_settings
from django.utils import timezone

from api.models import AttendanceTicket, DashboardBooking, ZoomPhoneCall, ZoomPhoneRecording, ZoomSyncState
from .ai import analyze_recording, apply_analysis, validate_analysis
from .cycle import maintenance
from .emails import generate_surveys, process_emails, send_ticket_email, survey_token
from .evidence import check_evidence, valid_evidence
from .models import Agent, AIAnalysis, CallIntent, CallMatch, CaseCall, CaseTicket, CycleState, EmailDelivery, EmployerSatisfaction, TicketEvent
from .reports import performance
from .rules import LONDON, add_workdays, due_at, normalize_phone, retry_at
from .services import Conflict, claim, create_intent, expire_claims, identify_agent, match_call, operating_agent, record_outcome, release, reopen, resolve
from .sources import import_legacy, upsert_case


def make_user(name, **kwargs):
    return get_user_model().objects.create_user(username=name, **kwargs)


def make_case(**kwargs):
    values = {'source_type': 'attendance', 'reason_key': f'test:{CaseTicket.objects.count()}',
              'learner_email': 'learner@example.test', 'learner_name': 'Test Learner',
              'learner_phone': '+447700900123', 'due_at': timezone.now() + timedelta(days=2),
              'source_data': {'module': 'Module 1'}}
    values.update(kwargs)
    case = CaseTicket.objects.create(**values)
    CaseTicket.objects.filter(pk=case.pk).update(created_at=timezone.now() - timedelta(days=2))
    case.refresh_from_db()
    return case


def make_agent(name='Liza', account='student'):
    user = make_user(name)
    return Agent.objects.create(user=user, display_name=name, zoom_email=f'{name.lower()}@example.test', zoom_account=account)


def make_call(agent, **kwargs):
    start = timezone.now() - timedelta(minutes=5)
    values = {'source_account': agent.zoom_account, 'zoom_account_id': 'account-test',
              'history_id': f'call-{ZoomPhoneCall.objects.count()}', 'direction': 'outbound',
              'caller_email': agent.zoom_email, 'callee_number': '+447700900123',
              'started_at': start, 'ended_at': start + timedelta(seconds=60), 'duration_seconds': 60, 'result': 'answered'}
    values.update(kwargs)
    return ZoomPhoneCall.objects.create(**values)


class AgentIdentityTests(TestCase):
    def setUp(self):
        self.liza = make_agent('Liza', 'student')
        self.alice = make_agent('Alice', 'office')
        self.liza.zoom_user_id = 'student-user'
        self.liza.zoom_phone_number = '+447700900111'
        self.liza.save()
        self.alice.zoom_user_id = 'office-user'
        self.alice.save()

    def test_office_alice_and_student_liza_use_verified_identity(self):
        for agent in (self.alice, self.liza):
            call = make_call(agent, caller_email='', caller_user_id=agent.zoom_user_id)
            self.assertEqual(identify_agent(call).pk, agent.pk)
            call.source_account = 'office' if agent.zoom_account == 'student' else 'student'
            self.assertIsNone(identify_agent(call))

    def test_phone_number_alone_does_not_identify_an_agent(self):
        call = make_call(self.liza, caller_email='', caller_user_id='', caller_number=self.liza.zoom_phone_number)
        self.assertIsNone(identify_agent(call))

    def test_disabled_dashboard_login_cannot_be_attributed(self):
        self.liza.user.is_active = False
        self.liza.user.save(update_fields=['is_active'])
        self.assertIsNone(identify_agent(make_call(self.liza)))

    def test_superuser_can_select_either_zoom_account(self):
        admin = make_user('super-admin', is_staff=True, is_superuser=True)
        self.assertEqual(operating_agent(admin, self.liza.pk), self.liza)
        self.assertEqual(operating_agent(admin, self.alice.pk), self.alice)

    def test_regular_agent_cannot_select_another_zoom_account(self):
        self.assertEqual(operating_agent(self.liza.user, self.liza.pk), self.liza)
        with self.assertRaises(PermissionDenied):
            operating_agent(self.liza.user, self.alice.pk)

    def test_regular_user_without_agent_cannot_claim_or_call(self):
        user = make_user('viewer')
        self.assertIsNone(operating_agent(user))
        with self.assertRaises(PermissionDenied):
            operating_agent(user, self.liza.pk)

    def test_superuser_claim_records_real_operator_and_zoom_identity(self):
        admin = make_user('super-admin-audit', is_staff=True, is_superuser=True)
        ticket = make_case()
        selected = operating_agent(admin, self.liza.pk)
        claim(ticket.pk, selected, actor=admin.get_username())
        entry = ticket.events.get(kind='claimed')
        self.assertEqual(entry.actor, admin.get_username())
        self.assertEqual(entry.agent, self.liza)

    def test_optional_assigned_phone_must_be_e164(self):
        self.liza.full_clean()
        self.alice.full_clean()
        self.liza.zoom_phone_number = '800'
        with self.assertRaises(ValidationError):
            self.liza.full_clean()

    @patch('api.zoom_views.account_config', return_value={'account_id': 'account-test'})
    @patch('api.callcenter.reports.account_config', return_value={'account_id': 'account-test'})
    def test_performance_keeps_both_accounts_and_durations_separate(self, report_config, filter_config):
        make_call(self.liza, duration_seconds=125)
        make_call(self.alice, duration_seconds=300)
        make_call(self.alice, duration_seconds=45, result='no_answer')
        make_call(self.liza, duration_seconds=999, source_account='office')
        make_call(self.liza, duration_seconds=999, zoom_account_id='old-account')
        today = timezone.now().astimezone(LONDON).date()
        agents = {a['name']: a for a in performance(today - timedelta(days=1), today)['agents']}
        self.assertEqual((agents['Liza']['account'], agents['Liza']['calls'], agents['Liza']['seconds']), ('student', 1, 125))
        self.assertEqual((agents['Alice']['account'], agents['Alice']['calls'], agents['Alice']['seconds']), ('office', 2, 300))
        self.assertEqual(agents['Alice']['not_answered'], 1)
        self.assertEqual(agents['Liza']['zoom_phone_number'], '+447700900111')
        self.assertEqual(agents['Alice']['zoom_phone_number'], '')


class RulesTests(TestCase):
    def test_phone_normalization(self):
        for number in ('07700 900123', '+44 (0)7700 900123', '00447700900123', '+447700900123'):
            self.assertEqual(normalize_phone(number), '+447700900123')
        for number in ('123', '07700 900123 ext 2', 'javascript:1', '7700900123', ''):
            self.assertEqual(normalize_phone(number), '')
        self.assertEqual(normalize_phone('+1 (212) 555-0199'), '+12125550199')

    @override_settings(CALLCENTRE_HOLIDAYS=['2026-04-03', '2026-04-06'])
    def test_sla_weekend_holiday_and_dst(self):
        thursday = datetime(2026, 4, 2, 15, tzinfo=LONDON)
        self.assertEqual(due_at('attendance', thursday), datetime(2026, 4, 8, 15, tzinfo=LONDON))
        friday = datetime(2026, 3, 27, 15, tzinfo=LONDON)
        self.assertEqual(add_workdays(friday, 1), datetime(2026, 3, 30, 15, tzinfo=LONDON))
        self.assertEqual(add_workdays(friday, 1).utcoffset(), timedelta(hours=1))

    def test_retries_stop_at_three(self):
        friday = datetime(2026, 9, 25, 16, tzinfo=LONDON)
        self.assertEqual(retry_at(friday, 1), friday + timedelta(hours=2))
        self.assertEqual(retry_at(friday, 2), datetime(2026, 9, 28, 9, tzinfo=LONDON))
        self.assertIsNone(retry_at(friday, 3))


class WorkflowTests(TestCase):
    def setUp(self):
        self.liza = make_agent()
        self.alice = make_agent('Alice', 'office')
        self.ticket = make_case()

    def test_generation_idempotent_preserves_workflow(self):
        profile = {'learner_email': 'NEW@EXAMPLE.TEST', 'learner_name': 'New', 'learner_phone': '07700 900555'}
        first, created = upsert_case('pr', profile, '2026-09-01')
        self.assertTrue(created)
        first.status = 'pending_learner'
        first.save()
        second, created = upsert_case('pr', profile, '2026-09-01')
        self.assertFalse(created)
        self.assertEqual(first.pk, second.pk)
        second.refresh_from_db()
        self.assertEqual(second.status, 'pending_learner')
        self.assertEqual(second.due_at, first.due_at)
        self.assertEqual(first.events.filter(kind='created').count(), 1)

    def test_claim_conflict_expiry_and_release(self):
        claim(self.ticket.pk, self.liza)
        with self.assertRaises(Conflict):
            claim(self.ticket.pk, self.alice)
        with self.assertRaises(Conflict):
            release(self.ticket.pk, self.alice.user)
        CaseTicket.objects.filter(pk=self.ticket.pk).update(last_activity_at=timezone.now() - timedelta(minutes=31))
        expire_claims(timezone.now())
        claim(self.ticket.pk, self.alice)
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.claimed_by_id, self.alice.pk)

    def test_group_dial_rolls_back_on_other_agent_claim(self):
        other = make_case(source_type='pr')
        claim(other.pk, self.alice)
        with self.assertRaises(Conflict):
            create_intent(self.ticket.pk, self.liza)
        self.ticket.refresh_from_db()
        self.assertIsNone(self.ticket.claimed_by_id)
        self.assertEqual(CallIntent.objects.count(), 0)

    def test_no_fake_called_outcome(self):
        with self.assertRaises(ValueError):
            record_outcome(self.ticket.pk, self.liza.user, 123, 'reached')
        self.assertFalse(self.ticket.events.filter(kind='outcome').exists())

    def test_cannot_resolve_someone_elses_claim(self):
        claim(self.ticket.pk, self.liza)
        with self.assertRaises(Conflict):
            resolve(self.ticket.pk, self.alice.user, note='Approved')

    def test_existing_ticket_writeback_and_reopen_preserve_data(self):
        old = AttendanceTicket.objects.create(ticket_ref='ATT-T1', learner_email=self.ticket.learner_email,
                 learner_name='Learner', status='under_review', action='emailed', notes='Keep this', evidence='Keep evidence')
        self.ticket.source_id = old.pk
        self.ticket.save()
        resolve(self.ticket.pk, self.liza.user, note='Verified with coach')
        old.refresh_from_db()
        self.assertEqual((old.status, old.action, old.notes, old.evidence), ('resolved', 'emailed', 'Keep this', 'Keep evidence'))
        reopen(self.ticket.pk, self.liza.user, 'New evidence')
        old.refresh_from_db()
        self.assertEqual(old.status, 'under_review')
        self.assertEqual(self.ticket.events.filter(kind='legacy_updated').count(), 1)

    def test_reopen_does_not_overwrite_independent_legacy_changes(self):
        old = AttendanceTicket.objects.create(ticket_ref='ATT-T2', learner_email=self.ticket.learner_email, learner_name='Learner')
        self.ticket.source_id = old.pk
        self.ticket.save()
        resolve(self.ticket.pk, self.liza.user, note='Confirmed')
        old.status = 'support_plan_active'
        old.save()
        reopen(self.ticket.pk, self.liza.user, 'Review')
        old.refresh_from_db()
        self.assertEqual(old.status, 'support_plan_active')

    def test_source_identity_mismatch_rolls_back_resolution(self):
        old = AttendanceTicket.objects.create(ticket_ref='ATT-T3', learner_email='other@example.test', learner_name='Other')
        self.ticket.source_id = old.pk
        self.ticket.save()
        with self.assertRaises(Conflict):
            resolve(self.ticket.pk, self.liza.user, note='Confirmed')
        self.ticket.refresh_from_db()
        self.assertNotEqual(self.ticket.status, 'resolved')

    def test_events_and_cases_cannot_be_deleted_or_events_edited(self):
        entry = TicketEvent.objects.create(ticket=self.ticket, kind='test')
        with self.assertRaises(ValidationError):
            entry.save()
        with self.assertRaises(ValidationError):
            TicketEvent.objects.filter(pk=entry.pk).update(kind='changed')
        with self.assertRaises(ValidationError):
            self.ticket.delete()

    def test_sla_and_followup_events_idempotent(self):
        self.ticket.due_at = timezone.now() - timedelta(days=1)
        self.ticket.status = 'pending_verification'
        self.ticket.next_followup_at = timezone.now() - timedelta(minutes=1)
        self.ticket.save()
        maintenance(timezone.now())
        maintenance(timezone.now())
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.status, 'new')
        self.assertEqual(self.ticket.events.filter(kind='sla_breached').count(), 1)
        self.assertTrue(self.ticket.events.get(kind='sla_breached').data['unclaimed'])

    def test_legacy_import_does_not_create_duplicates(self):
        AttendanceTicket.objects.create(ticket_ref='ATT-I1', learner_email='new@example.test', learner_name='New')
        self.assertEqual(import_legacy({}), 1)
        self.assertEqual(import_legacy({}), 0)


@patch('api.zoom_views.account_config', return_value={'account_id': 'account-test'})
class CallTests(TestCase):
    def setUp(self):
        self.agent = make_agent()
        self.ticket = make_case()
        CycleState.objects.create(name='phone_directory', last_success_at=timezone.now(), details={self.ticket.learner_phone: [self.ticket.learner_email]})

    def test_intent_match_is_idempotent(self, config):
        intent = create_intent(self.ticket.pk, self.agent)
        start = timezone.now() - timedelta(minutes=1)
        CallIntent.objects.filter(pk=intent.pk).update(created_at=start - timedelta(minutes=1))
        call = make_call(self.agent, started_at=start, ended_at=start + timedelta(seconds=20))
        self.assertFalse(match_call(call.pk).manual)
        match_call(call.pk)
        self.assertEqual(CaseCall.objects.count(), 1)
        self.assertEqual(TicketEvent.objects.filter(kind='zoom_call').count(), 1)
        intent.refresh_from_db()
        self.assertEqual(intent.matched_call_id, call.pk)

    def test_manual_dial_and_wrong_identity(self, config):
        call = make_call(self.agent, caller_email='other@example.test')
        self.assertIsNone(match_call(call.pk))
        call.caller_email = self.agent.zoom_email
        call.save()
        self.assertTrue(match_call(call.pk).manual)

    def test_shared_phone_number_is_not_guessed(self, config):
        make_case(learner_email='different@example.test')
        call = make_call(self.agent)
        self.assertIsNone(match_call(call.pk))

    def test_calls_before_case_or_inbound_not_matched(self, config):
        call = make_call(self.agent, started_at=self.ticket.created_at - timedelta(minutes=1))
        self.assertIsNone(match_call(call.pk))
        call = make_call(self.agent, direction='inbound')
        self.assertIsNone(match_call(call.pk))

    def test_three_real_failures_and_resync(self, config):
        for i in range(3):
            start = timezone.now() - timedelta(hours=6 - i)
            call = make_call(self.agent, started_at=start, ended_at=start + timedelta(seconds=10), result='no_answer')
            match_call(call.pk)
            match_call(call.pk)
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.attempts, 3)
        self.assertEqual(self.ticket.status, 'unreachable')
        self.assertIsNone(self.ticket.next_followup_at)

    def test_outcome_cannot_claim_answered_when_zoom_says_no(self, config):
        call = make_call(self.agent, result='busy')
        match_call(call.pk)
        with self.assertRaises(ValueError):
            record_outcome(self.ticket.pk, self.agent.user, call.pk, 'reached')

    def test_no_result_applied_before_call_ends(self, config):
        call = make_call(self.agent, result='no_answer', ended_at=None)
        match_call(call.pk)
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.attempts, 0)

    def test_old_account_data_not_matched(self, config):
        call = make_call(self.agent, zoom_account_id='old-account')
        self.assertIsNone(match_call(call.pk))

    def test_late_call_history_still_attaches_to_resolved_intent(self, config):
        intent = create_intent(self.ticket.pk, self.agent)
        start = timezone.now() - timedelta(minutes=2)
        CallIntent.objects.filter(pk=intent.pk).update(created_at=start - timedelta(minutes=1))
        resolve(self.ticket.pk, self.agent.user, note='Verified by manager')
        call = make_call(self.agent, started_at=start, ended_at=start + timedelta(seconds=30))
        self.assertIsNotNone(match_call(call.pk))
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.status, 'resolved')

    def test_late_failure_does_not_replace_later_answer(self, config):
        answered = make_call(self.agent)
        match_call(answered.pk)
        older = make_call(self.agent, result='no_answer', started_at=answered.started_at - timedelta(hours=1),
                          ended_at=answered.started_at - timedelta(minutes=59))
        match_call(older.pk)
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.status, 'pending_verification')
        self.assertIsNone(self.ticket.next_followup_at)

    def test_manual_call_does_not_take_another_live_claim(self, config):
        alice = make_agent('Alice', 'office')
        claim(self.ticket.pk, alice)
        match_call(make_call(self.agent).pk)
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.claimed_by_id, alice.pk)
        self.assertEqual(self.ticket.status, 'in_progress')

    def test_phone_shared_by_learner_without_a_case_is_ambiguous(self, config):
        CycleState.objects.filter(name='phone_directory').update(details={self.ticket.learner_phone: [self.ticket.learner_email, 'other@example.test']})
        self.assertIsNone(match_call(make_call(self.agent).pk))

    def test_stale_directory_does_not_match_manual_call(self, config):
        CycleState.objects.filter(name='phone_directory').update(last_success_at=timezone.now() - timedelta(days=2))
        self.assertIsNone(match_call(make_call(self.agent).pk))


class EvidenceTests(TestCase):
    def setUp(self):
        self.ticket = make_case()
        self.evidence = {'source_ok': True, 'ambiguous': False, 'learner_email': self.ticket.learner_email,
            'kind': 'attendance_present', 'table': 'kbc_attendance', 'row_key': '1',
            'date': timezone.now().isoformat(), 'value': {'module': 'Module 1', 'attendance': 1}}

    def test_rejects_old_future_ambiguous_failed_and_wrong_learner(self):
        self.assertTrue(valid_evidence(self.ticket, self.evidence))
        for changes in ({'date': (self.ticket.created_at - timedelta(seconds=1)).isoformat()},
                        {'date': (timezone.now() + timedelta(days=1)).isoformat()}, {'ambiguous': True},
                        {'source_ok': False}, {'learner_email': 'other@example.test'}, {'kind': 'ai_claim'}):
            with self.subTest(changes=changes):
                self.assertFalse(valid_evidence(self.ticket, {**self.evidence, **changes}))

    def test_system_cannot_resolve_without_proof(self):
        with self.assertRaises(ValueError):
            resolve(self.ticket.pk)
        resolve(self.ticket.pk, evidence=self.evidence)
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.resolved_by, 'system')

    def test_reopen_cannot_immediately_reclose_on_same_old_evidence(self):
        agent = make_agent()
        resolve(self.ticket.pk, evidence=self.evidence)
        reopen(self.ticket.pk, agent.user, 'Evidence disputed after review')
        self.ticket.refresh_from_db()
        self.assertFalse(valid_evidence(self.ticket, self.evidence))
        with self.assertRaises(ValueError):
            resolve(self.ticket.pk, evidence=self.evidence)

    @patch('api.callcenter.evidence.rows', side_effect=OperationalError('test outage'))
    def test_source_failure_is_not_completion(self, mock):
        with self.assertRaises(OperationalError):
            check_evidence(self.ticket)
        self.ticket.refresh_from_db()
        self.assertNotEqual(self.ticket.status, 'resolved')

    def test_otj_and_epa_current_snapshot_require_human(self):
        for category in ('otj', 'epa', 'reminder'):
            self.ticket.source_type = category
            self.assertIsNone(check_evidence(self.ticket))

    @patch('api.callcenter.evidence.rows', return_value=[])
    def test_booking_must_be_created_after_case(self, rows):
        self.ticket.source_type = 'mcm'
        booking = DashboardBooking.objects.create(learner_email=self.ticket.learner_email, learner_name='Test', coach='Coach',
                     session_type='MCM', booking_date=timezone.now().date() + timedelta(days=3), booking_time='10:00')
        DashboardBooking.objects.filter(pk=booking.pk).update(created_at=self.ticket.created_at - timedelta(days=1))
        self.assertIsNone(check_evidence(self.ticket))
        DashboardBooking.objects.filter(pk=booking.pk).update(created_at=timezone.now())
        self.assertEqual(check_evidence(self.ticket)['kind'], 'mcm_booking')


def valid_ai():
    return {'outcome': 'resolved', 'absence_reason': '', 'chosen_option': 'watch_recording', 'promised_date': None,
        'commitments': [], 'sentiment': 'neutral', 'agent_quality_score': 3, 'agent_quality_notes': '',
        'summary': 'Learner says they watched the recording.', 'confidence': 0.8}


class AITests(TestCase):
    def test_strict_schema(self):
        self.assertEqual(validate_analysis(valid_ai()), valid_ai())
        for changes in ({'confidence': float('nan')}, {'confidence': True}, {'agent_quality_score': 6},
                        {'promised_date': 'tomorrow'}, {'chosen_option': 'delete_data'}, {'commitments': 'text'},
                        {'surprise': 'extra'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_analysis({**valid_ai(), **changes})

    @override_settings(OPENAI_API_KEY='', OPENAI_MODEL='')
    @patch('api.callcenter.ai.requests.post')
    def test_disabled_ai_never_calls_provider(self, post):
        recording = Mock(transcript_text='test')
        self.assertIsNone(analyze_recording(recording))
        post.assert_not_called()

    def test_ai_claim_never_auto_closes(self):
        agent = make_agent()
        ticket = make_case()
        call = make_call(agent)
        match = CallMatch.objects.create(agent=agent, call=call, learner_email=ticket.learner_email)
        CaseCall.objects.create(ticket=ticket, match=match)
        recording = ZoomPhoneRecording.objects.create(source_account=agent.zoom_account, zoom_account_id='account-test',
                     recording_id='rec-1', call_log_id=call.history_id, started_at=call.started_at)
        analysis = AIAnalysis.objects.create(recording=recording, transcript_hash='hash', model='test', result=valid_ai(), state='ready')
        apply_analysis(analysis)
        apply_analysis(analysis)
        ticket.refresh_from_db()
        self.assertEqual(ticket.status, 'ai_suggested_close')
        self.assertIsNone(ticket.resolved_at)
        self.assertEqual(ticket.events.filter(kind='ai_analysis').count(), 1)


@override_settings(CALLCENTRE_EMAIL_MODE='dry_run', CALLCENTRE_EMAIL_DAILY_CAP=2,
                   CALLCENTRE_PUBLIC_URL='https://dashboard.example.test', CALLCENTRE_ESCALATION_EMAIL='manager@example.test')
class EmailSurveyTests(TestCase):
    @override_settings(CALLCENTRE_EMAIL_MODE='live')
    @patch('api.callcenter.emails.requests.post')
    def test_live_gateway_contract_and_cc(self, post):
        post.return_value.status_code = 200
        ticket = make_case(manager_email='employer@example.test')
        result = send_ticket_email(ticket.pk, 'escalation')
        self.assertEqual(result.status, 'accepted')
        recipient = post.call_args.kwargs['json']['recipients'][0]
        self.assertEqual(recipient['cc'], ['manager@example.test'])
        self.assertEqual(recipient['ccEmail'], 'manager@example.test')
        self.assertEqual(recipient['learnerEmail'], 'employer@example.test')

    @override_settings(CALLCENTRE_EMAIL_MODE='live')
    @patch('api.callcenter.emails.requests.post')
    def test_unknown_delivery_is_not_retried(self, post):
        import requests
        post.side_effect = requests.Timeout()
        ticket = make_case()
        self.assertEqual(send_ticket_email(ticket.pk, 'initial').status, 'unknown')
        self.assertIsNone(send_ticket_email(ticket.pk, 'initial'))
        self.assertEqual(post.call_count, 1)

    @patch('api.callcenter.emails.requests.post')
    def test_dry_run_renders_no_send_and_no_duplicate(self, post):
        ticket = make_case(coach='Olivia', learner_name='<script>alert(1)</script>')
        delivery = send_ticket_email(ticket.pk, 'initial')
        self.assertEqual(delivery.status, 'dry_run')
        self.assertNotIn('<script>', delivery.html)
        self.assertIn('outlook.office.com', delivery.html)
        self.assertIsNone(send_ticket_email(ticket.pk, 'initial'))
        post.assert_not_called()

    def test_resolved_ticket_never_emailed_and_daily_cap(self):
        first, second, third = make_case(), make_case(), make_case()
        self.assertIsNotNone(send_ticket_email(first.pk, 'initial'))
        self.assertIsNotNone(send_ticket_email(second.pk, 'initial'))
        self.assertIsNone(send_ticket_email(third.pk, 'initial'))
        third.status = 'resolved'
        third.save()
        self.assertIsNone(send_ticket_email(third.pk, 'day2'))

    def test_quarterly_surveys_group_managers_and_no_get_submission(self):
        people = {str(i): {'manager_email': 'manager@example.test', 'manager_name': 'Manager', 'organisation': 'Employer'} for i in range(2)}
        generate_surveys(people)
        generate_surveys(people)
        self.assertEqual(EmployerSatisfaction.objects.count(), 1)
        item = EmployerSatisfaction.objects.get()
        token = survey_token(item)
        url = f'/api/callcentre/survey/{token}/'
        client = Client(enforce_csrf_checks=True)
        self.assertEqual(client.get(url + '?score=1').status_code, 200)
        item.refresh_from_db()
        self.assertIsNone(item.score)
        self.assertEqual(client.post(url, {'score': 1}).status_code, 403)
        token_csrf = client.cookies['csrftoken'].value
        self.assertEqual(client.post(url, {'score': 1, 'comment': 'Needs improvement'}, HTTP_X_CSRFTOKEN=token_csrf).status_code, 200)
        item.refresh_from_db()
        self.assertEqual(item.score, 1)
        self.assertEqual(item.ticket.status, 'resolved')
        self.assertTrue(item.ticket.escalated)
        self.assertEqual(client.post(url, {'score': 5}, HTTP_X_CSRFTOKEN=token_csrf).status_code, 410)

    def test_expired_and_forged_survey(self):
        ticket = make_case(source_type='satisfaction')
        item = EmployerSatisfaction.objects.create(ticket=ticket, manager_email='m@example.test', quarter='2026-Q3',
                                                  expires_at=timezone.now() - timedelta(days=1))
        self.assertEqual(self.client.get(f'/api/callcentre/survey/{survey_token(item)}/').status_code, 410)
        self.assertEqual(self.client.get('/api/callcentre/survey/fake/').status_code, 400)


class EndpointTests(TestCase):
    def setUp(self):
        self.agent = make_agent()
        self.ticket = make_case()

    def test_auth_and_csrf_required(self):
        self.assertEqual(self.client.get('/api/callcentre/queue/').status_code, 401)
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.agent.user)
        self.assertEqual(client.post(f'/api/callcentre/tickets/{self.ticket.pk}/claim/', '{}', content_type='application/json').status_code, 403)
        token = client.get('/api/callcentre/config/').json()['csrf_token']
        self.assertEqual(client.post(f'/api/callcentre/tickets/{self.ticket.pk}/claim/', '{}', content_type='application/json', HTTP_X_CSRFTOKEN=token).status_code, 200)
        self.assertEqual(client.post(f'/api/callcentre/tickets/{self.ticket.pk}/claim/', '{}', content_type='application/json', HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN='http://127.0.0.1:5174').status_code, 200)
        self.assertEqual(client.post(f'/api/callcentre/tickets/{self.ticket.pk}/claim/', '{}', content_type='application/json', HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN='https://untrusted.example').status_code, 403)

    def test_readonly_user_cannot_work(self):
        self.client.force_login(make_user('viewer'))
        self.assertEqual(self.client.post(f'/api/callcentre/tickets/{self.ticket.pk}/resolve/',
                         {'note': 'done'}, content_type='application/json').status_code, 403)

    def test_call_uri_uses_the_selected_agents_zoom_caller_id(self):
        self.agent.zoom_phone_number = '+447700900111'
        self.agent.save(update_fields=['zoom_phone_number'])
        self.client.force_login(self.agent.user)
        response = self.client.post(
            f'/api/callcentre/tickets/{self.ticket.pk}/call/', '{}', content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()['zoom_url'],
            'zoomphonecall://+447700900123?callerid=%2B447700900111',
        )

    def test_queue_groups_learner_and_sanitizes_pagination(self):
        make_case(source_type='pr')
        self.client.force_login(self.agent.user)
        result = self.client.get('/api/callcentre/queue/').json()
        self.assertEqual(result['total'], 1)
        self.assertEqual(len(result['groups'][0]['tickets']), 2)
        lecture = next(item for item in result['groups'][0]['tickets'] if item['source_type'] == 'attendance')
        self.assertEqual(lecture['issue_name'], 'Module 1')
        self.assertIsNone(lecture['issue_date'])
        detail = self.client.get(f'/api/callcentre/tickets/{self.ticket.pk}/').json()
        self.assertEqual(next(item for item in detail['issues'] if item['id'] == self.ticket.pk)['issue_name'], 'Module 1')
        self.assertEqual(self.client.get('/api/callcentre/queue/?page=bad').status_code, 400)

    @patch('api.zoom_views.account_config', return_value={'account_id': 'account-test'})
    @patch('api.callcenter.reports.account_config', return_value={'account_id': 'account-test'})
    def test_metrics_only_real_answered_zoom_time(self, one, two):
        make_call(self.agent, duration_seconds=100)
        make_call(self.agent, duration_seconds=300, result='no_answer')
        make_call(self.agent, duration_seconds=None)
        today = timezone.now().astimezone(LONDON).date()
        result = performance(today - timedelta(days=1), today)['agents'][0]
        self.assertEqual(result['seconds'], 100)
        self.assertEqual(result['calls'], 3)
        self.assertEqual(result['missing_duration'], 1)
        self.assertEqual(result['not_answered'], 1)


class ClaimConcurrencyTests(TransactionTestCase):
    def test_competing_claims_have_one_winner(self):
        ticket = make_case()
        agents = [make_agent(), make_agent('Alice', 'office')]
        barrier = Barrier(2)

        def run(agent):
            close_old_connections()
            try:
                barrier.wait()
                for _ in range(20):
                    try:
                        claim(ticket.pk, agent)
                        return 'won'
                    except Conflict:
                        return 'lost'
                    except OperationalError:
                        # SQLite serializes writers with a busy error; retry the same CAS.
                        import time
                        time.sleep(0.01)
                return 'busy'
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(run, agents))
        self.assertEqual(sorted(outcomes), ['lost', 'won'])
