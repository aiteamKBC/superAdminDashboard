from django.urls import path
from .views import test_kbc_attendance, learner_contact_actions

urlpatterns = [
    path("test-kbc-attendance", test_kbc_attendance),
    path("learner-contact-actions", learner_contact_actions),
]