# Call Centre

The Call Centre is an additive Django app (`api.callcenter`) and React route
`/call-centre`. Existing ticket pages and the two Activity Report tabs remain in
place; the report now has an **Agent performance** tab.

## Data and Approval Boundaries

Read `../docs/CALL_CENTRE_DATA_MAP.md` for the verified schema and joins.
External Aptem, attendance, coach and LMS tables are read-only. New state lives
in `callcenter_*` tables in the primary Neon database.

The user approved a narrow exception for the five existing dashboard ticket
tables: resolving a linked Call Centre case sets the legacy ticket's status to
`resolved`. Existing action, notes, attachments, ownership and other data remain
unchanged. Before/after states are audited. Reopening restores the earlier
status only if it has not subsequently been changed by another workflow.
Identity mismatch blocks the entire resolution transaction.
Reopening also advances the evidence cutoff: the same old attendance/completion
event cannot immediately reclose a disputed case. Old call outcomes and old AI
analyses cannot override the reopened workflow. The original SLA is retained;
the email reminder sequence uses the new reopening timestamp.

No hard-delete API or admin action is provided. Cases can be archived only after
resolution by a manager. Events are append-only through the application ORM;
this is not a substitute for restricting direct database administrator access
and retaining database backups.

## Setup

1. Use the backend environment that already runs this dashboard.
2. Review `.env.callcentre.example`. Set options in backend `.env`, not `,env`.
   Both secret filenames are gitignored. Do not commit either file or expose
   secrets through Vite.
3. Apply only the additive Call Centre migrations:

   ```sh
   python manage.py migrate callcenter --plan
   python manage.py migrate callcenter
   ```

4. In Django admin, create an **Agent** profile for each existing dashboard user:
   Liza and Alice. Configure their real Zoom email, optional Zoom user ID and
   verified assigned E.164 phone number, account (`student` or `office`), active state and daily talk-time target. No account
   mapping or login user is created automatically. Staff users can review and
   resolve cases; dial/claim actions also require an active Agent profile.
   The confirmed mapping is **Alice = Office; Liza = Student**. In the current
   Neon database these link to existing logins `Alice.Saunders` and `Lisa.Sedge`
   respectively. Display name Liza does not rename the existing Lisa login.
   Their Zoom emails/user IDs were verified through read-only Zoom API calls.
   A phone number is display/contact metadata, never sufficient call identity.
   A Django superuser can operate either configured Zoom account from the Call
   Centre account selector. A regular agent sees and can use only the Zoom
   account attached to their own Agent profile. The timeline records the real
   signed-in username while retaining the selected Zoom identity separately.
   Users without an Agent profile remain read-only unless they are superusers.
5. Ensure each Zoom client is logged into the same configured agent identity
   and has an enabled Zoom Phone number. Keep existing backend Zoom credentials.
6. Bootstrap without calling providers or sending emails:

   ```sh
   python manage.py run_callcentre_cycle --skip-zoom --skip-ai --skip-emails
   ```

7. Inspect the queue and source warnings. Then run one supervised worker:

   ```sh
   python manage.py run_callcentre_cycle --loop --interval 300
   ```

The worker reuses existing Zoom sync/leases, then refreshes cases and bookings,
matches real calls, evaluates evidence and SLAs, analyzes eligible transcripts
if configured, and processes emails according to the configured mode.
Do not run an additional independent Zoom polling worker unnecessarily.
The Call Centre cycle has its own database lease. A crashed cycle lease expires
after two hours; do not clear it manually until the old process is confirmed
stopped. Schedule the command on the deployed backend host, not the browser.
No permanent scheduler is installed by these code changes. The local test worker
uses `--loop --interval 300 --skip-ai --skip-emails`; it stops with the local
machine and does not enable production jobs or email/AI delivery.

## Workflow

- Existing unarchived, unresolved legacy tickets are linked idempotently. Source
  generation calls the existing read-only summary calculations, not the legacy
  auto-create endpoints. Attendance additionally examines the current and last
  three weeks using the existing weekly-missing helper; older existing tickets
  remain available. Resolved source reasons are not automatically regenerated.
- Queue rows group a learner's issues, show the coach and support filtering.
  Priority is defined once in `rules.priority`: red risk, breached SLA, learner
  lateness, misses, tomorrow booking, then fewer failed attempts.
- Opening an unclaimed case as an agent or pressing Call claims it. Another
  agent cannot take a live claim. Claims expire after 30 minutes without an
  action; simply leaving the page open does not reset that timer. A group dial
  claims all included issues atomically or fails without partially claiming.
- Call creates a ten-minute intent before opening `zoomphonecall://+...`.
  The explicit `tel:` fallback depends on the device's default telephone app;
  it does not bypass the requirement for a confirmed Zoom call.
- Match uses outbound direction, configured account and unique agent identity,
  exact normalized number and intent time. Without an intent, exact unique
  learner phone matching requires a successful contact directory snapshot less
  than 24 hours old. Ambiguous/missing matches remain unlinked.
- Only real linked Zoom calls allow outcomes. A reached/callback outcome
  requires Zoom's answered result; no-answer requires a Zoom failed result.
  An outcome never proves attendance, completion or recording consumption.
