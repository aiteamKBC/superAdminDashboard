from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name='DashboardBooking',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('learner_email', models.EmailField(db_index=True, max_length=254)),
                ('learner_name', models.CharField(max_length=255)),
                ('coach', models.CharField(max_length=255)),
                ('session_type', models.CharField(
                    choices=[('PR', 'Progress Review'), ('MCM', 'Monthly Coaching Meeting'), ('Support', 'Support Session')],
                    max_length=20,
                )),
                ('booking_date', models.DateField()),
                ('booking_time', models.TimeField()),
                ('notes', models.TextField(blank=True, default='')),
                ('booking_url', models.URLField(blank=True, default='', max_length=500)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'db_table': 'dashboard_bookings',
                'ordering': ['booking_date', 'booking_time'],
            },
        ),
    ]
