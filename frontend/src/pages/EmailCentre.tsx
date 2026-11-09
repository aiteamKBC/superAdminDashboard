import { useRef, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import AppLayout from "@/components/AppLayout";
import { mockEmailTemplates } from "@/data/mockData";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

const kpiLabels: Record<string, string> = {
  "missed-session": "Missed Session",
  "review-due": "Review Due",
  "coaching-due": "Coaching Required",
  "otj-behind": "OTJH Behind",
};

const TEST_EMAIL = "rewan.yasser@kentbusinesscollege.com";
const TEST_CC_EMAIL = "Ahmed.Lotfi@kentbusinesscollege.com";
const CATCH_UP_TEMPLATE_ID = "tpl-5";
const MAX_CC_RECIPIENTS = 20;
const EMAIL_ADDRESS_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type RecoverySessionType = "catch-up" | "alternative";

const RECOVERY_TEMPLATE_COPY: Record<RecoverySessionType, { subject: string; body: string; mergeFields: string[] }> = {
  "catch-up": {
    subject: "Your Catch-Up Session Details | {{programme}}",
    body: "Dear {{learnerName}},\n\nI hope you are doing well.\n\nWe noticed that you were unable to attend your session on **{{lastSessionDate}}**, and we wanted to make sure you have the opportunity to catch up on the content you missed.\n\nA catch-up session has been arranged for:\n\n**Date & Time:** {{catchUpSessionDateTime}}\n\nYou can join the session using the details below:\n\n**Join Meeting:** {{catchUpSessionLink}}\n**Meeting ID:** {{meetingId}}\n**Passcode:** {{passcode}}\n\nWe encourage you to attend this session so you can stay on track with your studies. If you have any questions or need any support, please don't hesitate to get in touch—we're here to help.\n\nWe look forward to seeing you there.\n\nKind regards,\n\n{{senderName}}\nEngagement Coordinator\nKent Business College",
    mergeFields: ["learnerName", "programme", "lastSessionDate", "catchUpSessionDateTime", "catchUpSessionLink", "meetingId", "passcode", "senderName"],
  },
  alternative: {
    subject: "Your Alternative Session Details | {{programme}}",
    body: "Dear {{learnerName}},\n\nI hope you are doing well.\n\nWe noticed that you were unable to attend your session on **{{lastSessionDate}}**. An alternative session covering the same lecture has been arranged with another group.\n\n**Date & Time:** {{alternativeSessionDateTime}}\n**Group / Session:** {{alternativeSessionGroup}}\n**Location or Join Link:** {{alternativeSessionLink}}\n\nPlease attend this alternative session so the missed lecture can be recovered and you can stay on track with your studies. If you have any questions or need any support, please contact us or your coach.\n\nWe look forward to seeing you there.\n\nKind regards,\n\n{{senderName}}\nEngagement Coordinator\nKent Business College",
    mergeFields: ["learnerName", "programme", "lastSessionDate", "alternativeSessionDateTime", "alternativeSessionGroup", "alternativeSessionLink", "senderName"],
  },
};

const readEmailResponse = async (res: Response) => {
  const text = await res.text();
  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    const message =
      data?.detail ||
      data?.error ||
      data?.message ||
      data?.raw ||
      `Email service returned ${res.status}`;
    throw new Error(String(message));
  }

  return data;
};

const statusKey = (value: unknown) => String(value || "").trim().toLowerCase();
const cleanEmail = (value: unknown) =>
  String(value || "")
    .replace(/[\u202A-\u202E]/g, "")
    .trim()
    .toLowerCase();

const parseEmailList = (value: string) =>
  value
    .split(/[,;\n]/)
    .map((entry) => cleanEmail(entry))
    .filter(Boolean);

const uniqueEmailList = (values: string[], exclude = "") => {
  const excluded = cleanEmail(exclude);
  return [...new Set(values.map((value) => cleanEmail(value)).filter((value) => value && value !== excluded))];
};

const getCoachEmailFromRaw = (raw: any) => {
  const directEmail = cleanEmail(raw?.OwnerEmail || raw?.coachEmail || raw?.email || raw?.case_owner_email);
  if (directEmail) return directEmail;

  const progressReview = raw?.overall_progress_review;
  if (progressReview && typeof progressReview === "object") {
    return cleanEmail(progressReview?.coach?.email);
  }

  if (typeof progressReview === "string") {
    try {
      const parsed = JSON.parse(progressReview);
      return cleanEmail(parsed?.coach?.email);
    } catch {
      return "";
    }
  }

  return "";
};

type EmailCentreLocationState = {
  selectedRecipient?: EmailRecipient;
  selectedRecipients?: EmailRecipient[];
  source?: string;
  ticketId?: number;
};

type AbsenceWeeksFilter = "all" | 0 | 1 | 2 | 3;
type EmailTimePeriod = "all" | "today" | "last7days" | "last30days" | "thisMonth" | "last12weeks";
type PrPeriodFilter = "last12weeks" | "allOverdue";
type McmMonthOffset = "all" | -3 | -2 | -1 | 0 | 1 | 2;

type AttendanceApiRow = {
  email?: string;
  fullName?: string;
  phone?: string;
  organisation?: string;
  aptemProgramme?: string;
  ownerName?: string;
  records?: Array<{
    date?: string;
    attendance?: number | null;
    module?: string;
    source?: string;
  }>;
};

