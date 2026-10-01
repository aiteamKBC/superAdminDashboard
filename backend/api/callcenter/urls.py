from django.urls import path
from . import views

urlpatterns = [
    path('config/', views.config),
    path('queue/', views.queue),
    path('tickets/<int:pk>/', views.detail),
    path('tickets/<int:pk>/<str:command>/', views.action),
    path('performance/', views.agent_report),
    path('satisfaction/', views.satisfaction_report),
    path('survey/<str:token>/', views.survey),
]
