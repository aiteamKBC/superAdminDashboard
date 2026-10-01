import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import models
from django.db.models.functions import Lower


class RetainedQuerySet(models.QuerySet):
    def delete(self):
        raise ValidationError('Call Centre records are retained. Archive instead.')


class Retained(models.Model):
    objects = RetainedQuerySet.as_manager()

    class Meta:
        abstract = True

    def delete(self, *args, **kwargs):
        raise ValidationError('Call Centre records are retained. Archive instead.')


class Agent(Retained):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    display_name = models.CharField(max_length=120)
    zoom_email = models.EmailField()
    zoom_user_id = models.CharField(max_length=128, blank=True)
    zoom_phone_number = models.CharField(max_length=16, blank=True, validators=[
        RegexValidator(r'^\+[1-9][0-9]{6,14}$', 'Use the assigned Zoom number in E.164 format.'),
    ])
    zoom_account = models.CharField(max_length=16, choices=[('student', 'Student'), ('office', 'Accountant')])
    daily_talk_target_minutes = models.PositiveIntegerField(default=180)
    active = models.BooleanField(default=True)

    class Meta:
        db_table = 'callcenter_agent'
        constraints = [
            models.UniqueConstraint(Lower('zoom_email'), 'zoom_account', name='cc_agent_email_account'),
            models.UniqueConstraint(fields=['zoom_user_id', 'zoom_account'], condition=~models.Q(zoom_user_id=''),
                                    name='cc_agent_user_account'),
        ]

    def save(self, *args, **kwargs):
        self.zoom_email = self.zoom_email.strip().lower()
        self.zoom_user_id = self.zoom_user_id.strip()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.display_name


class CaseTicket(Retained):
    CATEGORIES = [(s, s.upper() if s in ('pr', 'mcm', 'otj', 'epa') else s.title())
                  for s in ('attendance', 'pr', 'mcm', 'otj', 'epa', 'reminder', 'satisfaction')]
    STATES = [(s, s.replace('_', ' ').title()) for s in (
        'new', 'in_progress', 'pending_learner', 'pending_verification', 'ai_suggested_close',
        'resolved', 'unreachable', 'escalated',
    )]
    source_type = models.CharField(max_length=20, choices=CATEGORIES, db_index=True)
    source_id = models.BigIntegerField(null=True, blank=True)
    reason_key = models.CharField(max_length=500, unique=True)
    learner_email = models.EmailField(db_index=True)
    learner_name = models.CharField(max_length=255)
    learner_phone = models.CharField(max_length=32, blank=True, db_index=True)
    coach = models.CharField(max_length=255, blank=True)
    organisation = models.CharField(max_length=255, blank=True)
    programme = models.CharField(max_length=255, blank=True)
    manager_name = models.CharField(max_length=255, blank=True)
    manager_email = models.EmailField(blank=True)
    source_data = models.JSONField(default=dict)
    risk = models.CharField(max_length=10, default='amber')
    overdue_since = models.DateField(null=True, blank=True)
    misses = models.PositiveIntegerField(default=0)
    booking_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=30, choices=STATES, default='new', db_index=True)
    claimed_by = models.ForeignKey(Agent, null=True, blank=True, on_delete=models.PROTECT, related_name='claims')
    claimed_at = models.DateTimeField(null=True, blank=True)
    last_activity_at = models.DateTimeField(null=True, blank=True)
    last_actor = models.CharField(max_length=255, default='System')
    last_action_at = models.DateTimeField(auto_now_add=True)
    attempts = models.PositiveIntegerField(default=0)
    last_contact_at = models.DateTimeField(null=True, blank=True)
    next_followup_at = models.DateTimeField(null=True, blank=True, db_index=True)
    promised_at = models.DateTimeField(null=True, blank=True)
    evidence_after = models.DateTimeField(null=True, blank=True)
    resolution_option = models.CharField(max_length=40, blank=True)
    resolved_by = models.CharField(max_length=16, blank=True)
    resolved_agent = models.ForeignKey(Agent, null=True, blank=True, on_delete=models.PROTECT, related_name='resolutions')
    resolved_at = models.DateTimeField(null=True, blank=True)
    due_at = models.DateTimeField(db_index=True)
    sla_breached = models.BooleanField(default=False)
    escalated = models.BooleanField(default=False)
    ai_summary = models.TextField(blank=True)
    ai_confidence = models.FloatField(null=True, blank=True)
    archived = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'callcenter_case'
        constraints = [models.UniqueConstraint(fields=['source_type', 'source_id'],
                       condition=models.Q(source_id__isnull=False), name='cc_source_ticket_unique')]
        indexes = [models.Index(fields=['status', 'due_at'], name='cc_status_due')]