- A completed failed call schedules +2 hours, then the next UK working day at
  09:00. Three failed attempts exhaust automatic calling; a third failure sets
  unreachable/escalated and queues email follow-up. Imports are idempotent and
  processed chronologically; earlier late-arriving failures do not overwrite a
  newer answered call's state. History still retains every failed attempt.
- UK working-day SLA defaults: lecture 2, MCM/PR 3, OTJ/EPA 5, satisfaction 14.
  Reminder due time is the session start. Configure regional holidays with
  `CALLCENTRE_HOLIDAYS=YYYY-MM-DD,...`. Learner lateness and case SLA are separate.
  The first breach event records agents who had worked on the case, or unclaimed.
- Tomorrow uses exact-email dashboard bookings and confirmed coach booking
  JSON. Name-only upcoming JSON is not guessed. One reminder per learner,
  session type and start time; ambiguous or rescheduled attendance is reviewed
  manually until an exact session-attendance link is available.

## Evidence and AI

Automatic resolution requires exact learner identity, trustworthy source
success, and an actual event dated strictly after case creation and not in the
future. Date-only source events on the creation day are conservatively rejected.

Currently enabled deterministic evidence:

- Lecture: later attendance for the exact module, rejecting conflicting rows.
- PR/MCM: explicit **Last Actually Completed** date after case creation, or a
  matching future dashboard booking whose creation timestamp is after the case.
- Employer satisfaction: the recorded, signed survey response.

**Intentionally manual until better evidence is connected:**

- Recording consumption: LMS v2 tracking exists in sibling source code but no
  verified read-only connection is configured in this dashboard. A recording
  URL, clicking it or generic LMS progress is not completion evidence.
- OTJ/EPA status snapshots have no reliable transition timestamp.
- Tomorrow reminders lack a verified appointment-to-attendance join.

These cases remain open or pending human review. AI never bypasses that gate.
After a missed promise deadline the case returns to the queue if it still has
no verified evidence. Human resolution requires a written reason and is audited.

Set `OPENAI_API_KEY` and an enabled `OPENAI_MODEL` explicitly to enable analysis.
Leaving either blank disables AI. Only transcripts associated with an
unambiguously linked Call Centre call and an open case are eligible. The fixed
OpenAI Chat Completions endpoint receives the transcript, model and analysis
instructions; no Zoom secrets are sent. Review external-processing policy before
enabling it. At most ten new analyses run per cycle.

The response must pass strict field/type/enum/range/date validation. Transcript
instructions are treated as untrusted text. A model claim of resolution creates
`ai_suggested_close`, never automatic resolution. A promise creates pending
verification. The timeline retains model, transcript hash/reference and result.
Invalid/failed analyses remain in an error state for operator inspection, not
unbounded automatic retries. Transcript references retain existing full text
and timestamped segments in `ZoomPhoneRecording`; there is no second recording
collector and no audio-binary download.

## Emails and Surveys

`CALLCENTRE_EMAIL_MODE=dry_run` renders and logs emails without making a gateway
request. The default daily recipient cap is two, across cases. Dedupe keys and
a locked recipient/date quota guard overlapping sends. Initial and day 2/5/7
stages are supported, with the latest due stage selected after a prolonged
outage rather than sending the entire backlog at once. Day 7/exhausted calls
queue escalation to the line manager. Missing contact details are logged.
Resolution stops later reminders; accepted gateway messages cannot be recalled.

Booking links mirror `frontend/src/lib/bookingLinks.ts`. Exact module/session
recording links are used when uniquely available from `lecture_recording_links`;
otherwise the email states that the link is unavailable. A support booking URL
is labeled support, not falsely described as a guaranteed lecture catch-up slot.

For live mail, configure the existing `N8N_EMAIL_WEBHOOK`, verified recipients
and `CALLCENTRE_ESCALATION_EMAIL`, then explicitly set mode to `live` and restart
the worker. Payload fields match the existing Email Centre gateway shape.
Gateway 2xx means **accepted**, not independently verified inbox delivery.
Timeouts have unknown delivery state and are not blindly retried. The gateway
must honor the idempotency key for reliable delivery across crashes. Inspect
failed/unknown records and the gateway before any manual retry. Dry-run and live
keys are separate; switching to live does not silently reuse dry-run deliveries.

Each manager gets at most one survey per calendar quarter across their learners.
Set `CALLCENTRE_PUBLIC_URL` to the public HTTPS origin that routes `/api` to Django.
Signed single-use links expire after 30 days. GET displays a confirmation form;
POST with CSRF protection submits the score, preventing email scanners from
submitting a rating. No learner information is exposed by this public endpoint.
A score <=2 flags escalation and queues a follow-up to the employer with the
configured internal manager in CC; it
does not reopen the completed survey. Organisation/quarter averages form the trend.

## API and UI

All endpoints except signed surveys require an active authenticated session.
Mutations require CSRF; fetch the token from `GET /api/callcentre/config/`.
Local Vite ports 5173/5174 are trusted by default. In production configure
`CSRF_TRUSTED_ORIGINS` with the exact HTTPS frontend origin when the backend is
behind a TLS-terminating proxy. Do not use wildcard origins or disable CSRF.