const attendanceWeekRange = (offset: 0 | 1 | 2 | 3) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysSinceMonday = today.getDay() === 0 ? 6 : today.getDay() - 1;
  const start = new Date(today);
  start.setDate(today.getDate() - daysSinceMonday - offset * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const missedRecipientsFromAttendance = (
  rows: AttendanceApiRow[],
  week: AbsenceWeeksFilter,
): EmailRecipient[] => rows.flatMap((learner) => {
  const email = cleanEmail(learner.email);
  if (!email) return [];
  const range = week === "all" ? null : attendanceWeekRange(week);
  const records = (learner.records || [])
    .map((record) => ({ ...record, parsedDate: record.date ? new Date(`${record.date}T00:00:00`) : null }))
    .filter((record) => record.parsedDate && !Number.isNaN(record.parsedDate.getTime()))
    .filter((record) => !range || (record.parsedDate! >= range.start && record.parsedDate! <= range.end))
    .sort((a, b) => a.parsedDate!.getTime() - b.parsedDate!.getTime());
  const latest = records.at(-1);
  if (!latest || Number(latest.attendance) !== 0) return [];
  return [{
    learnerName: String(learner.fullName || "Unknown").trim(),
    learnerEmail: email,
    programme: String(latest.module || learner.aptemProgramme || "").trim(),
    coachName: String(learner.ownerName || "").trim(),
    coachEmail: "",
    lastSessionDate: String(latest.date || ""),
    status: "Active",
    riskCategories: ["missed-session"],
    hasAttendanceInWindow: true,
    lastSessionStatus: "Missed",
  }];
});

const absenceWindowLabels: Record<AbsenceWeeksFilter, string> = {
  all: "All",
  0: "This week",
  1: "Previous week",
  2: "2 weeks ago",
  3: "3 weeks ago",
};

const timePeriodLabels: Record<EmailTimePeriod, string> = {
  all: "All time",
  today: "Today",
  last7days: "Last 7 days",
  last30days: "Last 30 days",
  thisMonth: "This month",
  last12weeks: "Last 12 weeks",
};

const prPeriodLabels: Record<PrPeriodFilter, string> = {
  last12weeks: "Last 12 Weeks",
  allOverdue: "All Overdue",
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

const getPrLast12WeeksRange = () => {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(end.getDate() - 7 * 12 + 1);
  start.setHours(0, 0, 0, 0);
  return { start, end };
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
    .map((d) => String(d.date))
    .filter((date) => period === "all" || isDateInPeriod(date, period))
    .sort((a, b) => String(b).localeCompare(String(a)));

  return candidates[0] || "";
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

    const dt = parseDateValue(d.date);

    if (monthOffset === "all") {
      return Boolean(dt && dt < mcmToday && !d.completed);
    }

    const { start, end } = getMcmMonthRange(monthOffset);
    if (!dt || dt < start || dt > end) return false;

    if (isPastMonth) return true;
    if (d.completed) return false;

    const statusLower = String(d.status || "").toLowerCase();
    const isScheduled = statusLower.includes("scheduled") && !statusLower.includes("not");
    if (dt > mcmToday && isScheduled) return false;

    return true;
  });

  return candidates.sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]?.date || "";
};

