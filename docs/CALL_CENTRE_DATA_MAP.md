# Call Centre Data Map

Investigation date: 2026-09-29. The user approved linked legacy ticket status updates and conservative human review where trustworthy source evidence is missing. Implementation now follows those decisions.

## Scope and Safety

The full application inspected is `C:/Users/DELL/Desktop/ENGAGEMENT/superAdminDashboard`, not the incomplete checkout at `C:/Users/DELL/Desktop/superAdminDashboard`.

Database discovery used read-only transactions, bounded statement timeouts, schema queries, aggregate counts and selected JSON structure inspection. No source rows were changed, no legacy ticket generators were invoked, and no emails, calls or AI requests were sent during this investigation. Credentials and personal row values are excluded from this document.

Existing Zoom integration changes predate this investigation and are preserved. See `backend/CALL_CENTRE.md` for the implemented module, configuration and remaining source limitations.

## Connections

| Alias | Observed purpose | Notes |
| --- | --- | --- |
| `default` | Main Neon dashboard database | Attendance, legacy tickets, bookings, coaches, Zoom tables. |
| `employer` | Same configured database and role as `default` | Not independent evidence. |
| `aptem` | Aptem extraction database | Authoritative learner/contact/PR/MCM/OTJ/EPA source for existing views. |
| `neon` | Same configured database and role as `aptem` | Not independent evidence. |
| `learner_evidence` | Not configured | Existing LMS summary returns an empty result without it; this must not mean a learner completed anything. |

Neither the `Learner` nor `curriculum` schema, nor `Audit.LMS_data`, was visible through these connections. Settings load backend `.env`; `,env` is not the configured dotenv file. Both filenames are now ignored by Git.

## Learner and Risk Sources

### Learner Profile

Source: `aptem.public.aptem_auto_extracting`.

- Identity: `ID`, `FullName`, `Email`, `row_number`.
- Contact: `Learner Phone`; coach: `OwnerName`, `OwnerEmail`, `OwnerPhone`, `case_owner_id`.
- Employer: `OrganizationName`, `ManagerName`, `ManagerEmail`, `Manager Phone`, `Employer Email`.
- Programme: `Program Name`, `Program-Status`, `Subscription Status`, `subprogramme`.
- OTJ: `Minimum`, `Planned`, `Submitted`, `Completed`, `Forecast`, `Exepected` (actual spelling), `ProgressVariance`, `Progress-Hours`, `OTJHoursStatus`.
- Dates: `Start-Date`, `End-Date`, `Gateway Review Date`.
- Preferred join: normalized exact `Email`; preserve `ID`. Never join by name alone.
- Observed: 699 rows, 699 populated learner phone fields, 678 populated manager emails, no duplicate nonblank normalized email groups. Populated phone fields still need validation and collision checks.
- OTJ values observed: `On Track`, `At Risk`, `Need Attention`.
- No update timestamp or dated OTJ/EPA status transition exists in this table.

The similarly named table in `default.public` has a different, less complete schema. It must not silently replace the Aptem source.

### Progress Reviews

`aptem.public.progress_review`: `ID`, `FullName`, `Email`, `Group`, `CaseOwner`, `case_owner_id`, `Status`, `programme`, `Last Progress Review`, `Last Actually Completed PR`, `Next Review (Status)`, `Review Planned Date1..16`, `Review Status1..16`, `Manager Name`, `Manager Email`.

Join by exact normalized email. Existing `progress_review_summary` in `api/views.py` counts past planned slots that are neither completed nor archived. Preserve its distinction between due, scheduled and next dates. A future planned date does not establish when a booking was created. No row update timestamp exists.

### MCM

`aptem.public."MCR"`: `ID`, `FullName`, `Email`, `Status`, `Subscription Status`, `CaseOwner`, `Last MCM`, `Next MCM`, `MCM1..22`, `Status1..22`, `Last Actually Completed  MCM` (two spaces), `Manager Name`, `Manager Email`.