```text
GET  /api/callcentre/config/
GET  /api/callcentre/queue/?view=queue|tomorrow|due|ai|history&page=1
GET  /api/callcentre/tickets/{id}/?event_page=1
POST /api/callcentre/tickets/{id}/claim|release|call|outcome|note|resolve|reopen|reject_ai|archive/
GET  /api/callcentre/performance/?from=YYYY-MM-DD&to=YYYY-MM-DD
GET  /api/callcentre/satisfaction/?quarter=2026-Q3&page=1
GET/POST /api/callcentre/survey/{signed-token}/
```

Queue filters: `q`, `coach`, `source_type`, `status`, `claimed=yes|no`,
`due=overdue|within`. The ticket drawer includes issues, actions, append-only
timeline, email text, real calls and the existing transcript dialog/download.
Views refresh every minute while visible.

Agent metrics use Zoom outbound records only, with current account IDs and
unambiguous agent identity. Answered durations are summed without substituting
missing values. The provider duration is not guaranteed pure speaking time.
Per-day no-call intervals are gaps in stored Zoom records, not proof of employee
absence or a substitute for a complete sync; the UI hides gaps on sync failure.
Automatic emails on cases an agent has worked are labeled accordingly and are
not credited as manual agent sends. Resolutions distinguish agent/AI/system.

## Verification

Isolated tests never use configured Neon databases or call providers:

```sh
python manage.py test api.callcenter api.test_zoom_phone api.test_zoom_recordings --settings=config.test_settings --noinput
python manage.py check
```

Frontend:

```sh
node node_modules/vite/bin/vite.js build
node node_modules/eslint/bin/eslint.js src/pages/CallCentre.tsx src/components/callcenter
node src/test/callcentre.browser.cjs
```

The browser script requires Playwright and Chrome, and defaults to
`http://127.0.0.1:5173`. `PLAYWRIGHT_PATH` can point at an existing Playwright
installation. All API traffic is mocked: no browser fixture enters Neon or
initiates a telephone call. Screenshots are saved to the OS temporary directory.

The repository currently has unrelated TypeScript errors in existing mock data
and legacy ticket pages. Its `ignoreDeprecations: 6.0` is also incompatible with
the installed TypeScript 5.8 compiler; diagnostic-only runs can override it with
`--ignoreDeprecations 5.0`. These unrelated files/settings were not refactored.

Live read-only verification on 2026-09-29: 699 learner profiles and 11 tomorrow
bookings were returned. Student Zoom API authentication/history/recordings
succeeded with zero records in the checked two-day window. Office still returned
Zoom error 2031 (Zoom Phone not enabled). No live transcript analysis or email
delivery was tested. A subsequent user-directory check verified the Student
Zoom identity and assigned number. Office's Zoom identity was verified via
`GET /users`, but `GET /phone/users` also returned 2031, so its phone remains
blank. Correct the Zoom Phone entitlement/account credentials in Zoom before
expecting Office calls. Neither account is identified from an assumed number.

Rollout verification: all three additive Call Centre migrations applied to the
primary Neon database. Bootstrap stored 2,412 real-source cases (including 600
quarterly surveys), grouped into 443 learners in the queue, with 11 tomorrow
reminders. A second cycle created zero additional legacy/source/reminder cases.
There were zero legacy writeback events and zero email deliveries during setup.
After the confirmed agent setup, another cycle imported zero Student calls and
added seven newly due tomorrow reminders (2,419 cases total); no legacy/source
case duplicates, evidence resolutions or call matches were created. Both saved
agent identities and performance endpoints passed live read-only checks. No
dashboard authentication credentials or source records were modified.

The 86 isolated backend tests passed, as did the frontend build, targeted lint
and mocked Chrome checks at 1440px and 390px. Tests explicitly verify the
Alice/Office and Liza/Student separation, reject phone-only attribution, and
keep ticket metrics visible when Zoom has not synced. Transcript display is
tested with fixtures; there are no real recordings available for a live test.
No live mail, AI provider run or frontend production deployment was enabled.

Local test instance:
- UI: `http://127.0.0.1:5174/call-centre`
- Performance: `http://127.0.0.1:5174/activity-report` (Agent performance tab)
- Backend: `http://127.0.0.1:8002`
- Hidden local polling worker: every 300 seconds, AI and emails skipped.
- Worker logs: `%TEMP%/callcentre-worker.log` and `callcentre-worker.error.log`.

These servers run the complete checkout at
`C:/Users/DELL/Desktop/ENGAGEMENT/superAdminDashboard`, not the incomplete
`C:/Users/DELL/Desktop/superAdminDashboard` workspace. Keep local processes
attached to this same checkout; do not start a duplicate polling worker.

References used for integration behavior:
- https://developers.zoom.us/docs/phone/outbound-call/
- https://developers.zoom.us/docs/api/phone/
- https://platform.claude.com/docs/en/manage-claude/authentication
- https://github.com/anthropics/skills/blob/main/skills/claude-api/curl/examples.md
