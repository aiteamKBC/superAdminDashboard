from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='DashboardContactLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('learner_email', models.EmailField(db_index=True, max_length=254)),
                ('learner_name', models.CharField(blank=True, default='', max_length=255)),
                ('coach', models.CharField(blank=True, default='', max_length=255)),
                ('action_type', models.CharField(choices=[('called', 'Called'), ('emailed', 'Emailed')], max_length=20)),
                ('outcome', models.CharField(blank=True, default='', max_length=255)),
                ('notes', models.TextField(blank=True, default='')),
                ('source', models.CharField(choices=[('pr-due', 'Progress Review Due'), ('mcm-due', 'MCM Due'), ('otj-behind', 'OTJ Behind'), ('attendance', 'Attendance')], max_length=20)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'db_table': 'dashboard_contact_log',
                'ordering': ['-created_at'],
            },
        ),
    ]
