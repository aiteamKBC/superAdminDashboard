import { useRef, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";

import AppLayout from "@/components/AppLayout";
import { mockEmailTemplates } from "@/data/mockData";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Mail, Send, Users, Edit, Eye, Clock } from "lucide-react";

import { fetchUiCoaches } from "@/lib/services/kbcDashboard";
import { renderTemplate, type EmailRecipient } from "@/lib/emailCenter";
import type { UiCoach } from "@/lib/adapters/kbcToUi";
import { getMissedLearnersFromCoaches } from "@/lib/dashboard/getMissedLearners";

const kpiLabels: Record<string, string> = {
  "missed-session": "Missed Session",
  "review-due": "Review Due",
  "coaching-due": "Coaching Due",
  "otj-behind": "OTJ Behind",
};

type EmailCentreLocationState = {
  selectedRecipient?: EmailRecipient;
  source?: string;
};

type AbsenceWeeksFilter = "all" | 0 | 1 | 2 | 3;

const absenceWindowLabels: Record<AbsenceWeeksFilter, string> = {
  all: "All",
  0: "This week",
  1: "Previous week",
  2: "2 weeks ago",
  3: "3 weeks ago",
};

export default function EmailCentre() {
  const location = useLocation();
  const locationState = (location.state || {}) as EmailCentreLocationState;
  const preselectedRecipient = locationState.selectedRecipient || null;

  const [selectedTemplate, setSelectedTemplate] = useState(mockEmailTemplates[0]);
  const [subject, setSubject] = useState(mockEmailTemplates[0].subject);
  const [body, setBody] = useState(mockEmailTemplates[0].body);
  const [copyLM, setCopyLM] = useState(false);
  const [copyHR, setCopyHR] = useState(false);

  const [coaches, setCoaches] = useState<UiCoach[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const [manualRecipients, setManualRecipients] = useState<EmailRecipient[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [absenceWeeks, setAbsenceWeeks] = useState<AbsenceWeeksFilter>(0);

  const subjectRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const data = await fetchUiCoaches();
        setCoaches(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Failed to load coaches", err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  useEffect(() => {
    if (!preselectedRecipient) return;

    setManualRecipients([preselectedRecipient]);

    const firstRisk = preselectedRecipient.riskCategories?.[0];
    if (!firstRisk) return;

    const matchedTemplate = mockEmailTemplates.find((t) => t.kpiCategory === firstRisk);
    if (!matchedTemplate) return;

    setSelectedTemplate(matchedTemplate);
    setSubject(matchedTemplate.subject);
    setBody(matchedTemplate.body);
  }, [preselectedRecipient]);

  useEffect(() => {
    if (isEditing) {
      subjectRef.current?.focus();
    }
  }, [isEditing]);

  useEffect(() => {
    setSelectedIds([]);
  }, [absenceWeeks, selectedTemplate.id, manualRecipients.length]);

  const allRecipients = useMemo(() => {
    return getMissedLearnersFromCoaches(coaches, absenceWeeks);
  }, [coaches, absenceWeeks]);

  const bulkRecipients = useMemo(() => {
    if (selectedTemplate.kpiCategory === "missed-session") {
      return allRecipients.filter((l: any) => {
        return (
          l.status !== "Inactive" &&
          l.lastSessionStatus === "Missed" &&
          Boolean(l.hasAttendanceInWindow)
        );
      });
    }

    return allRecipients.filter((l) => {
      return (
        l.status !== "Inactive" &&
        Array.isArray(l.riskCategories) &&
        l.riskCategories.includes(selectedTemplate.kpiCategory)
      );
    });
  }, [allRecipients, selectedTemplate]);

  const effectiveRecipients = manualRecipients.length > 0 ? manualRecipients : bulkRecipients;

  const finalRecipients =
    selectedIds.length > 0
      ? effectiveRecipients.filter((r) => selectedIds.includes(r.learnerEmail))
      : effectiveRecipients;

  const recipientCount = finalRecipients.length;

  const previewRecipient: EmailRecipient | null = effectiveRecipients[0] || null;

  const previewSubject = previewRecipient
    ? renderTemplate(subject, {
        ...previewRecipient,
        senderName: "Progress Coordinator",
      })
    : subject;

  const previewBody = previewRecipient
    ? renderTemplate(body, {
        ...previewRecipient,
        senderName: "Progress Coordinator",
      })
    : body;

  const handleTemplateChange = (template: (typeof mockEmailTemplates)[number]) => {
    setSelectedTemplate(template);
    setSubject(template.subject);
    setBody(template.body);
    setShowPreview(false);
  };

  const handleSendNow = async () => {
    if (!finalRecipients.length) return;

    const ok = window.confirm(
      `You are about to send ${finalRecipients.length} email${
        finalRecipients.length !== 1 ? "s" : ""
      }. Continue?`
    );
    if (!ok) return;

    try {
      setSending(true);

      const senderName = "Progress Coordinator";

      const renderedRecipients = finalRecipients.map((recipient) => {
        const mergedData = {
          ...recipient,
          senderName,
        };

        return {
          ...recipient,
          renderedSubject: renderTemplate(subject, mergedData),
          renderedBody: renderTemplate(body, mergedData),
        };
      });

      const res = await fetch("https://n8n.srv943390.hstgr.cloud/webhook/email_sender", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subject,
          body,
          copyLM,
          copyHR,
          senderName,
          kpiCategory: selectedTemplate.kpiCategory,
          recipients: renderedRecipients,
          preview: renderedRecipients[0]
            ? {
                subject: renderedRecipients[0].renderedSubject,
                body: renderedRecipients[0].renderedBody,
              }
            : null,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result?.detail || "Failed to send emails");
      }

      const sentCount = Number(result?.sentCount ?? 0);
      const failedCount = Number(result?.failedCount ?? 0);
      const responseBody = result?.preview?.body ?? "No preview body returned";

      alert(
        `Sent successfully: ${sentCount}, Failed: ${failedCount}\n\nResponse Body:\n\n${responseBody}`
      );
    } catch (err: any) {
      console.error(err);
      alert(err?.message || "Failed to send");
    } finally {
      setSending(false);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-6xl p-6">
        <h2 className="mb-1 text-xl font-semibold text-foreground">Email Centre</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          Send targeted emails to learners by risk category using pre-built templates.
        </p>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">Templates</p>

            {mockEmailTemplates.map((template) => (
              <Card
                key={template.id}
                className={`cursor-pointer p-4 transition-all ${
                  selectedTemplate.id === template.id ? "ring-2 ring-ring" : "hover:shadow-sm"
                }`}
                onClick={() => handleTemplateChange(template)}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{template.name}</p>
                    <Badge variant="outline" className="mt-1 text-[10px]">
                      {kpiLabels[template.kpiCategory]}
                    </Badge>
                  </div>
                  <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
              </Card>
            ))}
          </div>

          <div className="space-y-4 lg:col-span-2">
            {manualRecipients.length > 0 && (
              <Card className="border-primary/30 bg-primary/5 p-4">
                <p className="text-sm font-medium text-foreground">Selected learner</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {manualRecipients[0].learnerName}, {manualRecipients[0].learnerEmail}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This email will be sent to the selected learner only.
                </p>

                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => setManualRecipients([])}
                >
                  Clear selection and return to bulk mode
                </Button>
              </Card>
            )}

            <Card className="space-y-4 p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Edit className="h-4 w-4" />
                  <p className="text-sm font-medium text-foreground">Template</p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={isEditing ? "secondary" : "outline"}
                    onClick={() => setIsEditing((prev) => !prev)}
                  >
                    {isEditing ? "Done" : "Customize Template"}
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-muted-foreground"
                    onClick={() => setShowPreview(true)}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Preview
                  </Button>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Changes will apply to all selected learners.
              </p>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Subject</label>
                <Input
                  ref={subjectRef}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className={`mt-1 ${
                    !isEditing ? "cursor-not-allowed bg-muted opacity-70" : ""
                  }`}
                  disabled={!isEditing}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Body</label>
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={12}
                  className={`mt-1 font-mono text-xs ${
                    !isEditing ? "cursor-not-allowed bg-muted opacity-70" : ""
                  }`}
                  disabled={!isEditing}
                />
              </div>

              <div className="flex flex-wrap gap-1.5">
                <p className="mb-1 w-full text-xs text-muted-foreground">Available merge fields:</p>
                {selectedTemplate.mergeFields.map((field: string) => (
                  <Badge key={field} variant="secondary" className="text-[10px] font-mono">
                    {`{{${field}}}`}
                  </Badge>
                ))}
              </div>
            </Card>

            {showPreview && (
              <Card className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium">Email Preview</p>

                  <Button size="sm" variant="ghost" onClick={() => setShowPreview(false)}>
                    Close
                  </Button>
                </div>

                <iframe
                  className="h-64 w-full rounded-md border"
                  srcDoc={`
                    <html>
                      <body style="font-family: Arial; padding: 16px;">
                        <h3>${previewSubject}</h3>
                        <p style="white-space: pre-line;">${previewBody}</p>
                      </body>
                    </html>
                  `}
                />
              </Card>
            )}

            <Card className="space-y-4 p-5">
              <p className="text-sm font-medium text-foreground">Send Options</p>

              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold text-foreground">
                    {loading ? "..." : recipientCount}
                  </span>
                  <span className="text-muted-foreground">
                    recipients in "{kpiLabels[selectedTemplate.kpiCategory]}"
                  </span>
                </div>
              </div>

              {selectedTemplate.kpiCategory === "missed-session" && manualRecipients.length === 0 && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <span className="text-sm text-muted-foreground">Absence Window</span>
                  <select
                    value={absenceWeeks}
                    onChange={(e) => {
                      const value = e.target.value;
                      setAbsenceWeeks(value === "all" ? "all" : (Number(value) as AbsenceWeeksFilter));
                    }}
                    className="h-10 w-full rounded-xl border border-[#E4E4E4] bg-white px-3 text-sm text-[#4C4C4C] sm:w-auto"
                  >
                    <option value="all">{absenceWindowLabels.all}</option>
                    <option value={0}>{absenceWindowLabels[0]}</option>
                    <option value={1}>{absenceWindowLabels[1]}</option>
                    <option value={2}>{absenceWindowLabels[2]}</option>
                    <option value={3}>{absenceWindowLabels[3]}</option>
                  </select>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-sm font-medium">
                  Select Learners
                  <span className="ml-1 text-gray-500">"Multiple selection is available"</span>
                  <span className="ml-1">({selectedIds.length})</span>
                </p>

                <div className="rounded-md border p-2">
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                    {effectiveRecipients.map((recipient: any) => {
                      const selected = selectedIds.includes(recipient.learnerEmail);
                      const lastSessionDate = recipient.lastSessionDate
                        ? `, ${recipient.lastSessionDate}`
                        : "";

                      return (
                        <div
                          key={recipient.learnerEmail}
                          onClick={() => {
                            setSelectedIds((prev) =>
                              selected
                                ? prev.filter((id) => id !== recipient.learnerEmail)
                                : [...prev, recipient.learnerEmail]
                            );
                          }}
                          className={`cursor-pointer rounded px-2 py-1 text-sm ${
                            selected ? "bg-primary text-white" : "hover:bg-muted"
                          }`}
                        >
                          {recipient.learnerName}
                          {selectedTemplate.kpiCategory === "missed-session" ? lastSessionDate : ""}
                        </div>
                      );
                    })}

                    {effectiveRecipients.length === 0 && (
                      <div className="px-2 py-2 text-sm text-muted-foreground">
                        No learners found for this selection.
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedIds(effectiveRecipients.map((r) => r.learnerEmail))}
                    disabled={!effectiveRecipients.length}
                  >
                    Select All
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedIds([])}
                    disabled={!selectedIds.length}
                  >
                    Clear
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={copyLM} onCheckedChange={(v) => setCopyLM(!!v)} />
                  <span className="text-muted-foreground">Copy Line Manager</span>
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={copyHR} onCheckedChange={(v) => setCopyHR(!!v)} />
                  <span className="text-muted-foreground">Copy HR Manager</span>
                </label>
              </div>

              <div className="flex gap-3">
                <Button
                  className="gap-1.5"
                  onClick={handleSendNow}
                  disabled={sending || !recipientCount}
                >
                  <Send className="h-3.5 w-3.5" />
                  {sending ? "Sending..." : "Send Now"}
                </Button>

                <Button
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => {
                    alert("Schedule endpoint not connected yet");
                  }}
                >
                  <Clock className="h-3.5 w-3.5" />
                  Schedule
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                You are about to send to {recipientCount} learner
                {recipientCount !== 1 ? "s" : ""}.
              </p>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}