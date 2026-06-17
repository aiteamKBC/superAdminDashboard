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


class AttendanceTicket(models.Model):
    RISK_CHOICES = [('red', 'Red'), ('amber', 'Amber'), ('green', 'Green')]
    STATUS_CHOICES = [
        ('new', 'New'),
        ('open', 'Open'),
        ('under_review', 'Under Review'),
        ('follow_up_scheduled', 'Follow-up Scheduled'),
        ('support_plan_active', 'Support Plan Active'),
        ('resolved', 'Resolved'),
        ('covered', 'Covered'),
    ]
    ACTION_CHOICES = [
        ('called', 'Called'),
        ('emailed', 'Emailed'),
        ('sms', 'SMS Sent'),
        ('meeting_scheduled', 'Meeting Scheduled'),
        ('referred_support', 'Referred to Support'),
        ('warning_issued', 'Warning Issued'),
        ('no_action', 'No Action Required'),
    ]

    ticket_ref = models.CharField(max_length=20, unique=True)
    learner_email = models.CharField(max_length=255, db_index=True)
    learner_name = models.CharField(max_length=255)
    learner_phone = models.CharField(max_length=50, blank=True, default='')
    organisation = models.CharField(max_length=255, blank=True, default='')
    programme = models.CharField(max_length=255, blank=True, default='')
    attendance_date = models.DateField(null=True, blank=True)
    attendance_module = models.CharField(max_length=500, blank=True, default='')
    risk = models.CharField(max_length=10, choices=RISK_CHOICES, default='green')
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default='new')
    assigned_owner = models.CharField(max_length=255, blank=True, default='')
    action = models.CharField(max_length=30, choices=ACTION_CHOICES, blank=True, default='')
    notes = models.TextField(blank=True, default='')
    evidence = models.TextField(blank=True, default='')
    is_archived = models.BooleanField(default=False)
    escalated = models.BooleanField(default=False)
    created_by = models.CharField(max_length=255, default='System')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'dashboard_attendance_ticket'
        ordering = ['-created_at']


def evidence_upload_path(instance, filename):
    return f'evidence/ticket_{instance.ticket_id}/{filename}'


class AttendanceEvidenceFile(models.Model):
    ticket = models.ForeignKey(
        AttendanceTicket,
        on_delete=models.CASCADE,
        related_name='evidence_files',
    )
    file = models.FileField(upload_to=evidence_upload_path)
    original_name = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=100, blank=True, default='')
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'dashboard_attendance_evidence'
        ordering = ['uploaded_at']


class ProgressReviewTicket(models.Model):
    RISK_CHOICES = [('red', 'Red'), ('amber', 'Amber'), ('green', 'Green')]
    STATUS_CHOICES = [
        ('new', 'New'),
        ('open', 'Open'),
        ('pr_scheduled', 'PR Scheduled'),
        ('pr_completed', 'PR Completed'),
        ('support_plan_active', 'Support Plan Active'),
        ('resolved', 'Resolved'),
    ]
    ACTION_CHOICES = [
        ('called', 'Called'),
        ('emailed', 'Emailed'),
        ('pr_booked', 'PR Booked'),
        ('pr_done', 'PR Completed'),
        ('referred_support', 'Referred to Support'),
        ('no_action', 'No Action Required'),
    ]

    ticket_ref = models.CharField(max_length=20, unique=True)
    learner_email = models.CharField(max_length=255, db_index=True)
    learner_name = models.CharField(max_length=255)
    learner_phone = models.CharField(max_length=50, blank=True, default='')
    organisation = models.CharField(max_length=255, blank=True, default='')
    programme = models.CharField(max_length=255, blank=True, default='')
    last_progress_review = models.CharField(max_length=255, blank=True, default='')
    last_actually_completed_pr = models.CharField(max_length=255, blank=True, default='')
    last_pr_date = models.DateField(null=True, blank=True)
    next_pr_date = models.DateField(null=True, blank=True)
    overdue_count = models.IntegerField(default=0)
    risk = models.CharField(max_length=10, choices=RISK_CHOICES, default='green')
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default='new')
    assigned_owner = models.CharField(max_length=255, blank=True, default='')
    action = models.CharField(max_length=30, choices=ACTION_CHOICES, blank=True, default='')
    notes = models.TextField(blank=True, default='')
    is_archived = models.BooleanField(default=False)
    escalated = models.BooleanField(default=False)
    created_by = models.CharField(max_length=255, default='System')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'dashboard_pr_ticket'
        ordering = ['-created_at']


def pr_evidence_upload_path(instance, filename):
    return f'pr_evidence/ticket_{instance.ticket_id}/{filename}'


class PRTicketEvidenceFile(models.Model):
    ticket = models.ForeignKey(
        ProgressReviewTicket,
        on_delete=models.CASCADE,
        related_name='evidence_files',
    )
    file = models.FileField(upload_to=pr_evidence_upload_path)
    original_name = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=100, blank=True, default='')
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'dashboard_pr_evidence'
        ordering = ['uploaded_at']