Join by exact normalized email. Reuse the semantics of `mcr_summary` and existing overdue helpers. Planned slots are not actual completions. No row update timestamp exists.

### Lecture Attendance

`default.public.kbc_attendance`: `ID`, `FullName`, `Email`, `key`, `date`, `Attendance`, `module`, `activity`, `created_at`, `called`, `emailed`, `contact_updated_at`, `resolved`, `resolved_at`, `note`, `attendance_status`, `lecture_name`.

Observed: 17,317 rows, dates 2025-01-17 through 2026-09-25. Existing logic uses `Attendance`, not the alternate `attendance_status` column. Current generation checks the latest learner record in the selected week; missed-session deduplication uses email/module/date.

Use exact normalized email and explicit module/session identity. Import time alone is not proof of later attendance. Catch-up resolution needs an actual later attendance event for the correct module after the case opened. Date-only records require a conservative same-day policy.

### OTJ and EPA Rules

OTJ summary reads active Aptem learners. Legacy `frontend/src/pages/otj/TrackOTJPage.tsx` creates tickets for `At Risk`; it does not establish that all `Need Attention` learners should be ticketed. There is no backend `auto_create_otj_tickets` endpoint: creation is currently frontend-driven.

EPA uses active programme/subscription state, `End-Date` plus seven days, and explicit `enteredepa` programme status. Programme end date is not an EPA booking date. Current status cannot prove a transition happened after a new case opened.

## Existing Tickets

All are in `default.public`, modeled in `backend/api/models.py`:

| Table | Observed rows | Category-specific fields |
| --- | ---: | --- |
| `dashboard_attendance_ticket` | 987 | `attendance_date`, `attendance_module`, `evidence` |
| `dashboard_pr_ticket` | 251 | `last_progress_review`, `last_actually_completed_pr`, `last_pr_date`, `next_pr_date`, `overdue_count` |
| `dashboard_mcm_ticket` | 488 | `coach_name`, `next_mcm_date`, `last_mcm_date`, `mcm_status`, `mcm_history`, `overdue_count` |
| `dashboard_otj_ticket` | 285 | `otj_minimum`, `otj_completed`, `otj_expected`, `otj_status` |
| `dashboard_epa_ticket` | 47 | `coach_name`, `end_date`, `days_overdue` |

Common fields include `id`, unique `ticket_ref`, learner email/name/phone, organisation/programme, risk/status, assigned owner, action/notes, archive/escalation flags, creator and creation/update timestamps. Preserve existing evidence-file tables and histories.

Link new cases by `(source_type, source_id)` plus a unique stable `reason_key`. Do not invoke legacy auto-create endpoints as read adapters. Existing generic `agents`, `learners`, `tickets` and `ticket_history` tables belong to other functionality: use a `callcenter_` namespace for all new tables.

## Bookings and Tomorrow

### Dashboard Bookings

`default.public.dashboard_bookings`: `id`, `learner_email`, `learner_name`, `coach`, `session_type`, `booking_date`, `booking_time`, `notes`, `booking_url`, `created_at`.

Observed count: zero. Types include PR/MCM/Support. `created_at` can provide a dated new-booking event once populated; scheduled date alone cannot. Booking is not attendance proof.

### Coach JSON

`default.public.coaches_data`: `case_owner`, `case_owner_id`, `owner_phone`, `staff_id`, `students`, `learners_json`, `upcomming_sessions`, `booked_students_PR`, `booked_students_MCM`, `booked_students_StSupport`, `completed_sessions`, `cancelled_sessions`, `calendar_events`, `coach_booking_link`, `Upcoming_PR ` (trailing space), `Upcoming_MCM`, `Last Snapshot Date`.

Observed shapes:

