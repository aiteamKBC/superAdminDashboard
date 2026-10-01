from django.contrib import admin

from .models import Agent, AIAnalysis, CaseTicket, EmailDelivery, EmployerSatisfaction, TicketEvent


class RetainedAdmin(admin.ModelAdmin):
    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Agent)
class AgentAdmin(RetainedAdmin):
    list_display = ('display_name', 'user', 'zoom_account', 'zoom_email', 'zoom_phone_number', 'active', 'daily_talk_target_minutes')
    list_filter = ('active', 'zoom_account')
    search_fields = ('display_name', 'zoom_email', 'user__username')


class AuditAdmin(RetainedAdmin):
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


for model in (CaseTicket, TicketEvent, EmailDelivery, EmployerSatisfaction, AIAnalysis):
    admin.site.register(model, AuditAdmin)
