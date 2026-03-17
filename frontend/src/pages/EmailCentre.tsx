import { useRef } from "react";
import { useEffect, useMemo, useState } from "react";
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
import { buildEmailRecipients, renderTemplate, type EmailRecipient } from "@/lib/emailCenter";
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

  const allRecipients = useMemo(() => {
    return getMissedLearnersFromCoaches(coaches);
  }, [coaches]);

  const bulkRecipients = useMemo(() => {
    return allRecipients.filter(
      (l) =>
        l.status !== "Inactive" &&
        Array.isArray(l.riskCategories) &&
        l.riskCategories.includes(selectedTemplate.kpiCategory)
    );
  }, [allRecipients, selectedTemplate]);

  const effectiveRecipients = manualRecipients.length > 0
    ? manualRecipients
    : bulkRecipients;

  const finalRecipients =
    selectedIds.length > 0
      ? effectiveRecipients.filter((r) =>
        selectedIds.includes(r.learnerEmail)
      )
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

  const handleSendNow = async () => {
    if (!finalRecipients.length) return;

    const ok = window.confirm(
      `You are about to send ${finalRecipients.length} email${finalRecipients.length !== 1 ? "s" : ""}. Continue?`
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
      <div className="p-6 max-w-6xl">
        <h2 className="text-xl font-semibold text-foreground mb-1">Email Centre</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Send targeted emails to learners by risk category using pre-built templates.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">Templates</p>

            {mockEmailTemplates.map((t) => (
              <Card
                key={t.id}
                className={`p-4 cursor-pointer transition-all ${selectedTemplate.id === t.id ? "ring-2 ring-ring" : "hover:shadow-sm"
                  }`}
                onClick={() => {
                  setSelectedTemplate(t);
                  setSubject(t.subject);
                  setBody(t.body);
                }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{t.name}</p>
                    <Badge variant="outline" className="text-[10px] mt-1">
                      {kpiLabels[t.kpiCategory]}
                    </Badge>
                  </div>
                  <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                </div>
              </Card>
            ))}
          </div>

          <div className="lg:col-span-2 space-y-4">
            {manualRecipients.length > 0 && (
              <Card className="p-4 border-primary/30 bg-primary/5">
                <p className="text-sm font-medium text-foreground">Selected learner</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {manualRecipients[0].learnerName}, {manualRecipients[0].learnerEmail}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
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

            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Edit className="w-4 h-4" />
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
                    <Eye className="w-3.5 h-3.5" /> Preview
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
                  className={`mt-1 ${!isEditing ? "bg-muted cursor-not-allowed opacity-70" : ""
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
                  className={`mt-1 font-mono text-xs ${!isEditing ? "bg-muted cursor-not-allowed opacity-70" : ""
                    }`}
                  disabled={!isEditing}
                />
              </div>

              <div className="flex flex-wrap gap-1.5">
                <p className="text-xs text-muted-foreground w-full mb-1">Available merge fields:</p>
                {selectedTemplate.mergeFields.map((f: string) => (
                  <Badge key={f} variant="secondary" className="text-[10px] font-mono">
                    {`{{${f}}}`}
                  </Badge>
                ))}
              </div>
            </Card>

            {showPreview && (
              <Card className="p-4">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-sm font-medium">Email Preview</p>

                  <Button size="sm" variant="ghost" onClick={() => setShowPreview(false)}>
                    Close
                  </Button>
                </div>

                <iframe
                  className="w-full h-64 border rounded-md"
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

            <Card className="p-5 space-y-4">
              <p className="text-sm font-medium text-foreground">Send Options</p>

              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <span className="font-semibold text-foreground">
                    {loading ? "..." : recipientCount}
                  </span>
                  <span className="text-muted-foreground">
                    recipients in "{kpiLabels[selectedTemplate.kpiCategory]}"
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Select Learners<span className="text-gray-500">"Multiple selection is available"</span>  ({selectedIds.length})</p>

                <div className="border rounded-md p-2">
                  <div className="border rounded-md p-2 max-h-40 overflow-y-auto space-y-1">
                    {effectiveRecipients.map((r) => {
                      const selected = selectedIds.includes(r.learnerEmail);

                      return (
                        <div
                          key={r.learnerEmail}
                          onClick={() => {
                            setSelectedIds((prev) =>
                              selected
                                ? prev.filter((id) => id !== r.learnerEmail)
                                : [...prev, r.learnerEmail]
                            );
                          }}
                          className={`px-2 py-1 text-sm rounded cursor-pointer ${selected ? "bg-primary text-white" : "hover:bg-muted"
                            }`}
                        >
                          {r.learnerName}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setSelectedIds(effectiveRecipients.map((r) => r.learnerEmail))
                    }
                  >
                    Select All
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedIds([])}
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
                  <Send className="w-3.5 h-3.5" />
                  {sending ? "Sending..." : "Send Now"}
                </Button>

                <Button
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => {
                    alert("Schedule endpoint not connected yet");
                  }}
                >
                  <Clock className="w-3.5 h-3.5" /> Schedule
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                You are about to send to {recipientCount} learner{recipientCount !== 1 ? "s" : ""}.
              </p>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}