- `upcomming_sessions`: object with `meetings`; sampled entries contain `customerName`, `date`, `id`, `joinWebUrl`, `serviceName`, `timeFrom`, `timeTo`, but no email. Name-only entries must remain unmatched.
- `booked_students_*`: object with `students`; entries include `appointmentId`, `customerEmail`, `customerName`, `customerPhone`, `dayDate`, `startDateTime`, `endDateTime`, `serviceName`, `serviceType`, `normalizedServiceName`, matched student/manager emails, staff identities and match metadata.
- A customer may be a manager. Fuzzy match metadata is not sufficient for evidence-based closure.
- `completed_sessions`: date-keyed aggregates with student-name lists, counts and durations, not explicit individual attendance proof.
- `students`: profile and aggregate progress arrays. `LMSProgress` is not per-recording completion evidence.

Use verified booking URLs or mirror `frontend/src/lib/bookingLinks.ts` into maintained backend configuration. Missing catch-up/recording links stay unavailable, never fabricated.

### Other Candidate Sources

- `aptem.public."Coaching_session"`: `id`, `Name`, `Email`, `Phone`, `Service`, `StaffMember`, `StartAt`, `CreatedAt`, `Meeting_ID`. Text dates need validation; service classification must be explicit.
- `aptem.public.sessions`: learner email, component/source, planned and Aptem completion dates/status, meeting ID/start time, explicit learner/manager attendance flags, transcripts and AI fields. Verify source semantics and exact activity identity before using attendance. AI summaries and match scores are not proof.
- `default.public.bookings_expanded`: customer email, booking/session identity, date, service, participant counts, durations, staff and transcripts. Counts do not prove a specific learner attended.
- `default.public.booking_review_summaries`: booking/learner identities, timestamps, status and generated summaries. Generated prose is not closure evidence.
- `default.public.support_session_requests`: requested dates/times, status, ticket ID, timestamps and metadata. A request is not necessarily a confirmed booking.

## Recording Links and LMS Evidence

Available in `default.public`:

- `lecture_sessions`: lecture ID, module, subject, scheduled/session dates, cancellation state, source identifiers and join URL.
- `lecture_recording_links`: lecture ID, recording URL, status/stage and written timestamp. Supplies a link, not viewing proof.
- `lecture_lms_snapshots` and `lecture_lms_snapshot_members`: captured membership, external learner identifiers and names. Membership is not consumption.
- Lecture engagement metrics/participants: live engagement, not necessarily offline viewing.

Read-only source inspection of the sibling LMS v2 project found potential consumption evidence, **not a verified live database connection**:

- `LMS_V2/LMS_v2/backend/learner_api/videos.py` records video progress with started/submitted times, component identity and claimed/verified seconds.
- `learner_api/models.py` defines `"Learner"."learner_progress_entries"`, with learner linkage, component/module identity, `started_at`, `submitted_at`, tracking-session reference and verified/claimed/server-session seconds.
- `curriculum_api/views.py` defines `live_session_recording_events`, with viewer and lecture/occurrence/artifact identity, timestamps, video position, watched-second deltas and skipped ranges.

These are candidate sources only. Access, precise identity joins, completion thresholds and trustworthy event semantics remain to be established. Opening a link, one play event, elapsed time or generic LMS last activity must not imply full viewing. Do not import LMS helpers that might create/alter tables during discovery.

## Zoom and Attribution

Reuse `ZoomPhoneCall`, `ZoomSyncState`, `ZoomPhoneRecording`, `api/zoom_phone.py`, `api/zoom_recordings.py` and their polling command. Migrations 0017/0018 and transcript UI already exist. Do not create a duplicate collector or require webhooks.

The previous live check found Student authentication/history/recording requests successful, with no records in the tested window. Office authenticated but its Phone endpoint returned Zoom error 2031: Zoom Phone not enabled for that account. This is a prior observation, not a fresh live check today; revalidate after account changes.

Liza/Alice mapping and Zoom user/email identity must be configurable and verified. Account labels alone are not employee attribution. Do not guess which agent uses Student/Office.

