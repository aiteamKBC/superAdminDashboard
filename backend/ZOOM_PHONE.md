# Zoom Phone integration

The dashboard imports Zoom Phone call history directly into the primary Django
database (`DATABASE_URL`). n8n is not required for this integration.

Recording metadata and recording transcripts belong in the same primary database.
Test fixtures must remain in the isolated test database, never in Neon.

The workflow's `student` branch maps to **Student**, and its `accountant` branch
maps to **Office**. Calls retain their actual caller identity; no calls are assigned
to a coach based on a fixed `case_owner_id`.

## Credentials

Each account needs an activated **Server-to-Server OAuth** app with:

- Account ID, Client ID, and Client Secret.
- `phone:read:list_call_logs:admin` for call history.
- `phone:read:list_call_recordings:admin` for recording metadata.
- `phone:read:recording_transcript:admin` for recording transcripts.
- `phone:read:call_recording:admin` is useful for future audio download support;
  this importer does not download audio files.
- An eligible Zoom Phone account/license and permissions to read account call history.

Set the six `ZOOM_STUDENT_*` / `ZOOM_OFFICE_*` variables from `.env.zoom.example`
in `backend/.env` (not `backend/,env`), or in the backend host's environment.
Copy all three values from the same app's credentials page for each account;
replace historical workflow account IDs if they differ. n8n exports do not contain
the Client ID/Client Secret stored in n8n credentials. Do not put these in Vite
variables, the browser, Git, or the frontend public directory.

Check configuration without calling Zoom or writing data:

```sh
python manage.py sync_zoom_calls --check-config
```

## Database and initial import

```sh
python manage.py migrate
python manage.py sync_zoom_calls
```

The migrations add call, sync-state, and recording/transcript tables. Existing `coaches_data.calls` JSON remains
available in the Activity log tab; it is not mixed into the new call totals.
Imports initially cover the last 10 days. For older data, run an explicit import:

```sh
python manage.py sync_zoom_calls --from 2026-09-01 --to 2026-09-28
python manage.py sync_zoom_calls --account student
python manage.py sync_zoom_calls --calls-only
```

Backfills are split into 28-day API requests. Every page is fetched. Repeated runs
update the same `(zoom_account_id, history_id)` rather than appending duplicate
calls. A shared Zoom `call_id` is not used as a row identifier: it can describe
multiple history records. Records from different accounts remain separate.

## Automatic collection

Run one supervised worker alongside the Django web server:

```sh
python manage.py sync_zoom_calls --loop --interval 300
```

Alternatively schedule `python manage.py sync_zoom_calls` every five minutes with
cron or Windows Task Scheduler. Use the project's backend working directory and
Python environment. The worker must run on the deployed backend server for
production collection. Restart it after changing environment settings.

Each account has a database lease to prevent overlapping workers. A failed account
does not prevent the other account from syncing. Incremental sync overlaps the
last two days to pick up delayed or updated records; a date window is checkpointed
only after all its pages succeed. Zoom 429 and transient server failures get bounded
retries. Longer outages are retried by the scheduler.

Calls appear after Zoom makes the finished call history available and the next
scheduled sync succeeds. This is polling, not an instant webhook or live-call tracker.
The report refreshes stored results every minute while visible.

## Report API

Authenticated sessions can request:

```text
GET /api/zoom/calls/?from=2026-09-01&to=2026-09-28&account=all&direction=outbound&page=1&page_size=50
```

- `account`: `all`, `student`, or `office`.
- `direction`: `outbound` (default), `inbound`, or `all`.
- Dates are inclusive in `ZOOM_REPORT_TIME_ZONE` (default `Europe/London`).
- Maximum date range is 366 days; page size is 1 to 100.
- Response contains per-account totals and sync status, daily totals, and paginated calls.
- Accounts whose configuration is changed do not show the previous account's records.

`duration_seconds` is Zoom's reported call duration, not hours worked, meeting
attendance, or guaranteed talk-only time. Missing durations stay unknown, not zero
or an inferred `end_time - start_time`. The report shows their count.
`answered_duration_seconds` is also returned for answered-call reporting.
Each call's full duration is assigned to its start date. Cross-account totals sum
account histories; a call appearing in both accounts contributes to each account.

## Recording transcripts

By default the sync command imports `/phone/recordings` and downloads each
recording transcript through `/phone/recording_transcript/download/{recordingId}`.
Use `--calls-only` to operate before recording permissions are available.
Recording metadata uses `(zoom_account_id, recording_id)` as its unique key.
It is never counted as an additional call or added to call-hour totals.

The primary Neon database stores recording identity, caller/recipient, owner,
recording duration, transcript text, and the JSON timeline (including available
speaker IDs and timestamps). It does not store audio binaries, bearer tokens,
or signed download URLs. Audio archival is not implemented. The collector itself
does not send transcripts to an AI service. The optional Call Centre worker can
analyze linked call transcripts when its backend AI settings are explicitly
configured; see `CALL_CENTRE.md` for its evidence gates and setup.

Enable call recording and **Allow call recording transcription** in Zoom Phone,
subject to your recording/consent and data retention policies. Live captions
alone do not create a saved recording transcript. Zoom's transcript endpoint
documents Business/Enterprise and Zoom Phone license prerequisites; scopes alone
do not grant a product/license entitlement.

Recordings have an independent seven-day overlap/checkpoint. Pending transcripts
are retried after 30 minutes even outside that overlap; errors after an hour,
disabled/unavailable transcripts after a day. At most 200 transcripts are attempted
per sync. Ready transcripts are retained and not downloaded again. Their retention
in Neon is independent of Zoom's retention policy; configure your retention policy
before production use. Deletions in Zoom do not automatically delete Neon copies.
Recording/transcript failure does not roll back successfully imported call history.

Downloads are limited to 4 MB, require HTTPS on Zoom-owned hosts, reject untrusted
redirects, and never forward bearer tokens to signed redirect destinations. An
unrecognized download host fails closed rather than bypassing validation.

The report's transcript icon opens recording status, transcript text, and text
download. These read-only endpoints require an active authenticated dashboard user:

```text
GET /api/zoom/calls/{database_call_id}/recordings/
GET /api/zoom/recordings/{database_recording_id}/transcript/
```

Call linkage uses the same account plus a matching history ID or shared call ID.
Multiple recordings can belong to one call. Transferred-call histories may share
the same recordings; do not sum recording counts as call counts. The backend does
not infer a learner identity from a partial phone-number match.

## Validation

Run isolated tests without contacting Neon or Zoom:

```sh
python manage.py test api.test_zoom_phone api.test_zoom_recordings --settings=config.test_settings --noinput
```

References:
- https://developers.zoom.us/docs/api/phone/
- https://developers.zoom.us/docs/rooms/s2s-oauth/
