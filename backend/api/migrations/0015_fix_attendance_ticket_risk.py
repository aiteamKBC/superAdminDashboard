from django.db import migrations
from django.db import connections, connection as default_conn


def _normalize(value):
    if value is True or value == 1:
        return 1
    if value is False or value == 0:
        return 0
    s = str(value or "").strip().lower()
    if s in {"1", "present", "attended", "yes", "true"}:
        return 1
    if s in {"0", "absent", "missed", "no", "false"}:
        return 0
    return None


def fix_attendance_ticket_risk(apps, schema_editor):
    AttendanceTicket = apps.get_model("api", "AttendanceTicket")

    # Only look at open (non-resolved/covered) tickets where risk is amber or green
    tickets = list(
        AttendanceTicket.objects.exclude(risk="red").filter(is_archived=False)
    )
    if not tickets:
        return

    # Build lookup: email → set of modules we need counts for
    email_module_pairs = {(t.learner_email, t.attendance_module) for t in tickets}
    emails = list({e for e, _ in email_module_pairs})

    if not emails:
        return

    placeholders = ",".join(["%s"] * len(emails))
    with default_conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT "Email", "module", "date", "Attendance"
            FROM public.kbc_attendance
            WHERE lower("Email") IN ({placeholders})
            """,
            emails,
        )
        # Deduplicate by (email, module, date)
        seen = {}
        for em, mod, dt, att in cur.fetchall():
            clean_email = str(em or "").strip().lower()
            clean_mod = str(mod or "").strip()
            key = (clean_email, clean_mod, str(dt))
            is_missed = _normalize(att) == 0
            seen[key] = seen.get(key, False) or is_missed

    missed_counts = {}
    for (em, mod, _dt), is_missed in seen.items():
        if is_missed:
            missed_counts[(em, mod)] = missed_counts.get((em, mod), 0) + 1

    to_update = []
    for ticket in tickets:
        key = (ticket.learner_email, ticket.attendance_module)
        count = missed_counts.get(key, 0)
        new_risk = "red" if count >= 3 else "amber"
        if ticket.risk != new_risk:
            ticket.risk = new_risk
            to_update.append(ticket)

    if to_update:
        AttendanceTicket.objects.bulk_update(to_update, ["risk"])
        print(f"  Updated risk for {len(to_update)} attendance ticket(s)")


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0014_clean_mcm_auto_notes"),
    ]

    operations = [
        migrations.RunPython(fix_attendance_ticket_risk, migrations.RunPython.noop),
    ]
