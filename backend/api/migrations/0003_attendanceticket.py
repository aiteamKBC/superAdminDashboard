from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0002_dashboardcontactlog'),
    ]

    operations = [
        migrations.CreateModel(
            name='AttendanceTicket',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('ticket_ref', models.CharField(max_length=20, unique=True)),
                ('learner_email', models.CharField(db_index=True, max_length=255)),
                ('learner_name', models.CharField(max_length=255)),
                ('learner_phone', models.CharField(blank=True, default='', max_length=50)),
                ('organisation', models.CharField(blank=True, default='', max_length=255)),
                ('programme', models.CharField(blank=True, default='', max_length=255)),
                ('attendance_date', models.DateField(blank=True, null=True)),
                ('attendance_module', models.CharField(blank=True, default='', max_length=500)),
                ('risk', models.CharField(choices=[('red', 'Red'), ('amber', 'Amber'), ('green', 'Green')], default='green', max_length=10)),
                ('status', models.CharField(choices=[('new', 'New'), ('open', 'Open'), ('under_review', 'Under Review'), ('follow_up_scheduled', 'Follow-up Scheduled'), ('support_plan_active', 'Support Plan Active'), ('resolved', 'Resolved')], default='new', max_length=30)),
                ('assigned_owner', models.CharField(blank=True, default='', max_length=255)),
                ('notes', models.TextField(blank=True, default='')),
                ('evidence', models.TextField(blank=True, default='')),
                ('is_archived', models.BooleanField(default=False)),
                ('escalated', models.BooleanField(default=False)),
                ('created_by', models.CharField(default='System', max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'dashboard_attendance_ticket',
                'ordering': ['-created_at'],
            },
        ),
    ]