class EventQuerySet(RetainedQuerySet):
    def update(self, **kwargs):
        raise ValidationError('Events are append-only.')

    def bulk_update(self, *args, **kwargs):
        raise ValidationError('Events are append-only.')


class TicketEvent(Retained):
    ticket = models.ForeignKey(CaseTicket, on_delete=models.PROTECT, related_name='events')
    kind = models.CharField(max_length=40, db_index=True)
    actor = models.CharField(max_length=255, default='System')
    agent = models.ForeignKey(Agent, null=True, blank=True, on_delete=models.PROTECT)
    call = models.ForeignKey('api.ZoomPhoneCall', null=True, blank=True, on_delete=models.PROTECT)
    data = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    objects = EventQuerySet.as_manager()

    class Meta:
        db_table = 'callcenter_event'
        ordering = ['created_at', 'id']

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError('Events are append-only.')
        super().save(*args, **kwargs)


class CallIntent(Retained):
    agent = models.ForeignKey(Agent, on_delete=models.PROTECT)
    tickets = models.ManyToManyField(CaseTicket, related_name='intents')
    learner_email = models.EmailField(db_index=True)
    number = models.CharField(max_length=32)
    created_at = models.DateTimeField(auto_now_add=True)
    matched_call = models.OneToOneField('api.ZoomPhoneCall', null=True, blank=True, on_delete=models.PROTECT)

    class Meta:
        db_table = 'callcenter_call_intent'


class CallMatch(Retained):
    call = models.OneToOneField('api.ZoomPhoneCall', on_delete=models.PROTECT)
    agent = models.ForeignKey(Agent, on_delete=models.PROTECT)
    learner_email = models.EmailField(db_index=True)
    manual = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'callcenter_call_match'


class CaseCall(Retained):
    ticket = models.ForeignKey(CaseTicket, on_delete=models.PROTECT, related_name='calls')
    match = models.ForeignKey(CallMatch, on_delete=models.PROTECT, related_name='cases')
    processed_result = models.CharField(max_length=32, blank=True)
    outcome = models.CharField(max_length=30, blank=True)
    outcome_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'callcenter_case_call'
        constraints = [models.UniqueConstraint(fields=['ticket', 'match'], name='cc_case_call_unique')]


class AIAnalysis(Retained):
    recording = models.ForeignKey('api.ZoomPhoneRecording', on_delete=models.PROTECT)
    transcript_hash = models.CharField(max_length=64)
    model = models.CharField(max_length=128)
    result = models.JSONField(default=dict)
    state = models.CharField(max_length=20, default='pending')
    error = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'callcenter_ai_analysis'
        constraints = [models.UniqueConstraint(fields=['recording', 'transcript_hash'], name='cc_ai_version_unique')]


class EmailDelivery(Retained):
    ticket = models.ForeignKey(CaseTicket, on_delete=models.PROTECT, related_name='emails')
    dedupe_key = models.CharField(max_length=200, unique=True)
    recipient = models.EmailField()
    kind = models.CharField(max_length=32)
    mode = models.CharField(max_length=10)
    status = models.CharField(max_length=20, default='pending')
    subject = models.CharField(max_length=255)
    html = models.TextField()
    text = models.TextField()
    cc = models.EmailField(blank=True)
    error = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'callcenter_email'


class EmailQuota(models.Model):
    recipient = models.EmailField()
    day = models.DateField()
    count = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = 'callcenter_email_quota'
        constraints = [models.UniqueConstraint(fields=['recipient', 'day'], name='cc_email_daily_quota')]


class EmployerSatisfaction(Retained):
    ticket = models.OneToOneField(CaseTicket, on_delete=models.PROTECT, related_name='survey')
    manager_email = models.EmailField()
    organisation = models.CharField(max_length=255, blank=True)
    quarter = models.CharField(max_length=7)
    nonce = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    issued_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    score = models.PositiveSmallIntegerField(null=True, blank=True)
    comment = models.TextField(blank=True)
    responded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'callcenter_satisfaction'
        constraints = [
            models.UniqueConstraint(fields=['manager_email', 'quarter'], name='cc_survey_quarter_unique'),
            models.CheckConstraint(condition=models.Q(score__isnull=True) | models.Q(score__gte=1, score__lte=5),
                                   name='cc_survey_score_range'),
        ]


class CycleState(models.Model):
    name = models.CharField(max_length=60, primary_key=True)
    locked_until = models.DateTimeField(null=True)
    token = models.CharField(max_length=36, blank=True)
    last_success_at = models.DateTimeField(null=True)
    details = models.JSONField(default=dict)

    class Meta:
        db_table = 'callcenter_cycle_state'
