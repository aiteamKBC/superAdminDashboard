import django.db.models.deletion
from django.db import migrations, models
import api.models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0005_attendanceticket_action'),
    ]

    operations = [
        migrations.CreateModel(
            name='ProgressReviewTicket',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('ticket_ref', models.CharField(max_length=20, unique=True)),
                ('learner_email', models.CharField(db_index=True, max_length=255)),
                ('learner_name', models.CharField(max_length=255)),
                ('learner_phone', models.CharField(blank=True, default='', max_length=50)),
                ('organisation', models.CharField(blank=True, default='', max_length=255)),
                ('programme', models.CharField(blank=True, default='', max_length=255)),
                ('last_pr_date', models.DateField(blank=True, null=True)),
                ('next_pr_date', models.DateField(blank=True, null=True)),
                ('overdue_count', models.IntegerField(default=0)),
                ('risk', models.CharField(
                    choices=[('red', 'Red'), ('amber', 'Amber'), ('green', 'Green')],
                    default='green', max_length=10,
                )),
                ('status', models.CharField(
                    choices=[
                        ('new', 'New'), ('open', 'Open'),
                        ('pr_scheduled', 'PR Scheduled'), ('pr_completed', 'PR Completed'),
                        ('support_plan_active', 'Support Plan Active'), ('resolved', 'Resolved'),
                    ],
                    default='new', max_length=30,
                )),
                ('assigned_owner', models.CharField(blank=True, default='', max_length=255)),
                ('action', models.CharField(
                    blank=True,
                    choices=[
                        ('called', 'Called'), ('emailed', 'Emailed'),
                        ('pr_booked', 'PR Booked'), ('pr_done', 'PR Completed'),
                        ('referred_support', 'Referred to Support'),
                        ('no_action', 'No Action Required'),
                    ],
                    default='', max_length=30,
                )),
                ('notes', models.TextField(blank=True, default='')),
                ('is_archived', models.BooleanField(default=False)),
                ('escalated', models.BooleanField(default=False)),
                ('created_by', models.CharField(default='System', max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={'db_table': 'dashboard_pr_ticket', 'ordering': ['-created_at']},
        ),
        migrations.CreateModel(
            name='PRTicketEvidenceFile',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('file', models.FileField(upload_to=api.models.pr_evidence_upload_path)),
                ('original_name', models.CharField(max_length=255)),
                ('mime_type', models.CharField(blank=True, default='', max_length=100)),
                ('uploaded_at', models.DateTimeField(auto_now_add=True)),
                ('ticket', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='evidence_files',
                    to='api.progressreviewticket',
                )),
            ],
            options={'db_table': 'dashboard_pr_evidence', 'ordering': ['uploaded_at']},
        ),
    ]