Match exact normalized E.164 numbers, agent identity, outbound direction and a bounded ten-minute intent window. Shared numbers, multiple intents or ambiguous identities require review. Existing ActivityReport `normalizePhone` produces a local UK form and loose lookups; it is insufficient for strict automatic matching.

Count answered Zoom durations only, expose missing duration as unknown, and document that provider duration may not be pure speaking time. Manual outcomes cannot create real Zoom call records. Recording/transcript availability depends on actual recording, Zoom account policies and licensing, not scopes alone.

## Gaps / Assumptions

1. **Approved: narrow legacy writeback.** Update the linked ticket status on resolution. Preserve its action, notes, evidence and all other source data. On reopening, restore the prior state only if the legacy state still equals the state written by Call Centre; otherwise retain the independent change and audit it.
2. **Approved: conservative missing-evidence handling.** No configured LMS consumption source exists; OTJ/EPA states lack transition timestamps. Disable automatic closure where trustworthy evidence is missing and require human review. Never close because a source is empty/unavailable or a current state was merely observed after case creation.
3. Office Phone availability requires confirmation/fixing. Scopes alone do not resolve the observed account error. Show per-account sync status; never fabricate production calls for testing.
4. PR/MCM future dates are not booking creation dates. Require a trustworthy new booking/completion event, exact learner/activity identity and evidence dated after case creation.
5. Missing manager contact details need a visible incomplete-contact state, not guessed recipients.
6. Retry wording mentions another day but caps attempts at three. Proposed interpretation: initial, after two hours, next working day; three total attempts, no fourth automatic attempt.
7. Preserve existing OTJ `At Risk` selection and the seven-day EPA grace period initially. Expanding OTJ to `Need Attention` requires an explicit rule.
8. New recording/transcript features should link existing Zoom records. New AI analysis history should not duplicate ingestion.
9. Treat transcripts as untrusted AI input; validated JSON and deterministic evidence checks, not confidence scores, govern closure.
10. Survey GET displays confirmation; POST consumes the signed single-use token, preventing email scanners from casting votes.
11. Email defaults to dry-run. Verify recipient configuration, delivery status and retry/idempotency handling before live sends.
12. Agent identities/targets, holidays, escalation recipients and AI settings remain configurable. Missing Zoom data is not proof of inactivity.

## Implementation Plan

1. **Models:** isolated `api/callcenter/` with additive `callcenter_` tables for agents, cases, append-only events, claims, call intents/linkage, evidence, email attempts, AI analyses and satisfaction surveys. Preserve every existing table and migration.
2. **Services:** bounded read adapters, idempotent reason keys, one priority function, strict call matching, atomic claims, UK working-day SLA calculation, retries, evidence-gated closure and audited reopening. Missing evidence fails closed.
3. **Endpoints:** authenticated queue/detail/filter, claim/release, dial intent, outcome, resolve/reopen/AI approval, tomorrow, SLA/history/satisfaction and agent metrics. Enforce CSRF and ownership on mutations. Only signed survey access is public.
4. **Commands:** bounded polling that reuses Zoom sync, generates cases, matches calls, expires claims, checks evidence/SLA and prepares reminders/surveys. Dry-run first; optional AI disabled without configuration.
5. **UI:** new Operations Call Centre route with six requested tabs and ticket drawer; third Activity Report tab for Agent performance. Preserve existing tabs, pages and ticket behavior.
6. **Verification:** isolated `config.test_settings` tests for generation, racing claims, matching, SLA, older/missing evidence, AI validation, dry-run emails and survey tokens; frontend build and browser checks. Document setup in `backend/CALL_CENTRE.md`. Production backfill, scheduling and live emails require a controlled rollout.

The investigation checkpoint is complete. An additive migration belongs to the new `callcenter` app; it does not alter external source tables. Runtime details and rollout verification are recorded in `backend/CALL_CENTRE.md`.
