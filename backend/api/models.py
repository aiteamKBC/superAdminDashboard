from django.db import models


class DashboardContactLog(models.Model):
    ACTION_TYPES = [
        ('called', 'Called'),
        ('emailed', 'Emailed'),
    ]
    SOURCE_TYPES = [
        ('pr-due', 'Progress Review Due'),
        ('mcm-due', 'MCM Due'),
        ('otj-behind', 'OTJ Behind'),
        ('attendance', 'Attendance'),
    ]

    learner_email = models.EmailField(db_index=True)
    learner_name = models.CharField(max_length=255, blank=True, default='')
    coach = models.CharField(max_length=255, blank=True, default='')
    action_type = models.CharField(max_length=20, choices=ACTION_TYPES)
    outcome = models.CharField(max_length=255, blank=True, default='')
    notes = models.TextField(blank=True, default='')
    source = models.CharField(max_length=20, choices=SOURCE_TYPES)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        db_table = 'dashboard_contact_log'


class DashboardBooking(models.Model):
    SESSION_TYPES = [
        ('PR', 'Progress Review'),
        ('MCM', 'Monthly Coaching Meeting'),
        ('Support', 'Support Session'),
    ]

    learner_email = models.EmailField(db_index=True)
    learner_name = models.CharField(max_length=255)
    coach = models.CharField(max_length=255)
    session_type = models.CharField(max_length=20, choices=SESSION_TYPES)
    booking_date = models.DateField()
    booking_time = models.TimeField()
    notes = models.TextField(blank=True, default='')
    booking_url = models.URLField(max_length=500, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['booking_date', 'booking_time']
        db_table = 'dashboard_bookings'