const findLatestOverduePrDate = (
  dates: Array<{ date?: string; completed?: boolean; status?: string; isPast?: boolean }> | undefined,
  period: PrPeriodFilter
) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const range = period === "last12weeks" ? getPrLast12WeeksRange() : null;
  const candidates = (Array.isArray(dates) ? dates : [])
    .filter((d) => {
      if (!d?.date || d.completed) return false;
      const dt = parseDateValue(d.date);
      if (!dt || dt >= today) return false;
      if (!range) return true;
      return dt >= range.start && dt <= range.end;
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return candidates[0]?.date || "";
};

const wrapCanvasText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = 4
) => {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    } else {
      line = next;
    }
  }

  if (line && lines.length < maxLines) lines.push(line);
  lines.forEach((value, index) => ctx.fillText(value, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
};

const loadCanvasImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load image: ${src}`));
    image.src = src;
  });

const createEmailEvidenceImage = async ({
  filename,
  subject,
  learnerName,
  learnerEmail,
  ccEmails,
  programme,
  templateLabel,
  body,
}: {
  filename: string;
  subject: string;
  learnerName: string;
  learnerEmail: string;
  ccEmails: string[];
  programme: string;
  templateLabel: string;
  body: string;
}): Promise<File> => {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 1180;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");

  const emailX = 190;
  const emailY = 58;
  const emailW = 520;
  const headerH = 118;
  const contentPad = 24;
  const contentX = emailX + contentPad;
  const contentW = emailW - contentPad * 2;

  ctx.fillStyle = "#F8F8F8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#FFFFFF";
  ctx.strokeStyle = "#E4E4E4";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(emailX, emailY, emailW, 1020, 18);
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(emailX, emailY, emailW, 1020, 18);
  ctx.clip();

  ctx.fillStyle = "#241453";
  ctx.fillRect(emailX, emailY, emailW, headerH);

  try {
    const logo = await loadCanvasImage("/email-assets/logo.png");
    ctx.drawImage(logo, emailX + 34, emailY + 30, 148, 58);
  } catch (_) {
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "800 22px Arial, Helvetica, sans-serif";
    ctx.fillText("Kent", emailX + 36, emailY + 53);
    ctx.font = "700 14px Arial, Helvetica, sans-serif";
    ctx.fillText("Business College", emailX + 36, emailY + 75);
  }

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "800 13px Arial, Helvetica, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("ENGAGEMENT", emailX + emailW - 26, emailY + 52);
  ctx.fillText("WORKSPACE", emailX + emailW - 26, emailY + 72);
  ctx.textAlign = "left";

  const eyebrowByTemplate: Record<string, string> = {
    "Missed Session": "ATTENDANCE ACTION REQUIRED",
    "Review Due": "PROGRESS REVIEW FOLLOW-UP",
    "Coaching Required": "MONTHLY COACHING MEETING FOLLOW-UP",
    "OTJH Behind": "OFF-THE-JOB TRAINING SUPPORT",
  };
  const eyebrow = eyebrowByTemplate[templateLabel] || "LEARNER SUPPORT UPDATE";

  let y = emailY + headerH + 30;
  ctx.fillStyle = "#F9F5FF";
  ctx.strokeStyle = "#E7DAF4";
  ctx.beginPath();
  ctx.roundRect(contentX, y, contentW, 160, 16);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#80560F";
  ctx.font = "800 13px Arial, Helvetica, sans-serif";
  ctx.fillText(eyebrow, contentX + 24, y + 38);
  ctx.fillStyle = "#241453";
  ctx.font = "800 30px Arial, Helvetica, sans-serif";
  const titleEndY = wrapCanvasText(ctx, subject, contentX + 24, y + 78, contentW - 48, 36, 3);
  ctx.fillStyle = "#808080";
  ctx.font = "400 17px Arial, Helvetica, sans-serif";
  ctx.fillText(programme || "Programme", contentX + 24, Math.min(titleEndY + 18, y + 136));

  y += 198;
  ctx.fillStyle = "#4C4C4C";
  ctx.font = "400 22px Arial, Helvetica, sans-serif";

  const blocks = String(body || "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const nextY = wrapCanvasText(ctx, block, contentX, y, contentW, 31, 8);
    y = nextY + 24;
    if (y > emailY + 835) break;
  }

  ctx.fillStyle = "#E9D9BD";
  ctx.fillRect(emailX, emailY + 925, emailW, 1);
  ctx.fillStyle = "#F9F4EC";
  ctx.fillRect(emailX, emailY + 926, emailW, 94);
  ctx.fillStyle = "#808080";
  ctx.font = "400 14px Arial, Helvetica, sans-serif";
  wrapCanvasText(
    ctx,
    "Please do not ignore this message. If you have already completed this action, contact your coach so records can be updated.",
    contentX,
    emailY + 958,
    contentW,
    21,
    3
  );

  ctx.restore();

  ctx.fillStyle = "#71849A";
  ctx.font = "600 13px Arial, Helvetica, sans-serif";
  ctx.fillText(`Sent to ${learnerName || "learner"}${learnerEmail ? ` <${learnerEmail}>` : ""}`, emailX, emailY + 1052);
  if (ccEmails.length) {
    ctx.font = "500 12px Arial, Helvetica, sans-serif";
    ctx.fillText(`CC: ${ccEmails.join(", ")}`.slice(0, 105), emailX, emailY + 1074);
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("Could not create email evidence image"));
    }, "image/png");
  });

  return new File([blob], filename, { type: "image/png" });
};

const uploadEmailEvidenceImage = async (
  endpoint: string,
  filenamePrefix: string,
  evidence: {
    subject: string;
    learnerName: string;
    learnerEmail: string;
    ccEmails: string[];
    programme: string;
    templateLabel: string;
    body: string;
  }
) => {
  const dateStr = new Date().toISOString().slice(0, 10);
  const emailFile = await createEmailEvidenceImage({
    filename: `${filenamePrefix}-${dateStr}.png`,
    ...evidence,
  });
  const formData = new FormData();
  formData.append("file", emailFile);
  const res = await fetch(endpoint, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    throw new Error("Email sent, but evidence image upload failed");
  }
};

export default function EmailCentre() {
  const location = useLocation();
  const navigate = useNavigate();
  const locationState = (location.state || {}) as EmailCentreLocationState;
  const preselectedRecipient = locationState.selectedRecipient || null;
  const preselectedRecipients = locationState.selectedRecipients || null;
  const returnTicketId = locationState.ticketId ?? null;
  const isFromOtjTicket = locationState.source === "otj-ticket" && returnTicketId != null;
  const isFromAttendanceTicket =
    locationState.source === "attendance-ticket" && returnTicketId != null;
  const isFromPrTicket =
    locationState.source === "pr-ticket" && returnTicketId != null;
  const isFromMcmTicket =
    locationState.source === "mcm-ticket" && returnTicketId != null;

  const [selectedTemplate, setSelectedTemplate] = useState(mockEmailTemplates[0]);
  const [subject, setSubject] = useState(mockEmailTemplates[0].subject);
  const [body, setBody] = useState(mockEmailTemplates[0].body);


  const [coaches, setCoaches] = useState<UiCoach[]>([]);
  const [prRows, setPrRows] = useState<any[]>([]);
  const [mcrRows, setMcrRows] = useState<any[]>([]);
  const [otjRows, setOtjRows] = useState<any[]>([]);
  const [attendanceRows, setAttendanceRows] = useState<AttendanceApiRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const [manualRecipients, setManualRecipients] = useState<EmailRecipient[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false);
  const [timePeriod, setTimePeriod] = useState<EmailTimePeriod>("last30days");
  const [absenceWeeks, setAbsenceWeeks] = useState<AbsenceWeeksFilter>(0);
  const [prPeriodFilter, setPrPeriodFilter] = useState<PrPeriodFilter>("last12weeks");
  const [mcmMonthOffset] = useState<McmMonthOffset>(-1);
  const [ccInput, setCcInput] = useState("");
  const [recoverySessionType, setRecoverySessionType] = useState<RecoverySessionType>("catch-up");
  const [recoverySessionDateTime, setRecoverySessionDateTime] = useState("");
  const [recoverySessionLink, setRecoverySessionLink] = useState("");
  const [recoveryMeetingId, setRecoveryMeetingId] = useState("");
  const [recoveryPasscode, setRecoveryPasscode] = useState("");
  const [alternativeSessionGroup, setAlternativeSessionGroup] = useState("");

  const subjectRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [coachData, prData, mcrData, otjData, attendanceData] = await Promise.all([
          fetchUiCoaches(),
          fetch("/api/progress-review-summary/", { cache: "no-store" }).then((r) => {
            if (!r.ok) throw new Error("Progress Review data is unavailable");
            return r.json();
          }),
          fetch("/api/mcr-summary/", { cache: "no-store" }).then((r) => {
            if (!r.ok) throw new Error("Monthly Meeting data is unavailable");
            return r.json();
          }),
          fetch("/api/otj-at-risk/", { cache: "no-store" }).then((r) => {
            if (!r.ok) throw new Error("OTJH data is unavailable");
            return r.json();
          }),
          fetch("/api/kbc-attendance/", { cache: "no-store" }).then((r) => {
            if (!r.ok) throw new Error("Attendance data is unavailable");
            return r.json();
          }),
        ]);
        setCoaches(Array.isArray(coachData) ? coachData : []);
        setPrRows(Array.isArray(prData) ? prData : []);
        setMcrRows(Array.isArray(mcrData) ? mcrData : []);
        setOtjRows(Array.isArray(otjData) ? otjData : []);
        setAttendanceRows(Array.isArray(attendanceData) ? attendanceData : []);
      } catch (err) {
        console.error("Failed to load data", err);
        toast.error("Email recipient data is unavailable", {
          description: err instanceof Error ? err.message : "One or more LMS sources could not be loaded.",
        });
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
    prPeriodFilter,
    mcmMonthOffset,
    selectedTemplate.id,
    manualRecipients.length,
  ]);

  const allRecipients = useMemo(() => {
    return missedRecipientsFromAttendance(attendanceRows, absenceWeeks);
  }, [attendanceRows, absenceWeeks]);

  const coachEmailMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const coach of coaches) {
      const email = getCoachEmailFromRaw((coach as any)?.raw);
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
      .filter((r) => Number(r.overduePrCount ?? 0) > 0)
      .filter((r) => Boolean(findLatestOverduePrDate(r.plannedDates, prPeriodFilter)))
      .map((r) => {
        const coachName = String(r.caseOwner || "").trim();
        const coachEmail = coachEmailMap.get(coachName.toLowerCase()) ?? "";
        const periodDate = findLatestOverduePrDate(r.plannedDates, prPeriodFilter) || String(r.nextPrDate || "").trim();
        return {
          learnerName: String(r.fullName || "").trim(),
          learnerEmail: String(r.email || "").trim().toLowerCase(),
          programme: String(r.group || "").trim(),
          coachName,
          coachEmail,
          dueDate: periodDate,
          periodDate,
          status: "Active",
          riskCategories: ["review-due"],
        };
      })
      .filter((r) => {
        if (!r.learnerEmail || seen.has(r.learnerEmail)) return false;
        // Recipient scope comes from the canonical LMS endpoint, not legacy coach snapshots.
        seen.add(r.learnerEmail);
        return true;
      });
  }, [prRows, coachEmailMap, dashboardLearnerEmails, prPeriodFilter]);

  const mcrRecipients = useMemo<EmailRecipient[]>(() => {
    const seen = new Set<string>();
    return mcrRows
      .filter((r) => Number(r.overdueMcmCount ?? 0) > 0)
      .filter((r) => mcmMonthOffset === "all" || Boolean(findMcmDateInMonth(r.mcmDates, mcmMonthOffset)))
      .map((r) => {
        const coachName = String(r.caseOwner || "").trim();
        const coachEmail = coachEmailMap.get(coachName.toLowerCase()) ?? "";
        const periodDate = findMcmDateInMonth(r.mcmDates, mcmMonthOffset) || String(r.nextDueDate || r.nextMcm || "").trim();
        return {
          learnerName: String(r.fullName || "").trim(),
          learnerEmail: String(r.email || "").trim().toLowerCase(),
          programme: "",
          coachName,
          coachEmail,
          dueDate: periodDate,
          periodDate,
          status: "Active",
          riskCategories: ["coaching-due"],
        };
      })
      .filter((r) => {
        if (!r.learnerEmail || seen.has(r.learnerEmail)) return false;
        // Recipient scope comes from the canonical LMS endpoint, not legacy coach snapshots.
        seen.add(r.learnerEmail);
        return true;
      });
  }, [mcrRows, coachEmailMap, dashboardLearnerEmails, mcmMonthOffset]);

  const otjRecipients = useMemo<EmailRecipient[]>(() => {
    const seen = new Set<string>();
    return otjRows
      .filter((r) => statusKey(r.otjHoursStatus) === "at risk")
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
        // Recipient scope comes from the canonical LMS endpoint, not legacy coach snapshots.
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
      "missed-session": allRecipients.filter(
        (l: any) => l.status !== "Inactive" && l.lastSessionStatus === "Missed" && Boolean(l.hasAttendanceInWindow)
      ).length,
      "review-due": prReviewRecipients.length,
      "coaching-due": mcrRecipients.length,
      "otj-behind": otjRecipients.length,
    } as Record<string, number>;
  }, [allRecipients, prReviewRecipients, mcrRecipients, otjRecipients]);

  const effectiveRecipients = manualRecipients.length > 0 ? manualRecipients : bulkRecipients;
  const manualCcEntries = useMemo(() => parseEmailList(ccInput), [ccInput]);
  const invalidCcEmails = useMemo(
    () => manualCcEntries.filter((email) => !EMAIL_ADDRESS_RE.test(email)),
    [manualCcEntries]
  );
  const manualCcEmails = useMemo(
    () => uniqueEmailList(manualCcEntries.filter((email) => EMAIL_ADDRESS_RE.test(email))),
    [manualCcEntries]
  );
  const ccLimitExceeded = manualCcEmails.length > MAX_CC_RECIPIENTS;
  const ccValidationMessage = invalidCcEmails.length
    ? `Invalid CC email: ${invalidCcEmails[0]}`
    : ccLimitExceeded
      ? `You can add up to ${MAX_CC_RECIPIENTS} CC emails.`
      : "";

  const finalRecipients = manualRecipients.length > 0
    ? selectedIds.length > 0
      ? effectiveRecipients.filter((r) => selectedIds.includes(r.learnerEmail))
      : effectiveRecipients
    : effectiveRecipients.filter((r) => selectedIds.includes(r.learnerEmail));

  const availableRecipientCount = effectiveRecipients.length;
  const recipientCount = finalRecipients.length;
  const isRecoveryTemplate = selectedTemplate.id === CATCH_UP_TEMPLATE_ID;
  const recoveryValidationMessage = !isRecoveryTemplate
    ? ""
    : !recoverySessionDateTime.trim()
      ? "Add the recovery session date and time."
      : recoverySessionType === "catch-up" && !recoverySessionLink.trim()
        ? "Add the catch-up session join link."
        : recoverySessionType === "alternative" && !alternativeSessionGroup.trim()
          ? "Add the alternative group or session name."
          : "";
  const isRecoveryTemplateBlocked = Boolean(recoveryValidationMessage);
  const availableMergeFields = isRecoveryTemplate
    ? RECOVERY_TEMPLATE_COPY[recoverySessionType].mergeFields
    : selectedTemplate.mergeFields;

  const previewRecipient: EmailRecipient | null = effectiveRecipients[0] || null;
  const enrichRecipientForTemplate = (recipient: EmailRecipient) => {
    const { bookingLink: _bookingLink, ...rest } = recipient;
    const learnerEmail = String((rest as any).sourceLearnerEmail || rest.learnerEmail || "").trim().toLowerCase();
    const lookupRecipient = [
      ...prReviewRecipients,
      ...mcrRecipients,
      ...otjRecipients,
      ...allRecipients,
    ].find((item) => String(item.learnerEmail || "").trim().toLowerCase() === learnerEmail);
    const coachName =
      String(rest.coachName || "").trim() ||
      String(lookupRecipient?.coachName || "").trim() ||
      "the engagement team";
    const coachEmail =
      String(rest.coachEmail || "").trim().toLowerCase() ||
      String(lookupRecipient?.coachEmail || "").trim().toLowerCase() ||
      coachEmailMap.get(coachName.toLowerCase()) ||
      "";

    const ccEmails = uniqueEmailList([coachEmail, ...manualCcEmails], learnerEmail);
    return {
      ...rest,
      coachName,
      coachEmail,
      cc: ccEmails,
      ccEmails,
      ccEmail: ccEmails[0] || "",
      ccRecipients: ccEmails.map((email) => ({ emailAddress: { address: email } })),
      coachCcEmail: coachEmail,
      recoverySessionType,
      catchUpSessionDateTime: recoverySessionType === "catch-up" ? recoverySessionDateTime.trim() : "",
      catchUpSessionLink: recoverySessionType === "catch-up" ? recoverySessionLink.trim() : "",
      meetingId: recoverySessionType === "catch-up" ? recoveryMeetingId.trim() : "",
      passcode: recoverySessionType === "catch-up" ? recoveryPasscode.trim() : "",
      alternativeSessionDateTime: recoverySessionType === "alternative" ? recoverySessionDateTime.trim() : "",
      alternativeSessionGroup: recoverySessionType === "alternative" ? alternativeSessionGroup.trim() : "",
      alternativeSessionLink: recoverySessionType === "alternative" ? recoverySessionLink.trim() : "",
    };
  };
  const previewRecipientWithCc = previewRecipient ? enrichRecipientForTemplate(previewRecipient) : null;
  const previewCoachCcEmail = String(previewRecipientWithCc?.coachCcEmail || "").trim();
  const previewCoachName = String(previewRecipientWithCc?.coachName || "Learner coach").trim();

  const previewSubject = previewRecipient
    ? renderTemplate(subject, {
        ...previewRecipientWithCc,
        senderName: "Progress Coordinator",
      })
    : subject;

  const previewBody = previewRecipient
    ? renderTemplate(body, {
        ...previewRecipientWithCc,
        senderName: "Progress Coordinator",
      })
    : body;
  const previewHtml = previewRecipient
    ? buildBrandedEmailHtml({
        subject: previewSubject,
        body: previewBody,
        recipient: previewRecipientWithCc,
        kpiCategory: selectedTemplate.kpiCategory,
        previewMode: true,
      })
    : "";

  const buildRenderedRecipients = (recipients: EmailRecipient[]) =>
    recipients.map((recipient) => {
      const enrichedRecipient = enrichRecipientForTemplate(recipient);
      const mergedData = {
        ...enrichedRecipient,
        senderName: "Progress Coordinator",
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

  const sendRenderedRecipients = async (
    renderedRecipients: ReturnType<typeof buildRenderedRecipients>,
    extraPayload: Record<string, unknown> = {}
  ) => {
    return fetch("/api/send-email/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subject,
        body,
        bodyFormat: "html",
        isHtml: true,
        senderName: "Progress Coordinator",
        kpiCategory: selectedTemplate.kpiCategory,
        cc: manualCcEmails,
        ccEmails: manualCcEmails,
        ccEmail: manualCcEmails[0] || "",
        ccRecipients: manualCcEmails.map((email) => ({ emailAddress: { address: email } })),
        recipients: renderedRecipients,
        ...extraPayload,
        preview: renderedRecipients[0]
          ? {
              subject: renderedRecipients[0].renderedSubject,
              body: renderedRecipients[0].renderedBody,
              textBody: renderedRecipients[0].renderedTextBody,
            }
          : null,
      }),
    });
  };

  const handleTemplateChange = (template: (typeof mockEmailTemplates)[number]) => {
    setSelectedTemplate(template);
    if (template.id === CATCH_UP_TEMPLATE_ID) {
      setRecoverySessionType("catch-up");
      setRecoverySessionDateTime("");
      setRecoverySessionLink("");
      setRecoveryMeetingId("");
      setRecoveryPasscode("");
      setAlternativeSessionGroup("");
      setSubject(RECOVERY_TEMPLATE_COPY["catch-up"].subject);
      setBody(RECOVERY_TEMPLATE_COPY["catch-up"].body);
    } else {
      setSubject(template.subject);
      setBody(template.body);
    }
    setShowPreview(false);
  };

  const handleRecoverySessionTypeChange = (value: RecoverySessionType) => {
    setRecoverySessionType(value);
    setRecoverySessionDateTime("");
    setRecoverySessionLink("");
    setRecoveryMeetingId("");
    setRecoveryPasscode("");
    setAlternativeSessionGroup("");
    setSubject(RECOVERY_TEMPLATE_COPY[value].subject);
    setBody(RECOVERY_TEMPLATE_COPY[value].body);
    setShowPreview(false);
  };

  const ensureValidCc = () => {
    if (!ccValidationMessage) return true;
    toast.error("Check the CC email list", { description: ccValidationMessage });
    return false;
  };

  const handleSendTest = async () => {
    if (!ensureValidCc()) return;
    if (isRecoveryTemplateBlocked) {
      toast.error("Add the recovery session details first", {
        description: recoveryValidationMessage,
      });
      return;
    }

    const sourceRecipient = previewRecipient || finalRecipients[0];
    if (!sourceRecipient) {
      toast.error("No learner is available for the test email");
      return;
    }

    try {
      setSending(true);
      const testRecipient = {
        ...sourceRecipient,
        sourceLearnerEmail: sourceRecipient.learnerEmail,
        learnerEmail: TEST_EMAIL,
      };
      const renderedRecipients = buildRenderedRecipients([testRecipient]).map((recipient) => {
        const ccList = uniqueEmailList([TEST_CC_EMAIL, ...manualCcEmails], TEST_EMAIL);
        return {
          ...recipient,
          cc: ccList,
          ccEmails: ccList,
          ccEmail: ccList[0] || "",
          ccRecipients: ccList.map((email) => ({ emailAddress: { address: email } })),
          testCcEmail: cleanEmail(TEST_CC_EMAIL),
        };
      });
      const testCcList = uniqueEmailList([TEST_CC_EMAIL, ...manualCcEmails], TEST_EMAIL);
      const res = await sendRenderedRecipients(renderedRecipients, {
        cc: testCcList,
        ccEmails: testCcList,
        ccEmail: testCcList[0] || "",
        ccRecipients: testCcList.map((email) => ({ emailAddress: { address: email } })),
        testCcEmail: cleanEmail(TEST_CC_EMAIL),
      });
      await readEmailResponse(res);

      toast.success("Test email sent", {
        description: `Sent to ${TEST_EMAIL}. CC: ${testCcList.join(", ")}.`,
      });
    } catch (err: any) {
      console.error(err);
      toast.error("Test email failed", {
        description: err?.message || "Please try again or check the webhook.",
      });
    } finally {
      setSending(false);
    }
  };

  const handleSendNow = async () => {
    if (!ensureValidCc()) return;
    if (!finalRecipients.length) {
      toast.error("Select at least one learner before sending");
      return;
    }
    if (isRecoveryTemplateBlocked) {
      toast.error("Add the recovery session details first", {
        description: recoveryValidationMessage,
      });
      return;
    }

    try {
      setSending(true);

      const renderedRecipients = buildRenderedRecipients(finalRecipients);
      const res = await sendRenderedRecipients(renderedRecipients);
      const result = await readEmailResponse(res);

      const sentCount = Number(result?.sentCount ?? 0);
      const failedCount = Number(result?.failedCount ?? 0);
      const evidenceRecipient = renderedRecipients[0];
      const emailEvidence = {
        subject: evidenceRecipient?.renderedSubject || previewSubject || subject,
        learnerName: evidenceRecipient?.learnerName || preselectedRecipient?.learnerName || "",
        learnerEmail: evidenceRecipient?.learnerEmail || preselectedRecipient?.learnerEmail || "",
        ccEmails: Array.isArray(evidenceRecipient?.cc) ? evidenceRecipient.cc : [],
        programme: evidenceRecipient?.programme || preselectedRecipient?.programme || "",
        templateLabel: kpiLabels[selectedTemplate.kpiCategory] || selectedTemplate.name,
        body: evidenceRecipient?.renderedTextBody || previewBody || body,
      };

      toast.success("Emails sent successfully", {
        description:
          failedCount > 0
            ? `${sentCount} sent, ${failedCount} failed.`
            : `${sentCount} email${sentCount === 1 ? "" : "s"} sent.`,
      });

      if (isFromOtjTicket) {
        try {
          await uploadEmailEvidenceImage(
            `/api/otj-tickets/${returnTicketId}/files/`,
            "email-sent",
            emailEvidence
          );
        } catch (err) {
          console.error(err);
          toast.warning("Email sent, but evidence image was not attached");
        }
        navigate(`/otj-hours/tickets?emailed_ticket=${returnTicketId}`, { replace: true });
        return;
      }
      if (isFromAttendanceTicket) {
        try {
          await uploadEmailEvidenceImage(
            `/api/attendance-tickets/${returnTicketId}/files/`,
            "attendance-email-sent",
            emailEvidence
          );
        } catch (err) {
          console.error(err);
          toast.warning("Email sent, but evidence image was not attached");
        }
        navigate(`/attendance/tickets?emailed_ticket=${returnTicketId}`, {
          replace: true,
        });
        return;
      }
      if (isFromPrTicket) {
        try {
          await uploadEmailEvidenceImage(
            `/api/pr-tickets/${returnTicketId}/files/`,
            "pr-email-sent",
            emailEvidence
          );
        } catch (err) {
          console.error(err);
          toast.warning("Email sent, but evidence image was not attached");
        }
        navigate(`/progress-review/tickets?emailed_ticket=${returnTicketId}`, {
          replace: true,
        });
        return;
      }
      if (isFromMcmTicket) {
        try {
          await uploadEmailEvidenceImage(
            `/api/mcm-tickets/${returnTicketId}/files/`,
            "mcm-email-sent",
            emailEvidence
          );
        } catch (err) {
          console.error(err);
          toast.warning("Email sent, but evidence image was not attached");
        }
        navigate(`/coaching-meetings/tickets?emailed_ticket=${returnTicketId}`, {
          replace: true,
        });
        return;
      }
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
        {(isFromOtjTicket || isFromAttendanceTicket || isFromPrTicket || isFromMcmTicket) && (
          <button
            onClick={() =>
              navigate(
                isFromAttendanceTicket
                  ? "/attendance/tickets"
                  : isFromPrTicket
                    ? "/progress-review/tickets"
                    : isFromMcmTicket
                      ? "/coaching-meetings/tickets"
                      : "/otj-hours/tickets"
              )
            }
            className="mb-4 inline-flex items-center gap-1.5 text-[0px] font-semibold text-[#1E6ACB] hover:underline">
            <span className="text-sm">
              ← Back to {isFromAttendanceTicket ? "Attendance" : isFromPrTicket ? "PR" : isFromMcmTicket ? "MCM" : "OTJH"} Tickets
            </span>
          </button>
        )}
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

              {isRecoveryTemplate && (
                <div className="space-y-3 rounded-xl border border-[#D7E5F3] bg-[#F8FBFE] p-4">
                  <div>
                    <p className="text-xs font-semibold text-[#14264A]">Recovery option</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Choose a catch-up session or the same lecture with another group.
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button type="button" variant={recoverySessionType === "catch-up" ? "default" : "outline"} onClick={() => handleRecoverySessionTypeChange("catch-up")}>
                      Catch-up Session
                    </Button>
                    <Button type="button" variant={recoverySessionType === "alternative" ? "default" : "outline"} onClick={() => handleRecoverySessionTypeChange("alternative")}>
                      Alternative Session
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="recovery-date-time" className="text-xs font-medium text-muted-foreground">Date &amp; time</label>
                      <Input id="recovery-date-time" value={recoverySessionDateTime} onChange={(event) => setRecoverySessionDateTime(event.target.value)} placeholder="e.g. 12 Nov 2026, 2:00 PM" className="mt-1 bg-white" />
                    </div>
                    {recoverySessionType === "alternative" && (
                      <div>
                        <label htmlFor="alternative-session-group" className="text-xs font-medium text-muted-foreground">Group / session</label>
                        <Input id="alternative-session-group" value={alternativeSessionGroup} onChange={(event) => setAlternativeSessionGroup(event.target.value)} placeholder="e.g. Group B · Marketing" className="mt-1 bg-white" />
                      </div>
                    )}
                    <div className={recoverySessionType === "catch-up" ? "sm:col-span-2" : ""}>
                      <label htmlFor="recovery-session-link" className="text-xs font-medium text-muted-foreground">
                        {recoverySessionType === "catch-up" ? "Join link" : "Location or join link (optional)"}
                      </label>
                      <Input id="recovery-session-link" value={recoverySessionLink} onChange={(event) => setRecoverySessionLink(event.target.value)} placeholder={recoverySessionType === "catch-up" ? "https://..." : "Room or https://..."} className="mt-1 bg-white" />
                    </div>
                    {recoverySessionType === "catch-up" && (
                      <>
                        <div>
                          <label htmlFor="recovery-meeting-id" className="text-xs font-medium text-muted-foreground">Meeting ID (optional)</label>
                          <Input id="recovery-meeting-id" value={recoveryMeetingId} onChange={(event) => setRecoveryMeetingId(event.target.value)} className="mt-1 bg-white" />
                        </div>
                        <div>
                          <label htmlFor="recovery-passcode" className="text-xs font-medium text-muted-foreground">Passcode (optional)</label>
                          <Input id="recovery-passcode" value={recoveryPasscode} onChange={(event) => setRecoveryPasscode(event.target.value)} className="mt-1 bg-white" />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

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

              <div className="rounded-xl border border-[#D7E5F3] bg-[#F8FBFE] p-3">
                <p className="text-xs font-semibold text-[#14264A]">Coach CC</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {previewCoachCcEmail
                    ? `${previewCoachName} will be copied on this email: ${previewCoachCcEmail}`
                    : "The learner's coach will be copied when a coach email is available."}
                </p>
              </div>

              <div>
                <label htmlFor="additional-cc" className="text-xs font-medium text-muted-foreground">
                  Additional CC emails
                </label>
                <Input
                  id="additional-cc"
                  value={ccInput}
                  onChange={(event) => setCcInput(event.target.value)}
                  placeholder="manager@example.com, support@example.com"
                  className="mt-1"
                  aria-invalid={Boolean(ccValidationMessage)}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Separate multiple addresses with a comma, semicolon or new line. These are added to every selected learner email alongside the learner's coach.
                </p>
                {ccValidationMessage ? (
                  <p className="mt-1 text-xs font-semibold text-red-600" role="alert">{ccValidationMessage}</p>
                ) : null}
                {manualCcEmails.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {manualCcEmails.map((email) => <Badge key={email} variant="secondary" className="text-[10px]">{email}</Badge>)}
                  </div>
                ) : null}
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
                {availableMergeFields.map((field: string) => (
                  <Badge key={field} variant="secondary" className="text-[10px] font-mono">
                    {`{{${field}}}`}
                  </Badge>
                ))}
              </div>

              {isRecoveryTemplate && (
                <div
                  className={`rounded-xl border p-3 text-xs ${
                    isRecoveryTemplateBlocked
                      ? "border-amber-200 bg-amber-50 text-amber-900"
                      : "border-emerald-200 bg-emerald-50 text-emerald-900"
                  }`}
                >
                  {isRecoveryTemplateBlocked
                    ? recoveryValidationMessage
                    : `${recoverySessionType === "catch-up" ? "Catch-up" : "Alternative"} session details are ready.`}
                </div>
              )}
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

              {manualRecipients.length === 0 && selectedTemplate.kpiCategory !== "otj-behind" && (
                <div className="flex flex-col gap-2 rounded-xl border border-[#E7DAF4] bg-[#FCF8FF] p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-[#442F73]">
                      {selectedTemplate.kpiCategory === "missed-session"
                        ? "Attendance week"
                        : selectedTemplate.kpiCategory === "review-due"
                          ? "PR Window"
                          : selectedTemplate.kpiCategory === "coaching-due"
                            ? "MCM Month"
                            : "Time period"}
                    </p>
                    <p className="text-xs text-[#808080]">
                      {selectedTemplate.kpiCategory === "missed-session"
                        ? "Weeks start on Monday and end on Sunday."
                        : selectedTemplate.kpiCategory === "review-due"
                          ? "Default matches Required PR: overdue progress reviews in the last 12 weeks."
                          : selectedTemplate.kpiCategory === "coaching-due"
                            ? "Fixed to overdue Monthly Coaching Meeting dates from last month."
                            : "Controls which learners appear for date-based templates."}
                    </p>
                  </div>

                  {selectedTemplate.kpiCategory === "missed-session" ? (
                    <Select
                      value={String(absenceWeeks)}
                      onValueChange={(value) => setAbsenceWeeks(Number(value) as AbsenceWeeksFilter)}
                    >
                      <SelectTrigger className="h-11 w-full rounded-xl border-[#D8C9EE] bg-white px-4 text-sm font-semibold text-[#14264A] shadow-sm focus:ring-[#E7DAF4] sm:w-[310px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent
                        align="end"
                        className="rounded-xl border-[#D8C9EE] bg-white p-1.5 shadow-xl"
                      >
                        {[0, 1, 2, 3].map((week) => (
                          <SelectItem
                            key={week}
                            value={String(week)}
                            className="rounded-lg py-2.5 pl-8 pr-3 text-sm font-medium text-[#14264A] focus:bg-[#EEF7FF] focus:text-[#1E6ACB] data-[state=checked]:bg-[#EEF7FF] data-[state=checked]:text-[#1E6ACB]"
                          >
                            {getAbsenceWindowLabel(week as 0 | 1 | 2 | 3)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : selectedTemplate.kpiCategory === "review-due" ? (
                    <Select
                      value={prPeriodFilter}
                      onValueChange={(value) => setPrPeriodFilter(value as PrPeriodFilter)}
                    >
                      <SelectTrigger className="h-11 w-full rounded-xl border-[#D8C9EE] bg-white px-4 text-sm font-semibold text-[#14264A] shadow-sm focus:ring-[#E7DAF4] sm:w-[210px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent
                        align="end"
                        className="rounded-xl border-[#D8C9EE] bg-white p-1.5 shadow-xl"
                      >
                        {(["last12weeks", "allOverdue"] as PrPeriodFilter[]).map((period) => (
                          <SelectItem
                            key={period}
                            value={period}
                            className="rounded-lg py-2.5 pl-8 pr-3 text-sm font-medium text-[#14264A] focus:bg-[#EEF7FF] focus:text-[#1E6ACB] data-[state=checked]:bg-[#EEF7FF] data-[state=checked]:text-[#1E6ACB]"
                          >
                            {prPeriodLabels[period]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : selectedTemplate.kpiCategory === "coaching-due" ? (
                    <div className="inline-flex h-11 w-full items-center justify-between rounded-xl border border-[#D8C9EE] bg-white px-4 text-sm font-semibold text-[#14264A] shadow-sm sm:w-[240px]">
                      {getMcmMonthLabel(-1)}
                    </div>
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
                    {loading ? "..." : availableRecipientCount}
                  </span>
                  <span className="text-muted-foreground">
                    available recipients in "{kpiLabels[selectedTemplate.kpiCategory]}"
                    {manualRecipients.length === 0 && selectedTemplate.kpiCategory === "missed-session"
                      ? ` for ${getAbsenceWindowLabel(absenceWeeks)}`
                      : ""}
                    {manualRecipients.length === 0 && selectedTemplate.kpiCategory === "review-due"
                      ? ` for ${prPeriodLabels[prPeriodFilter]}`
                      : ""}
                    {manualRecipients.length === 0 && selectedTemplate.kpiCategory === "coaching-due"
                      ? ` for ${getMcmMonthLabel(mcmMonthOffset)}`
                      : ""}
                    {manualRecipients.length === 0 && selectedTemplate.kpiCategory !== "missed-session" && selectedTemplate.kpiCategory !== "review-due" && selectedTemplate.kpiCategory !== "coaching-due" && selectedTemplate.kpiCategory !== "otj-behind"
                      ? ` for ${timePeriodLabels[timePeriod]}`
                      : ""}
                    {` · ${recipientCount} will receive this email`}
                  </span>
                </div>
              </div>

              {manualRecipients.length === 0 && selectedTemplate.kpiCategory === "otj-behind" && (
                <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-800">
                  OTJH Behind uses the live At Risk list only. No date filter is applied.
                </div>
              )}

              <div className="space-y-2">
                <p className="text-sm font-medium">
                  Select Learners
                  <span className="ml-1 text-gray-500">"Multiple selection is available"</span>
                  <span className="ml-1">({recipientCount} will receive)</span>
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
                  disabled={sending || !recipientCount || isRecoveryTemplateBlocked || Boolean(ccValidationMessage)}
                >
                  <Send className="h-3.5 w-3.5" />
                  Send Now
                </Button>

                <Button
                  variant="outline"
                  className="gap-1.5"
                  onClick={handleSendTest}
                  disabled={sending || !previewRecipient || isRecoveryTemplateBlocked || Boolean(ccValidationMessage)}
                >
                  <Mail className="h-3.5 w-3.5" />
                  Send Test
                </Button>

                <Button
                  variant="outline"
                  className="gap-1.5"
                  disabled
                  title="Scheduling is not connected to the email service yet"
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
                  <div className="rounded-xl border border-[#D7E5F3] bg-[#F8FBFE] px-4 py-3 text-xs text-[#52677D]">
                    <p className="font-semibold text-[#14264A]">CC recipients</p>
                    <p className="mt-1">Each learner's coach is included when available.</p>
                    <p className="mt-1">Additional CC: {manualCcEmails.length ? manualCcEmails.join(", ") : "None"}</p>
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
                    disabled={sending || isRecoveryTemplateBlocked || Boolean(ccValidationMessage)}
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
