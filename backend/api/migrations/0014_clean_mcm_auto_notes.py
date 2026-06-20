from django.db import migrations

AUTO_NOTE_MARKER = "Auto-created for overdue Monthly Coaching Meeting follow-up."


def clean_mcm_auto_notes(apps, schema_editor):
    MCMTicket = apps.get_model("api", "MCMTicket")
    to_update = []
    for ticket in MCMTicket.objects.exclude(notes=""):
        notes = ticket.notes or ""
        if not notes.startswith(AUTO_NOTE_MARKER):
            continue
        # Keep only lines the user added (user notes start with "[")
        user_lines = [
            line for line in notes.splitlines()
            if line.strip().startswith("[")
        ]
        ticket.notes = "\n".join(user_lines)
        to_update.append(ticket)
    if to_update:
        MCMTicket.objects.bulk_update(to_update, ["notes"])


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0013_epa_ticket_evidence"),
    ]

    operations = [
        migrations.RunPython(clean_mcm_auto_notes, migrations.RunPython.noop),
    ]
