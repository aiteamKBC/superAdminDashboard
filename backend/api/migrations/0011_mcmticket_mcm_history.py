from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0010_attendance_ticket_covered_status"),
    ]

    operations = [
        migrations.AddField(
            model_name="mcmticket",
            name="mcm_history",
            field=models.TextField(blank=True, default=""),
        ),
    ]
