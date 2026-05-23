from django.urls import path
from .views import (
    test_kbc_attendance,
    learner_contact_actions,
    progress_review_summary,
    progress_review_booked_summary,
    booking_review_employer_summary,
    employer_tables_debug,
    fetch_all_coaches_analytics,
    aptem_learners_summary,
    mcr_summary,
    require_marking_summary,
)

urlpatterns = [
    path("test-kbc-attendance/", test_kbc_attendance),
    path("learner-contact-actions/", learner_contact_actions),
    path("progress-review-summary/", progress_review_summary, name="progress-review-summary"),
    path("booking-review-employer-summary/", booking_review_employer_summary, name="booking-review-employer-summary"),
    path("employer-tables-debug/", employer_tables_debug),
    path("coaches/all", fetch_all_coaches_analytics, name="fetch-all-coaches-analytics"),
    path("progress-review-booked/", progress_review_booked_summary, name="progress-review-booked"),
    path("aptem-learners/", aptem_learners_summary, name="aptem-learners-summary"),
    path("mcr-summary/", mcr_summary, name="mcr-summary"),
    path("require-marking/", require_marking_summary, name="require-marking-summary"),
]