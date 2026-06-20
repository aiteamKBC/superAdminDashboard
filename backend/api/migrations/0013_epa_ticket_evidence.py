from django.db import migrations, models
import django.db.models.deletion
import api.models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0012_epa_ticket_system"),
    ]

    operations = [
        migrations.CreateModel(
            name="EPATicketEvidenceFile",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("file", models.FileField(upload_to=api.models.epa_evidence_upload_path)),
                ("original_name", models.CharField(max_length=255)),
                ("mime_type", models.CharField(blank=True, default="", max_length=100)),
                ("uploaded_at", models.DateTimeField(auto_now_add=True)),
                (
                    "ticket",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="evidence_files",
                        to="api.epaticket",
                    ),
                ),
            ],
            options={
                "db_table": "dashboard_epa_evidence",
                "ordering": ["uploaded_at"],
            },
        ),
    ]
