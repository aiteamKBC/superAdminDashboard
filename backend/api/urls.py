from django.urls import path
from .views import test_kbc_attendance, learner_contact_actions, progress_review_summary, current_db_info

urlpatterns = [
    path("test-kbc-attendance", test_kbc_attendance),
    path("learner-contact-actions", learner_contact_actions),
    path("progress-review-summary/", progress_review_summary, name="progress-review-summary"),
    path("current-db-info/", current_db_info),
]