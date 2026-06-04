import { useRef, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";

import AppLayout from "@/components/AppLayout";
import { mockEmailTemplates } from "@/data/mockData";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { Mail, Send, Users, Edit, Eye, Clock } from "lucide-react";
import { toast } from "sonner";

import { fetchUiCoaches } from "@/lib/services/kbcDashboard";
import { renderTemplate, type EmailRecipient } from "@/lib/emailCenter";
import { buildBrandedEmailHtml } from "@/lib/emailDesign";
import type { UiCoach } from "@/lib/adapters/kbcToUi";
import { getMissedLearnersFromCoaches } from "@/lib/dashboard/getMissedLearners";
import { getBookingLinks } from "@/lib/bookingLinks";

const kpiLabels: Record<string, string> = {
  "missed-session": "Missed Session",
  "review-due": "Review Due",
  "coaching-due": "Coaching Required",
  "otj-behind": "OTJ Behind",
};

type EmailCentreLocationState = {
  selectedRecipient?: EmailRecipient;
  selectedRecipients?: EmailRecipient[];
  source?: string;
};

type AbsenceWeeksFilter = "all" | 0 | 1 | 2 | 3;
type EmailTimePeriod = "all" | "today" | "last7days" | "last30days" | "thisMonth" | "last12weeks";
type PrQuarterOffset = -2 | -1 | 0 | 1 | 2;
type PrRecipientStatusFilter = "all" | "needsBooking";
type McmMonthOffset = "all" | -3 | -2 | -1 | 0 | 1 | 2;

const absenceWindowLabels: Record<AbsenceWeeksFilter, string> = {
  all: "All",
  0: "This week",
  1: "Previous week",
  2: "2 weeks ago",
  3: "3 weeks ago",
};

const getTemplateBookingLink = (coachName: string, kpiCategory: string) => {
  const links = getBookingLinks(coachName);
  if (kpiCategory === "review-due") return links.pr || "";
  if (kpiCategory === "coaching-due") return links.mcm || "";
  return links.support || "";
};

const timePeriodLabels: Record<EmailTimePeriod, string> = {
  all: "All time",
  today: "Today",
  last7days: "Last 7 days",
  last30days: "Last 30 days",
  thisMonth: "This month",
  last12weeks: "Last 12 weeks",
};

const prRecipientStatusLabels: Record<PrRecipientStatusFilter, string> = {
  all: "All",
  needsBooking: "Needs booking only",
};

const getMcmMonthRange = (offset: Exclude<McmMonthOffset, "all">) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  start.setHours(0, 0, 0, 0);

  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  end.setHours(23, 59, 59, 999);

  const label = start.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });

  return { start, end, label };
};

const getMcmMonthLabel = (offset: McmMonthOffset) => {
  if (offset === "all") return "All months";
  const { label } = getMcmMonthRange(offset);
  if (offset === 0) return `This month - ${label}`;
  if (offset === -1) return `Last month - ${label}`;
  if (offset === 1) return `Next month - ${label}`;
  return label;
};

const formatDateLabel = (date: Date) =>
  date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const getMondayWeekRange = (weekIndex: 0 | 1 | 2 | 3) => {
  const today = new Date();
  const day = today.getDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  const start = new Date(today);
  start.setDate(today.getDate() - daysSinceMonday - weekIndex * 7);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
};

const getAbsenceWindowLabel = (value: AbsenceWeeksFilter) => {
  if (value === "all") return "All weeks";
  const { start, end } = getMondayWeekRange(value);
  return `${absenceWindowLabels[value]} (${formatDateLabel(start)} - ${formatDateLabel(end)})`;
};

const parseDateValue = (value: unknown): Date | null => {
  const raw = String(value || "").trim();
  if (!raw || raw === "N/A") return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const dt = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!Number.isNaN(dt.getTime())) {
      dt.setHours(0, 0, 0, 0);
      return dt;
    }
  }

  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) {
    const dt = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    if (!Number.isNaN(dt.getTime())) {
      dt.setHours(0, 0, 0, 0);
      return dt;
    }
  }

  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setHours(0, 0, 0, 0);
  return dt;
};

