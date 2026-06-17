from django.db import migrations, models


def clear_prefilled_ticket_owners(apps, schema_editor):
    ProgressReviewTicket = apps.get_model("api", "ProgressReviewTicket")
    ProgressReviewTicket.objects.exclude(assigned_owner="").update(assigned_owner="")


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0008_mcm_ticket_system"),
    ]

    operations = [
        migrations.AddField(
            model_name="progressreviewticket",
            name="last_progress_review",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="progressreviewticket",
            name="last_actually_completed_pr",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.RunPython(clear_prefilled_ticket_owners, migrations.RunPython.noop),
    ]
