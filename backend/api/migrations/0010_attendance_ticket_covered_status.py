from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0009_pr_ticket_review_fields_and_owner_cleanup"),
    ]

    operations = [
        migrations.AlterField(
            model_name="attendanceticket",
            name="status",
            field=models.CharField(
                choices=[
                    ("new", "New"),
                    ("open", "Open"),
                    ("under_review", "Under Review"),
                    ("follow_up_scheduled", "Follow-up Scheduled"),
                    ("support_plan_active", "Support Plan Active"),
                    ("resolved", "Resolved"),
                    ("covered", "Covered"),
                ],
                default="new",
                max_length=30,
            ),
        ),
    ]
