from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0004_attendanceevidencefile'),
    ]

    operations = [
        migrations.AddField(
            model_name='attendanceticket',
            name='action',
            field=models.CharField(
                blank=True,
                choices=[
                    ('called', 'Called'),
                    ('emailed', 'Emailed'),
                    ('sms', 'SMS Sent'),
                    ('meeting_scheduled', 'Meeting Scheduled'),
                    ('referred_support', 'Referred to Support'),
                    ('warning_issued', 'Warning Issued'),
                    ('no_action', 'No Action Required'),
                ],
                default='',
                max_length=30,
            ),
        ),
    ]
