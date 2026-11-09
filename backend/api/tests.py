import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase

from .engagement_admin import (
    _admin_only,
    _attention,
    _json_array,
    _verified_calls_cte,
    _working_days,
    engagement_call_transcript,
)
from .lms_otjh import lms_otjh_summary
from .views import _otj_ticket_to_dict, send_email_proxy


class CanonicalOtjhTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @patch("api.lms_otjh.load_lms_otjh_rows")
    def test_otjh_endpoint_identifies_the_canonical_lms_source(self, load_rows):
        load_rows.return_value = [{"id": "1", "email": "learner@example.com"}]

        response = lms_otjh_summary(self.factory.get("/api/otj-at-risk/"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertIn("Learner.learners", response["X-OTJH-Source"])
        self.assertEqual(json.loads(response.content)[0]["email"], "learner@example.com")

    def test_ticket_display_uses_live_lms_otjh_metrics(self):
        from datetime import datetime, timezone

        ticket = SimpleNamespace(
            pk=7,
            ticket_ref="OTJ-007",
            learner_email="learner@example.com",
            learner_name="Old name",
            learner_phone="",
            organisation="Old org",
            programme="Old programme",
            otj_minimum=100,
            otj_completed=20,
            otj_expected=50,
            otj_status="At Risk",
            risk="red",
            status="open",
            assigned_owner="Owner",
            action="",
            notes="",
            is_archived=False,
            escalated=False,
            created_by="System",
            created_at=datetime(2026, 11, 1, tzinfo=timezone.utc),
            updated_at=datetime(2026, 11, 1, tzinfo=timezone.utc),
            evidence_count=0,
        )
        live = {
            "fullName": "Current name",
            "otjMinimum": 120,
            "otjCompleted": 80,
            "otjExpected": 75,
            "otjHoursStatus": "On Track",
            "targetAsOfDate": "2026-11-08",
            "targetStatus": "FORMULA_READY",
        }

        payload = _otj_ticket_to_dict(ticket, live)

        self.assertEqual(payload["otjCompleted"], 80)
        self.assertEqual(payload["otjExpected"], 75)
        self.assertEqual(payload["otjStatus"], "On Track")
        self.assertEqual(payload["risk"], "green")
        self.assertEqual(payload["otjDataSource"], "lms")


class EngagementAdminAccessTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def request(self, *, authenticated, staff=False, superuser=False):
        request = self.factory.get("/api/engagement/team/")
        request.user = SimpleNamespace(
            is_authenticated=authenticated,
            is_staff=staff,
            is_superuser=superuser,
        )
        return request

    def test_anonymous_user_is_rejected_before_report_queries(self):
        response = _admin_only(self.request(authenticated=False))
        self.assertEqual(response.status_code, 401)

    def test_authenticated_non_admin_is_rejected(self):
        response = _admin_only(self.request(authenticated=True))
        self.assertEqual(response.status_code, 403)

    def test_staff_and_superusers_are_allowed(self):
        self.assertIsNone(_admin_only(self.request(authenticated=True, staff=True)))
        self.assertIsNone(_admin_only(self.request(authenticated=True, superuser=True)))

    def test_transcript_is_rejected_before_database_access_for_non_admins(self):
        anonymous = self.request(authenticated=False)
        non_admin = self.request(authenticated=True)
        self.assertEqual(engagement_call_transcript(anonymous, 1).status_code, 401)
        self.assertEqual(engagement_call_transcript(non_admin, 1).status_code, 403)


class EngagementAdminReportingTests(SimpleTestCase):
    def test_json_array_handles_decoded_and_string_jsonb_values(self):
        rows = [{"id": 1}]
        self.assertEqual(_json_array(rows), rows)
        self.assertEqual(_json_array('[{"id": 1}]'), rows)
        self.assertEqual(_json_array('{"id": 1}'), [])
        self.assertEqual(_json_array("not-json"), [])

    def test_working_days_count_only_elapsed_weekdays(self):
        from datetime import datetime
        from zoneinfo import ZoneInfo

        london = ZoneInfo("Europe/London")
        start = datetime(2026, 11, 2, tzinfo=london)  # Monday
        end = datetime(2026, 11, 9, tzinfo=london)    # The following Monday, exclusive
        self.assertEqual(_working_days(start, end), 5)

    def test_attention_lists_direct_exceptions_and_review_prompts(self):
        flags = _attention({
            "openSlaBreaches": 2,
            "overdueFollowups": 1,
            "missingOutcomes": 3,
            "missingRecordings": 1,
            "badCalls": 2,
            "targetSeconds": 1000,
            "talkSeconds": 500,
            "calls": 20,
            "answerRate": 25,
        })
        self.assertEqual(
            {item["key"] for item in flags},
            {"sla", "followup", "outcome", "recording", "quality", "talk", "answer"},
        )

    def test_call_scope_starts_from_the_original_call_intents(self):
        sql = _verified_calls_cte(include_event_calls=False)
        self.assertIn("FROM callcenter_call_intent ci", sql)
        self.assertIn("LEFT JOIN dashboard_zoom_phone_call z", sql)
        self.assertIn("z.id IS NOT NULL AS matched", sql)
        self.assertIn("saved_event.kind = 'call_saved'", sql)
        self.assertNotIn("callcenter_event_call", sql)

    def test_event_calls_can_be_added_without_double_counting(self):
        sql = _verified_calls_cte(include_event_calls=True)
        self.assertIn("callcenter_event_call", sql)
        self.assertIn("NOT EXISTS", sql)


class EmailProxyTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def request(self, payload, *, authenticated=True, staff=True):
        request = self.factory.post(
            "/api/send-email/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        request.user = SimpleNamespace(
            is_authenticated=authenticated,
            is_staff=staff,
            is_superuser=False,
        )
        return request

    @staticmethod
    def payload():
        return {
            "cc": ["Manager@Example.com", "manager@example.com"],
            "recipients": [{
                "learnerEmail": "learner@example.com",
                "renderedSubject": "Subject",
                "renderedBody": "<p>Body</p>",
                "cc": ["coach@example.com", "learner@example.com"],
            }],
        }

    @patch("api.views.requests.post")
    def test_email_proxy_requires_an_authenticated_admin(self, post):
        anonymous = send_email_proxy(self.request(self.payload(), authenticated=False))
        non_admin = send_email_proxy(self.request(self.payload(), staff=False))
        self.assertEqual(anonymous.status_code, 401)
        self.assertEqual(non_admin.status_code, 403)
        post.assert_not_called()

    @patch("api.views.requests.post")
    def test_email_proxy_rejects_invalid_cc_without_sending(self, post):
        payload = self.payload()
        payload["cc"] = ["not-an-email"]
        response = send_email_proxy(self.request(payload))
        self.assertEqual(response.status_code, 400)
        post.assert_not_called()

    @patch("api.views.requests.post")
    def test_email_proxy_normalizes_and_deduplicates_cc(self, post):
        webhook_response = Mock(status_code=200)
        webhook_response.json.return_value = {"sentCount": 1, "failedCount": 0}
        post.return_value = webhook_response

        response = send_email_proxy(self.request(self.payload()))

        self.assertEqual(response.status_code, 200)
        sent_payload = post.call_args.kwargs["json"]
        recipient = sent_payload["recipients"][0]
        self.assertEqual(sent_payload["cc"], ["manager@example.com"])
        self.assertEqual(recipient["cc"], ["manager@example.com", "coach@example.com"])
        self.assertEqual(recipient["ccEmail"], "manager@example.com")
        self.assertEqual(
            recipient["ccRecipients"],
            [
                {"emailAddress": {"address": "manager@example.com"}},
                {"emailAddress": {"address": "coach@example.com"}},
            ],
        )