class OTJTicket(models.Model):
    RISK_CHOICES = [('red', 'Red'), ('amber', 'Amber'), ('green', 'Green')]
    STATUS_CHOICES = [
        ('new', 'New'),
        ('open', 'Open'),
        ('hours_logged', 'Hours Logged'),
        ('support_plan_active', 'Support Plan Active'),
        ('resolved', 'Resolved'),
    ]
    ACTION_CHOICES = [
        ('called', 'Called'),
        ('emailed', 'Emailed'),
        ('hours_submitted', 'Hours Submitted'),
        ('extra_hours_planned', 'Extra Hours Planned'),
        ('referred_support', 'Referred to Support'),
        ('no_action', 'No Action Required'),
    ]

    ticket_ref = models.CharField(max_length=20, unique=True)
    learner_email = models.CharField(max_length=255, db_index=True)
    learner_name = models.CharField(max_length=255)
    learner_phone = models.CharField(max_length=50, blank=True, default='')
    organisation = models.CharField(max_length=255, blank=True, default='')
    programme = models.CharField(max_length=255, blank=True, default='')
    otj_minimum = models.FloatField(default=0)
    otj_completed = models.FloatField(default=0)
    otj_expected = models.FloatField(default=0)
    otj_status = models.CharField(max_length=100, blank=True, default='')
    risk = models.CharField(max_length=10, choices=RISK_CHOICES, default='amber')
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default='new')
    assigned_owner = models.CharField(max_length=255, blank=True, default='')
    action = models.CharField(max_length=30, choices=ACTION_CHOICES, blank=True, default='')
    notes = models.TextField(blank=True, default='')
    is_archived = models.BooleanField(default=False)
    escalated = models.BooleanField(default=False)
    created_by = models.CharField(max_length=255, default='System')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'dashboard_otj_ticket'
        ordering = ['-created_at']


def otj_evidence_upload_path(instance, filename):
    return f'otj_evidence/ticket_{instance.ticket_id}/{filename}'


class OTJTicketEvidenceFile(models.Model):
    ticket = models.ForeignKey(
        OTJTicket,
        on_delete=models.CASCADE,
        related_name='evidence_files',
    )
    file = models.FileField(upload_to=otj_evidence_upload_path)
    original_name = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=100, blank=True, default='')
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'dashboard_otj_evidence'
        ordering = ['uploaded_at']


class MCMTicket(models.Model):
    RISK_CHOICES = [('red', 'Red'), ('amber', 'Amber'), ('green', 'Green')]
    STATUS_CHOICES = [
        ('new', 'New'),
        ('open', 'Open'),
        ('session_booked', 'Session Booked'),
        ('session_completed', 'Session Completed'),
        ('resolved', 'Resolved'),
    ]
    ACTION_CHOICES = [
        ('called', 'Called'),
        ('emailed', 'Emailed'),
        ('session_booked', 'Session Booked'),
        ('referred_support', 'Referred to Support'),
        ('no_action', 'No Action Required'),
    ]

    ticket_ref    = models.CharField(max_length=20, unique=True)
    learner_email = models.CharField(max_length=255, db_index=True)
    learner_name  = models.CharField(max_length=255)
    learner_phone = models.CharField(max_length=50, blank=True, default='')
    organisation  = models.CharField(max_length=255, blank=True, default='')
    programme     = models.CharField(max_length=255, blank=True, default='')
    coach_name    = models.CharField(max_length=255, blank=True, default='')
    overdue_count = models.IntegerField(default=0)
    next_mcm_date = models.CharField(max_length=20, blank=True, default='')
    last_mcm_date = models.CharField(max_length=20, blank=True, default='')
    mcm_status    = models.CharField(max_length=100, blank=True, default='')
    mcm_history   = models.TextField(blank=True, default='')
    risk          = models.CharField(max_length=10, choices=RISK_CHOICES, default='amber')
    status        = models.CharField(max_length=30, choices=STATUS_CHOICES, default='new')
    assigned_owner = models.CharField(max_length=255, blank=True, default='')
    action        = models.CharField(max_length=30, choices=ACTION_CHOICES, blank=True, default='')
    notes         = models.TextField(blank=True, default='')
    is_archived   = models.BooleanField(default=False)
    escalated     = models.BooleanField(default=False)
    created_by    = models.CharField(max_length=255, default='System')
    created_at    = models.DateTimeField(auto_now_add=True)
    updated_at    = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'dashboard_mcm_ticket'
        ordering = ['-created_at']


def mcm_evidence_upload_path(instance, filename):
    return f'mcm_evidence/ticket_{instance.ticket_id}/{filename}'


class MCMTicketEvidenceFile(models.Model):
    ticket = models.ForeignKey(
        MCMTicket,
        on_delete=models.CASCADE,
        related_name='evidence_files',
    )
    file          = models.FileField(upload_to=mcm_evidence_upload_path)
    original_name = models.CharField(max_length=255)
    mime_type     = models.CharField(max_length=100, blank=True, default='')
    uploaded_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'dashboard_mcm_evidence'
        ordering = ['uploaded_at']


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
