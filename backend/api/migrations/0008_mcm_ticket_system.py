from django.db import migrations, models
import django.db.models.deletion
import api.models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0007_otj_ticket_system'),
    ]

    operations = [
        migrations.CreateModel(
            name='MCMTicket',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('ticket_ref', models.CharField(max_length=20, unique=True)),
                ('learner_email', models.CharField(db_index=True, max_length=255)),
                ('learner_name', models.CharField(max_length=255)),
                ('learner_phone', models.CharField(blank=True, default='', max_length=50)),
                ('organisation', models.CharField(blank=True, default='', max_length=255)),
                ('programme', models.CharField(blank=True, default='', max_length=255)),
                ('coach_name', models.CharField(blank=True, default='', max_length=255)),
                ('overdue_count', models.IntegerField(default=0)),
                ('next_mcm_date', models.CharField(blank=True, default='', max_length=20)),
                ('last_mcm_date', models.CharField(blank=True, default='', max_length=20)),
                ('mcm_status', models.CharField(blank=True, default='', max_length=100)),
                ('risk', models.CharField(choices=[('red', 'Red'), ('amber', 'Amber'), ('green', 'Green')], default='amber', max_length=10)),
                ('status', models.CharField(choices=[('new', 'New'), ('open', 'Open'), ('session_booked', 'Session Booked'), ('session_completed', 'Session Completed'), ('resolved', 'Resolved')], default='new', max_length=30)),
                ('assigned_owner', models.CharField(blank=True, default='', max_length=255)),
                ('action', models.CharField(blank=True, choices=[('called', 'Called'), ('emailed', 'Emailed'), ('session_booked', 'Session Booked'), ('referred_support', 'Referred to Support'), ('no_action', 'No Action Required')], default='', max_length=30)),
                ('notes', models.TextField(blank=True, default='')),
                ('is_archived', models.BooleanField(default=False)),
                ('escalated', models.BooleanField(default=False)),
                ('created_by', models.CharField(default='System', max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={'db_table': 'dashboard_mcm_ticket', 'ordering': ['-created_at']},
        ),
        migrations.CreateModel(
            name='MCMTicketEvidenceFile',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('file', models.FileField(upload_to=api.models.mcm_evidence_upload_path)),
                ('original_name', models.CharField(max_length=255)),
                ('mime_type', models.CharField(blank=True, default='', max_length=100)),
                ('uploaded_at', models.DateTimeField(auto_now_add=True)),
                ('ticket', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='evidence_files', to='api.mcmticket')),
            ],
            options={'db_table': 'dashboard_mcm_evidence', 'ordering': ['uploaded_at']},
        ),
    ]
