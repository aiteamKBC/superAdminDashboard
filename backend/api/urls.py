from django.urls import path
from .views import (
    test_kbc_attendance,
    learner_contact_actions,
    progress_review_summary,
    booking_review_employer_summary,
    employer_tables_debug,
)

urlpatterns = [
    path("test-kbc-attendance/", test_kbc_attendance),
    path("learner-contact-actions/", learner_contact_actions),
    path("progress-review-summary/", progress_review_summary, name="progress-review-summary"),
    path("booking-review-employer-summary/", booking_review_employer_summary, name="booking-review-employer-summary"),
    path("employer-tables-debug/", employer_tables_debug),
]