const getTimePeriodRange = (period: EmailTimePeriod): { start: Date; end: Date } | null => {
  if (period === "all") return null;

  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (period === "today") {
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }

  if (period === "last7days") {
    start.setDate(now.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }

  if (period === "last30days") {
    start.setDate(now.getDate() - 29);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }

  if (period === "thisMonth") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }

  start.setDate(now.getDate() - 7 * 12 + 1);
  start.setHours(0, 0, 0, 0);
  return { start, end };
};

const getPrQuarterRange = (offset: PrQuarterOffset) => {
  const now = new Date();
  const currentQ = Math.floor(now.getMonth() / 3);
  const targetQ = currentQ + offset;
  const yearShift = Math.floor(targetQ / 4);
  const normQ = ((targetQ % 4) + 4) % 4;
  const year = now.getFullYear() + yearShift;
  const startMonth = normQ * 3;
  const start = new Date(year, startMonth, 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(year, startMonth + 3, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end, label: `Q${normQ + 1} ${year}` };
};

const getPrQuarterLabel = (offset: PrQuarterOffset) => {
  const { label } = getPrQuarterRange(offset);
  return offset === 0 ? `Current - ${label}` : label;
};

const isDateInPeriod = (value: unknown, period: EmailTimePeriod) => {
  const range = getTimePeriodRange(period);
  if (!range) return true;

  const dt = parseDateValue(value);
  if (!dt) return false;
  return dt >= range.start && dt <= range.end;
};

const findDateInPeriod = (
  dates: Array<{ date?: string; completed?: boolean; isPast?: boolean; status?: string }> | undefined,
  period: EmailTimePeriod
) => {
  const candidates = (Array.isArray(dates) ? dates : [])
    .filter((d) => d?.date && !d.completed)
    .map((d) => String(d.date));

  if (period === "all") return candidates[0] || "";
  return candidates.find((date) => isDateInPeriod(date, period)) || "";
};

const findMcmDateInMonth = (
  dates: Array<{ date?: string; completed?: boolean; isPast?: boolean; status?: string }> | undefined,
  monthOffset: McmMonthOffset
) => {
  const mcmToday = new Date();
  mcmToday.setHours(0, 0, 0, 0);
  const isPastMonth = typeof monthOffset === "number" && monthOffset < 0;

  const candidates = (Array.isArray(dates) ? dates : []).filter((d) => {
    if (!d?.date) return false;

    if (monthOffset === "all") {
      return !d.completed;
    }

    const { start, end } = getMcmMonthRange(monthOffset);
    const dt = parseDateValue(d.date);
    if (!dt || dt < start || dt > end) return false;

    if (isPastMonth) return true;
    if (d.completed) return false;

    const statusLower = String(d.status || "").toLowerCase();
    const isScheduled = statusLower.includes("scheduled") && !statusLower.includes("not");
    if (dt > mcmToday && isScheduled) return false;

    return true;
  });

  return candidates.sort((a, b) => String(a.date).localeCompare(String(b.date)))[0]?.date || "";
};

const isUnbookedProgressReviewStatus = (value: unknown) => {
  const status = String(value || "").trim().toLowerCase();
  if (!status) return true;
  if (status.includes("not scheduled")) return true;
  if (status.includes("scheduled") && !status.includes("not")) return false;
  if (status.includes("completed")) return false;
  if (status.includes("awaiting signature")) return false;
  if (status.includes("in progress")) return false;
  return true;
};

const findPrDateInQuarter = (
  dates: Array<{ date?: string; completed?: boolean; status?: string }> | undefined,
  quarterOffset: PrQuarterOffset,
  statusFilter: PrRecipientStatusFilter
) => {
  const { start, end } = getPrQuarterRange(quarterOffset);
  const candidates = (Array.isArray(dates) ? dates : [])
    .filter((d) => {
      if (!d?.date || d.completed) return false;
      if (statusFilter === "needsBooking" && !isUnbookedProgressReviewStatus(d.status)) return false;
      const dt = parseDateValue(d.date);
      return Boolean(dt && dt >= start && dt <= end);
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return candidates[0]?.date || "";
};

export default function EmailCentre() {
  const location = useLocation();
  const locationState = (location.state || {}) as EmailCentreLocationState;
  const preselectedRecipient = locationState.selectedRecipient || null;
  const preselectedRecipients = locationState.selectedRecipients || null;

  const [selectedTemplate, setSelectedTemplate] = useState(mockEmailTemplates[0]);
  const [subject, setSubject] = useState(mockEmailTemplates[0].subject);
  const [body, setBody] = useState(mockEmailTemplates[0].body);


  const [coaches, setCoaches] = useState<UiCoach[]>([]);
  const [prRows, setPrRows] = useState<any[]>([]);
  const [mcrRows, setMcrRows] = useState<any[]>([]);
  const [otjRows, setOtjRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const [manualRecipients, setManualRecipients] = useState<EmailRecipient[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false);
  const [timePeriod, setTimePeriod] = useState<EmailTimePeriod>("last30days");
  const [absenceWeeks, setAbsenceWeeks] = useState<AbsenceWeeksFilter>(0);
  const [prQuarterOffset, setPrQuarterOffset] = useState<PrQuarterOffset>(0);
  const [prRecipientStatusFilter, setPrRecipientStatusFilter] = useState<PrRecipientStatusFilter>("all");
  const [mcmMonthOffset, setMcmMonthOffset] = useState<McmMonthOffset>(0);

  const subjectRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [coachData, prData, mcrData, otjData] = await Promise.all([
          fetchUiCoaches(),
          fetch("/api/progress-review-summary/").then((r) => r.json()),
          fetch("/api/mcr-summary/").then((r) => r.json()),
          fetch("/api/otj-at-risk/").then((r) => r.json()),
        ]);
        setCoaches(Array.isArray(coachData) ? coachData : []);
        setPrRows(Array.isArray(prData) ? prData : []);
        setMcrRows(Array.isArray(mcrData) ? mcrData : []);
        setOtjRows(Array.isArray(otjData) ? otjData : []);
      } catch (err) {
        console.error("Failed to load data", err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  useEffect(() => {
    if (preselectedRecipients && preselectedRecipients.length > 0) {
      setManualRecipients(preselectedRecipients);
      const firstRisk = preselectedRecipients[0].riskCategories?.[0];
      const matchedTemplate = firstRisk ? mockEmailTemplates.find((t) => t.kpiCategory === firstRisk) : null;
      if (matchedTemplate) {
        setSelectedTemplate(matchedTemplate);
        setSubject(matchedTemplate.subject);
        setBody(matchedTemplate.body);
      }
      return;
    }
    if (!preselectedRecipient) return;
    setManualRecipients([preselectedRecipient]);
    const firstRisk = preselectedRecipient.riskCategories?.[0];
    if (!firstRisk) return;
    const matchedTemplate = mockEmailTemplates.find((t) => t.kpiCategory === firstRisk);
    if (!matchedTemplate) return;
    setSelectedTemplate(matchedTemplate);
    setSubject(matchedTemplate.subject);
    setBody(matchedTemplate.body);
  }, [preselectedRecipient, preselectedRecipients]);

  useEffect(() => {
    if (isEditing) {
      subjectRef.current?.focus();
    }
  }, [isEditing]);

  useEffect(() => {
    setSelectedIds([]);
  }, [
    timePeriod,
    absenceWeeks,
    prQuarterOffset,
    prRecipientStatusFilter,
    mcmMonthOffset,
    selectedTemplate.id,
    manualRecipients.length,
  ]);

  const allRecipients = useMemo(() => {
    return getMissedLearnersFromCoaches(coaches, absenceWeeks);
  }, [coaches, absenceWeeks]);

  const coachEmailMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const coach of coaches) {
      const email = String((coach as any)?.raw?.OwnerEmail || "").trim().toLowerCase();
      if (coach.name && email) map.set(coach.name.toLowerCase(), email);
    }
    return map;
  }, [coaches]);

  // All learner emails known to the dashboard (from coach data)
  const dashboardLearnerEmails = useMemo(() => {
    const set = new Set<string>();
    const clean = (e: string) => String(e || "").replace(/[‪-‮]/g, "").trim().toLowerCase();
    for (const coach of coaches) {
      const raw = (coach as any)?.raw ?? {};
      // from attendance.learners
      const attLearners = Array.isArray(raw?.attendance?.learners) ? raw.attendance.learners : [];
      for (const l of attLearners) {
        const e = clean(l?.Email);
        if (e) set.add(e);
      }
      // from learners_json
      const ljLearners = Array.isArray(raw?.learners_json) ? raw.learners_json : [];
      for (const l of ljLearners) {
        const e = clean(l?.Email || l?.email);
        if (e) set.add(e);
      }
      // from students
      const students = Array.isArray(raw?.students) ? raw.students : [];
      for (const s of students) {
        const e = clean(s?.Email || s?.email || s?.matched_student_email);
        if (e) set.add(e);
      }
    }
    return set;
  }, [coaches]);

  const prReviewRecipients = useMemo<EmailRecipient[]>(() => {
    const seen = new Set<string>();
    return prRows
      .filter((r) => Boolean(findPrDateInQuarter(r.plannedDates, prQuarterOffset, prRecipientStatusFilter)))
      .map((r) => {
        const coachName = String(r.caseOwner || "").trim();
        const coachEmail = coachEmailMap.get(coachName.toLowerCase()) ?? "";
        const prLink = getBookingLinks(coachName).pr ?? "";
        const periodDate = findPrDateInQuarter(r.plannedDates, prQuarterOffset, prRecipientStatusFilter);
        return {
          learnerName: String(r.fullName || "").trim(),
          learnerEmail: String(r.email || "").trim().toLowerCase(),
          programme: String(r.group || "").trim(),
          coachName,
          coachEmail,
          dueDate: periodDate,
          periodDate,
          bookingLink: prLink,
          status: "Active",
          riskCategories: ["review-due"],
        };
      })
      .filter((r) => {
        if (!r.learnerEmail || seen.has(r.learnerEmail)) return false;
        if (dashboardLearnerEmails.size > 0 && !dashboardLearnerEmails.has(r.learnerEmail)) return false;
        seen.add(r.learnerEmail);
        return true;
      });
  }, [prRows, coachEmailMap, dashboardLearnerEmails, prQuarterOffset, prRecipientStatusFilter]);

  const mcrRecipients = useMemo<EmailRecipient[]>(() => {
    const seen = new Set<string>();
    return mcrRows
      .filter((r) => Number(r.overdueMcmCount ?? 0) > 0)
      .filter((r) => mcmMonthOffset === "all" || Boolean(findMcmDateInMonth(r.mcmDates, mcmMonthOffset)))
      .map((r) => {
        const coachName = String(r.caseOwner || "").trim();
        const coachEmail = coachEmailMap.get(coachName.toLowerCase()) ?? "";
        const mcmLink = getBookingLinks(coachName).mcm ?? "";
        const periodDate = findMcmDateInMonth(r.mcmDates, mcmMonthOffset) || String(r.nextDueDate || r.nextMcm || "").trim();
        return {
          learnerName: String(r.fullName || "").trim(),
          learnerEmail: String(r.email || "").trim().toLowerCase(),
          programme: "",
          coachName,
          coachEmail,
          dueDate: periodDate,
          periodDate,
          bookingLink: mcmLink,
          status: "Active",
          riskCategories: ["coaching-due"],
        };
      })
      .filter((r) => {
        if (!r.learnerEmail || seen.has(r.learnerEmail)) return false;
        if (dashboardLearnerEmails.size > 0 && !dashboardLearnerEmails.has(r.learnerEmail)) return false;
        seen.add(r.learnerEmail);
        return true;
      });
  }, [mcrRows, coachEmailMap, dashboardLearnerEmails, mcmMonthOffset]);

  const otjRecipients = useMemo<EmailRecipient[]>(() => {
    const seen = new Set<string>();
    return otjRows
      .map((r) => {
        const rawVariance = Number(String(r.progressVariance ?? "0").replace(/[^0-9.-]/g, "") || "0");
        const behindPct = rawVariance < 0 ? Math.abs(rawVariance) : rawVariance;
        return {
          learnerName: String(r.fullName || "").trim(),
          learnerEmail: String(r.email || "").trim().toLowerCase(),
          programme: String(r.programName || "").trim(),
          coachName: String(r.ownerName || "").trim(),
          coachEmail: String(r.ownerEmail || "").trim().toLowerCase(),
          expectedHours: String(Math.round(r.otjPlanned ?? 0)),
          actualHours: String(Math.round(r.otjCompleted ?? 0)),
          behindPercent: String(Math.round(behindPct)),
          status: "Active",
          riskCategories: ["otj-behind"],
        };
      })
      .filter((r) => {
        if (!r.learnerEmail || seen.has(r.learnerEmail)) return false;
        if (dashboardLearnerEmails.size > 0 && !dashboardLearnerEmails.has(r.learnerEmail)) return false;
        seen.add(r.learnerEmail);
        return true;
      });
  }, [otjRows, dashboardLearnerEmails]);

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

    if (selectedTemplate.kpiCategory === "review-due") {
      return prReviewRecipients;
    }

    if (selectedTemplate.kpiCategory === "coaching-due") {
      return mcrRecipients;
    }

    if (selectedTemplate.kpiCategory === "otj-behind") {
      return otjRecipients;
    }

    return allRecipients.filter((l) => {
      return (
        l.status !== "Inactive" &&
        Array.isArray(l.riskCategories) &&
        l.riskCategories.includes(selectedTemplate.kpiCategory)
      );
    });
  }, [allRecipients, prReviewRecipients, mcrRecipients, otjRecipients, selectedTemplate]);

  const templateRecipientCounts = useMemo(() => {
    return {
      "missed-session": allRecipients.filter((l: any) => l.lastSessionStatus === "Missed").length,
      "review-due": prReviewRecipients.length,
      "coaching-due": mcrRecipients.length,
      "otj-behind": otjRecipients.length,
    } as Record<string, number>;
  }, [allRecipients, prReviewRecipients, mcrRecipients, otjRecipients]);

  const effectiveRecipients = manualRecipients.length > 0 ? manualRecipients : bulkRecipients;

  const finalRecipients =
    selectedIds.length > 0
      ? effectiveRecipients.filter((r) => selectedIds.includes(r.learnerEmail))
      : effectiveRecipients;

  const recipientCount = finalRecipients.length;

  const previewRecipient: EmailRecipient | null = effectiveRecipients[0] || null;
  const enrichRecipientForTemplate = (recipient: EmailRecipient) => ({
    ...recipient,
    bookingLink:
      recipient.bookingLink ||
      getTemplateBookingLink(recipient.coachName, selectedTemplate.kpiCategory),
  });

  const previewSubject = previewRecipient
    ? renderTemplate(subject, {
        ...enrichRecipientForTemplate(previewRecipient),
        senderName: "Progress Coordinator",
      })
    : subject;

  const previewBody = previewRecipient
    ? renderTemplate(body, {
        ...enrichRecipientForTemplate(previewRecipient),
        senderName: "Progress Coordinator",
      })
    : body;
  const previewHtml = previewRecipient
    ? buildBrandedEmailHtml({
        subject: previewSubject,
        body: previewBody,
        recipient: enrichRecipientForTemplate(previewRecipient),
        kpiCategory: selectedTemplate.kpiCategory,
      })
    : "";

  const handleTemplateChange = (template: (typeof mockEmailTemplates)[number]) => {
    setSelectedTemplate(template);
    setSubject(template.subject);
    setBody(template.body);
    setShowPreview(false);
  };

  const handleSendNow = async () => {
    if (!finalRecipients.length) return;

    try {
      setSending(true);

      const senderName = "Progress Coordinator";

      const renderedRecipients = finalRecipients.map((recipient) => {
        const enrichedRecipient = enrichRecipientForTemplate(recipient);
        const mergedData = {
          ...enrichedRecipient,
          senderName,
        };
        const renderedSubject = renderTemplate(subject, mergedData);
        const renderedTextBody = renderTemplate(body, mergedData);
        const renderedHtmlBody = buildBrandedEmailHtml({
          subject: renderedSubject,
          body: renderedTextBody,
          recipient: enrichedRecipient,
          kpiCategory: selectedTemplate.kpiCategory,
        });

        return {
          ...enrichedRecipient,
          renderedSubject,
          renderedTextBody,
          renderedHtmlBody,
          renderedBody: renderedHtmlBody,
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
          bodyFormat: "html",
          isHtml: true,
          senderName,
          kpiCategory: selectedTemplate.kpiCategory,
          recipients: renderedRecipients,
          preview: renderedRecipients[0]
            ? {
                subject: renderedRecipients[0].renderedSubject,
                body: renderedRecipients[0].renderedBody,
                textBody: renderedRecipients[0].renderedTextBody,
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

      toast.success("Emails sent successfully", {
        description:
          failedCount > 0
            ? `${sentCount} sent, ${failedCount} failed.`
            : `${sentCount} email${sentCount === 1 ? "" : "s"} sent.`,
      });
    } catch (err: any) {
      console.error(err);
      toast.error("Email sending failed", {
        description: err?.message || "Please try again or check the webhook.",
      });
    } finally {
      setSending(false);
      setSendConfirmOpen(false);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto p-4 sm:p-5 lg:p-6">
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
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px]">
                        {kpiLabels[template.kpiCategory]}
                      </Badge>
                      <Badge
                        className="border-0 bg-[#FCF3FF] text-[10px] text-[#644D93]"
                      >
                        {loading ? "..." : templateRecipientCounts[template.kpiCategory] ?? 0} learners
                      </Badge>
                    </div>
                  </div>
                  <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
              </Card>
            ))}
          </div>

          <div className="space-y-4 lg:col-span-2">
            {manualRecipients.length > 0 && (
              <Card className="border-primary/30 bg-primary/5 p-4">
                <p className="text-sm font-medium text-foreground">
                  {manualRecipients.length === 1 ? "Selected learner" : `${manualRecipients.length} learners selected`}
                </p>
                {manualRecipients.length === 1 ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {manualRecipients[0].learnerName}, {manualRecipients[0].learnerEmail}
                  </p>
                ) : (
                  <div className="mt-1 max-h-24 overflow-y-auto space-y-0.5">
                    {manualRecipients.map((r) => (
                      <p key={r.learnerEmail} className="text-xs text-muted-foreground">
                        {r.learnerName} — {r.learnerEmail}
                      </p>
                    ))}
                  </div>
                )}
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
                  className="h-[520px] w-full rounded-md border bg-white"
                  srcDoc={previewHtml}
                />
              </Card>
            )}

            <Card className="space-y-4 p-5">
              <p className="text-sm font-medium text-foreground">Send Options</p>

              {manualRecipients.length === 0 && (
                <div className="flex flex-col gap-2 rounded-xl border border-[#E7DAF4] bg-[#FCF8FF] p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-[#442F73]">
                      {selectedTemplate.kpiCategory === "missed-session"
                        ? "Attendance week"
                        : selectedTemplate.kpiCategory === "review-due"
                          ? "PR Quarter"
                          : selectedTemplate.kpiCategory === "coaching-due"
                            ? "MCM Month"
                            : "Time period"}
                    </p>
                    <p className="text-xs text-[#808080]">
                      {selectedTemplate.kpiCategory === "missed-session"
                        ? "Weeks start on Monday and end on Sunday."
                        : selectedTemplate.kpiCategory === "review-due"
                          ? "Matches the dashboard by quarter. Use Needs booking only for unscheduled PR follow-up."
                          : selectedTemplate.kpiCategory === "coaching-due"
                            ? "Shows Monthly Coaching Meeting dates in the selected calendar month."
                            : "Controls which learners appear for date-based templates."}
                    </p>
                  </div>

                  {selectedTemplate.kpiCategory === "missed-session" ? (
                    <select
                      value={absenceWeeks}
                      onChange={(e) => {
                        const value = e.target.value;
                        setAbsenceWeeks(value === "all" ? "all" : (Number(value) as AbsenceWeeksFilter));
                      }}
                      className="h-10 w-full rounded-xl border border-[#D8C9EE] bg-white px-3 text-sm text-[#4C4C4C] sm:w-[280px]"
                    >
                      <option value={0}>{getAbsenceWindowLabel(0)}</option>
                      <option value={1}>{getAbsenceWindowLabel(1)}</option>
                      <option value={2}>{getAbsenceWindowLabel(2)}</option>
                      <option value={3}>{getAbsenceWindowLabel(3)}</option>
                      <option value="all">{getAbsenceWindowLabel("all")}</option>
                    </select>
                  ) : selectedTemplate.kpiCategory === "review-due" ? (
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                      <select
                        value={prQuarterOffset}
                        onChange={(e) => setPrQuarterOffset(Number(e.target.value) as PrQuarterOffset)}
                        className="h-10 w-full rounded-xl border border-[#D8C9EE] bg-white px-3 text-sm text-[#4C4C4C] sm:w-[190px]"
                      >
                        <option value={-2}>{getPrQuarterLabel(-2)}</option>
                        <option value={-1}>{getPrQuarterLabel(-1)}</option>
                        <option value={0}>{getPrQuarterLabel(0)}</option>
                        <option value={1}>{getPrQuarterLabel(1)}</option>
                        <option value={2}>{getPrQuarterLabel(2)}</option>
                      </select>
                      <select
                        value={prRecipientStatusFilter}
                        onChange={(e) => setPrRecipientStatusFilter(e.target.value as PrRecipientStatusFilter)}
                        className="h-10 w-full rounded-xl border border-[#D8C9EE] bg-white px-3 text-sm text-[#4C4C4C] sm:w-[170px]"
                      >
                        <option value="all">{prRecipientStatusLabels.all}</option>
                        <option value="needsBooking">{prRecipientStatusLabels.needsBooking}</option>
                      </select>
                    </div>
                  ) : selectedTemplate.kpiCategory === "coaching-due" ? (
                    <select
                      value={mcmMonthOffset}
                      onChange={(e) => {
                        const value = e.target.value;
                        setMcmMonthOffset(value === "all" ? "all" : (Number(value) as McmMonthOffset));
                      }}
                      className="h-10 w-full rounded-xl border border-[#D8C9EE] bg-white px-3 text-sm text-[#4C4C4C] sm:w-[240px]"
                    >
                      <option value={0}>{getMcmMonthLabel(0)}</option>
                      <option value={-1}>{getMcmMonthLabel(-1)}</option>
                      <option value={-2}>{getMcmMonthLabel(-2)}</option>
                      <option value={-3}>{getMcmMonthLabel(-3)}</option>
                      <option value={1}>{getMcmMonthLabel(1)}</option>
                      <option value={2}>{getMcmMonthLabel(2)}</option>
                      <option value="all">{getMcmMonthLabel("all")}</option>
                    </select>
                  ) : (
                    <select
                      value={timePeriod}
                      onChange={(e) => setTimePeriod(e.target.value as EmailTimePeriod)}
                      className="h-10 w-full rounded-xl border border-[#D8C9EE] bg-white px-3 text-sm text-[#4C4C4C] sm:w-[180px]"
                    >
                      <option value="all">{timePeriodLabels.all}</option>
                      <option value="today">{timePeriodLabels.today}</option>
                      <option value="last7days">{timePeriodLabels.last7days}</option>
                      <option value="last30days">{timePeriodLabels.last30days}</option>
                      <option value="thisMonth">{timePeriodLabels.thisMonth}</option>
                      <option value="last12weeks">{timePeriodLabels.last12weeks}</option>
                    </select>
                  )}
                </div>
              )}

              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold text-foreground">
                    {loading ? "..." : recipientCount}
                  </span>
                  <span className="text-muted-foreground">
                    recipients in "{kpiLabels[selectedTemplate.kpiCategory]}"
                    {manualRecipients.length === 0 && selectedTemplate.kpiCategory === "missed-session"
                      ? ` for ${getAbsenceWindowLabel(absenceWeeks)}`
                      : ""}
                    {manualRecipients.length === 0 && selectedTemplate.kpiCategory === "review-due"
                      ? ` for ${getPrQuarterLabel(prQuarterOffset)} (${prRecipientStatusLabels[prRecipientStatusFilter]})`
                      : ""}
                    {manualRecipients.length === 0 && selectedTemplate.kpiCategory === "coaching-due"
                      ? ` for ${getMcmMonthLabel(mcmMonthOffset)}`
                      : ""}
                    {manualRecipients.length === 0 && selectedTemplate.kpiCategory !== "missed-session" && selectedTemplate.kpiCategory !== "review-due" && selectedTemplate.kpiCategory !== "coaching-due" && selectedTemplate.kpiCategory !== "otj-behind"
                      ? ` for ${timePeriodLabels[timePeriod]}`
                      : ""}
                  </span>
                </div>
              </div>

              {manualRecipients.length === 0 && selectedTemplate.kpiCategory === "otj-behind" && (
                <p className="text-xs text-muted-foreground">
                  OTJ Behind is a live at-risk list and does not have a dated event in the source data.
                </p>
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
                          {selectedTemplate.kpiCategory !== "missed-session" && recipient.periodDate
                            ? `, ${recipient.periodDate}`
                            : ""}
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

              <div className="flex gap-3">
                <Button
                  className="gap-1.5"
                  onClick={() => setSendConfirmOpen(true)}
                  disabled={sending || !recipientCount}
                >
                  <Send className="h-3.5 w-3.5" />
                  Send Now
                </Button>

                <Button
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => {
                    toast.info("Schedule is not connected yet", {
                      description: "Only Send Now is currently linked to the email webhook.",
                    });
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

            <AlertDialog open={sendConfirmOpen} onOpenChange={setSendConfirmOpen}>
              <AlertDialogContent className="max-w-md rounded-2xl border-[#E7DAF4] p-0 shadow-[0_22px_70px_rgba(36,20,83,0.22)]">
                <div className="rounded-t-2xl bg-[#241453] px-6 py-5 text-white">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
                      <Mail className="h-5 w-5" />
                    </div>
                    <div>
                      <AlertDialogTitle className="text-lg font-bold text-white">
                        Send Email Campaign
                      </AlertDialogTitle>
                      <p className="mt-1 text-xs font-medium text-[#E9D9BD]">
                        {kpiLabels[selectedTemplate.kpiCategory]}
                      </p>
                    </div>
                  </div>
                </div>

                <AlertDialogHeader className="space-y-3 px-6 pt-5 text-left">
                  <AlertDialogDescription className="text-sm leading-6 text-[#666666]">
                    You are about to send this email to{" "}
                    <span className="font-bold text-[#241453]">
                      {recipientCount} learner{recipientCount === 1 ? "" : "s"}
                    </span>
                    . The branded HTML template and the selected learner list will be sent to the webhook.
                  </AlertDialogDescription>

                  <div className="rounded-xl border border-[#E7DAF4] bg-[#F9F5FF] px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#80560F]">
                      Subject
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[#241453]">
                      {previewSubject || subject}
                    </p>
                  </div>
                </AlertDialogHeader>

                <AlertDialogFooter className="gap-2 px-6 pb-6 pt-2 sm:space-x-0">
                  <AlertDialogCancel className="mt-0 rounded-xl">
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(event) => {
                      event.preventDefault();
                      void handleSendNow();
                    }}
                    className="rounded-xl bg-[#B27715] font-bold text-white hover:bg-[#9D6912]"
                    disabled={sending}
                  >
                    {sending ? "Sending..." : "Send Now"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
