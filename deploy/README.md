# Deploy: persistent Call Centre worker (Linux VPS + systemd)

One systemd service keeps the whole Call Centre pipeline running forever:
Zoom sync (incl. recordings/transcripts), case generation, evidence resolution,
call-to-intent matching, **AI analysis**, and email processing. It runs every
`--interval` seconds, survives reboots, and auto-restarts on crash. A database
lock makes overlapping runs and restarts safe, so you never get double work.

## Install

1. Copy the unit into place and edit the four marked lines for your server
   (deploy user, backend path, venv python path, `.env` path):

   ```sh
   sudo cp superAdminDashboard/deploy/callcentre-worker.service \
           /etc/systemd/system/callcentre-worker.service
   sudo nano /etc/systemd/system/callcentre-worker.service
   ```

   Find your venv python with `source venv/bin/activate && which python`.

2. Enable (start on boot) and start now:

   ```sh
   sudo systemctl daemon-reload
   sudo systemctl enable --now callcentre-worker
   ```

3. Confirm it is running and watch the loop:

   ```sh
   systemctl status callcentre-worker
   journalctl -u callcentre-worker -f
   ```

## Operate

```sh
sudo systemctl restart callcentre-worker   # after changing .env or deploying code
sudo systemctl stop callcentre-worker      # pause the pipeline
journalctl -u callcentre-worker --since "1 hour ago"
```

Each loop prints a JSON summary (cases created, calls matched, analyses,
emails). The AI runs on every loop and analyses up to 10 new transcripts per
cycle, so it keeps working through the backlog on its own.

## Requirements for AI to actually analyse

The AI only runs on transcripts that are (a) `ready`, (b) linked to an
unambiguous Call Centre call, and (c) on an open ticket. So make sure:

- `OPENAI_API_KEY` and `OPENAI_MODEL` are set in `backend/.env`.
- Both Zoom apps have the recording + transcript scopes (see `ZOOM_PHONE.md`),
  so recordings sync and transcripts reach `ready`.

## Emails stay safe until you flip them

`CALLCENTRE_EMAIL_MODE` defaults to `dry_run` (rendered and logged, never sent).
Set it to `live` in `.env` and restart the worker only when you are ready to
send real learner/employer emails.

## Interval

`--interval 300` (5 min) is a sensible default. Lower it for faster reaction,
raise it to cut API calls. Minimum enforced is 60 seconds.
