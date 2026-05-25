import { useState, useEffect } from "react";
import { Learner, CallOutcome } from "@/types/dashboard";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getBookingLinks } from "@/lib/bookingLinks";

type BookingDraft = {
  sessionType: "PR" | "MCM" | "Support";
  sessionLabel: string;
  url: string;
  date: string;
  time: string;
  notes: string;
};
import { useNavigate } from "react-router-dom";
import {
  Phone,
  Mail,
  Calendar,
  CheckCircle2,
  User,
  Building,
  BookOpen,
  Clock,
  Briefcase,
} from "lucide-react";

interface LearnerDrawerProps {
  learner: Learner | null;
  open: boolean;
  onClose: () => void;
  onResolve?: (payload: {
    contactKey: string;
    email: string;
    date: string;
    module: string;
    resolved: boolean;
    note: string;
  }) => void;
  onUpdateContactAction?: (payload: {
    contactKey: string;
    email: string;
    date: string;
    module: string;
    called: boolean;
    emailed: boolean;
    resolved: boolean;
    note: string;
  }) => void;
  otjAtRiskData?: any[];
  mcrData?: any[];
  progressReviewRows?: any[];
  prBookedData?: any[];
}

const kpiLabels: Record<string, string> = {
  "missed-session": "Missed Session",
  "review-due": "Review Due",
  "coaching-due": "Coaching Due",
  "otj-behind": "OTJ Behind",
};

const outcomeOptions: CallOutcome[] = [
  "Sent email with details",
  "Booked an appointment with the coach",
  "Escalated to line manager",
  "Escalated to HR",
  "No answer – voicemail left",
  "No answer – will try again",
  "Other (specify)",
];

const safeText = (v: unknown, fallback = "Unknown") => {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
};

const formatDateValue = (v: unknown, fallback = "N/A") => {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
};

const yesNoText = (v: unknown) => (v ? "Yes" : "No");

const splitNoteParts = (noteValue: unknown) => {
  const note = String(noteValue || "").trim();
  if (!note) return { outcome: "", details: "" };

  const parts = note.split(" | ").map((part) => part.trim()).filter(Boolean);

  if (parts.length >= 2) {
    return {
      outcome: parts[0],
      details: parts.slice(1).join(" | "),
    };
  }

  return {
    outcome: note,
    details: "",
  };
};

const buildNoteValue = (outcome: string, details: string) => {
  const cleanOutcome = String(outcome || "").trim();
  const cleanDetails = String(details || "").trim();

  if (cleanOutcome && cleanDetails) return `${cleanOutcome} | ${cleanDetails}`;
  if (cleanOutcome) return cleanOutcome;
  if (cleanDetails) return cleanDetails;
  return "";
};

const getOtjStatusMeta = (priority: string) => {
  switch (priority) {
    case "at-risk":
      return {
        label: "At Risk",
        textClass: "text-severity-critical",
        badgeClass: "bg-severity-critical-bg text-severity-critical-foreground",
      };

    case "need-attention":
      return {
        label: "Need Attention",
        textClass: "text-severity-overdue",
        badgeClass: "bg-severity-overdue-bg text-severity-overdue-foreground",
      };

    default:
      return {
        label: "Normal",
        textClass: "text-foreground",
        badgeClass: "bg-muted text-foreground",
      };
  }
};

export default function LearnerDrawer({
  learner,
  open,
  onClose,
  onResolve,
  onUpdateContactAction,
  otjAtRiskData = [],
  mcrData = [],
  progressReviewRows = [],
  prBookedData = [],
}: LearnerDrawerProps) {
  const [bookingDraft, setBookingDraft] = useState<BookingDraft | null>(null);
  const [showCallLog, setShowCallLog] = useState(false);
  const [callOutcome, setCallOutcome] = useState<CallOutcome | "">("");
  const [callNotes, setCallNotes] = useState("");
  const [contactLogs, setContactLogs] = useState<any[]>([]);

  const fetchContactLogs = (email: string) => {
    if (!email) { setContactLogs([]); return; }
    fetch(`/api/contact-log/?email=${encodeURIComponent(email)}`)
      .then((r) => r.json())
      .then((d) => setContactLogs(Array.isArray(d) ? d : []))
      .catch(() => setContactLogs([]));
  };

  useEffect(() => {
    const noteParts = splitNoteParts((learner as any)?.note);
    setCallOutcome((noteParts.outcome || "") as CallOutcome | "");
    setCallNotes(noteParts.details || "");
    setShowCallLog(false);
    fetchContactLogs((learner as any)?.email || "");
  }, [learner]);

  const navigate = useNavigate();
  const isResolved = !!learner?.isResolved;

  if (!learner) return null;

  const learnerAny = learner as any;

  const ne = (v: unknown) => String(v ?? "").trim().toLowerCase();
  const learnerEmail = ne(learner.email);

  // ── OTJ data from aptem_auto_extracting ──────────────────────────────
  const otjRow = otjAtRiskData.find((r: any) => ne(r.email) === learnerEmail) ?? null;

  const planned = otjRow ? Number(otjRow.otjPlanned ?? 0) : Number(learner.plannedOtjHours || 0);
  const completed = otjRow ? Number(otjRow.otjCompleted ?? 0) : Number(learner.actualOtjHours || 0);

  const totalDays = Number(otjRow?.totalDays ?? 0);
  const elapsedDays = Number(otjRow?.elapsedDays ?? 0);
  const targetNow =
    planned && totalDays && elapsedDays
      ? Math.round((elapsedDays / totalDays) * planned)
      : Number(learnerAny.targetNow || 0);

  const rawVariance = otjRow
    ? Number(String(otjRow.progressVariance ?? "0").replace(/[^0-9.-]/g, "") || "0")
    : Number(learnerAny.otjBehindPct ?? 0);
  const behindPct = rawVariance < 0 ? Math.abs(rawVariance) : 0;

  const otjHoursStatusRaw = otjRow
    ? String(otjRow.otjHoursStatus || "").trim()
    : String(learnerAny.otjHoursStatus || "").trim();
  const otjHoursStatusLower = otjHoursStatusRaw.toLowerCase();

  const otjStatusBg =
    otjHoursStatusLower === "at risk" ? "#FFF0F0" :
    otjHoursStatusLower === "on track" ? "#F0FFF6" : "#F5F5F5";
  const otjStatusColor =
    otjHoursStatusLower === "at risk" ? "#C0392B" :
    otjHoursStatusLower === "on track" ? "#2E9E5B" : "#666666";
  const otjTextColor =
    otjHoursStatusLower === "at risk" ? "text-[#C0392B]" :
    otjHoursStatusLower === "on track" ? "text-[#2E9E5B]" : "text-foreground";

  const requiredHoursToSubmit = otjRow
    ? String(otjRow.progressHours || "N/A").replace(/^\s*-\s*/, "").trim() || "N/A"
    : safeText(learnerAny.requiredHoursToSubmit, "N/A");

  const progressTarget = targetNow > 0 ? targetNow : planned;
  const progressWidth =
    progressTarget > 0 ? Math.min(100, (completed / progressTarget) * 100) : 0;

  // ── MCM data from MCR table ───────────────────────────────────────────
  const mcrRow = mcrData.find((r: any) => ne(r.email) === learnerEmail) ?? null;
  const mcmDates: Array<{ date: string; status: string; completed: boolean }> =
    mcrRow?.mcmDates ?? [];

  const mcmCompleted = mcmDates
    .filter((d) => d.completed)
    .sort((a, b) => a.date.localeCompare(b.date));
  const monthlyCoachingLastCompleted = mcmCompleted.at(-1)?.date ?? "N/A";

  const mcmFuture = mcmDates
    .filter((d) => !d.completed)
    .sort((a, b) => a.date.localeCompare(b.date));
  const nextMcmEntry = mcmFuture[0] ?? null;
  const monthlyCoachingNextDue = nextMcmEntry?.date ?? "N/A";

  const mcmNextStatusLower = String(nextMcmEntry?.status ?? "").toLowerCase();
  const monthlyCoachingBooked =
    mcmNextStatusLower.includes("scheduled") && !mcmNextStatusLower.includes("not");
  const monthlyCoachingStatusLabel = nextMcmEntry?.status ?? "";

  // ── PR data from progress_review table ───────────────────────────────
  const prRow = (progressReviewRows as any[]).find((r: any) => ne(r.email) === learnerEmail) ?? null;
  const prBookedRow = (prBookedData as any[]).find((r: any) => ne(r.email) === learnerEmail) ?? null;

  const progressReviewLastCompleted = prRow
    ? String(prRow.lastProgressReview ?? prRow.lastPrDate ?? "").trim() || "N/A"
    : formatDateValue(learner.lastProgressReviewDate, "N/A");

  const prNextDate = prRow
    ? String(prRow.nextPrDate ?? "").trim() || "N/A"
    : formatDateValue(learner.nextProgressReviewDue, "N/A");
  const prNextState = prRow ? String(prRow.nextPrState ?? "").trim() : "";
  const progressReviewNextDue =
    prNextDate !== "N/A" && prNextState
      ? `${prNextDate} (${prNextState})`
      : prNextDate;

  const progressReviewBooked = (prBookedRow?.bookedDates ?? []).length > 0;

  const organisation = safeText(learner.organisation, "Unknown");
  const programme = safeText(learner.programme, "Unknown");

  const coachName = safeText(learner.coach, "N/A");
  const coachPhone = safeText(learnerAny.coachPhone, "No phone on file");
  const coachEmail = safeText(learnerAny.coachEmail, "No email on file");

  const lineManagerName = safeText(learner.lineManagerName, "N/A");
  const lineManagerPhone = safeText(learner.lineManagerPhone, "No phone on file");
  const lineManagerEmail = safeText(learner.lineManagerEmail, "No email on file");

  const hrManagerName = safeText(learner.hrManagerName, "N/A");
  const hrManagerPhone = safeText(learner.hrManagerPhone, "No phone on file");
  const hrManagerEmail = safeText(learner.hrManagerEmail, "No email on file");

  const toEmailRecipient = (learner: Learner) => {
    const learnerAny = learner as any;

    return {
      learnerName: `${learner.firstName || ""} ${learner.lastName || ""}`.trim(),
      learnerEmail: learner.email || "",
      programme: learner.programme || "",
      coachName: learner.coach || "",
      coachEmail: learnerAny.coachEmail || "",
      lastSessionDate:
        learnerAny.lastMonthlyMeetingDate ||
        learner.lastProgressReviewDate ||
        "",
      senderName: "Progress Coordinator",
      lineManagerEmail: learner.lineManagerEmail || "",
      hrEmail: learner.hrManagerEmail || "",
      status: learner.status || "Active",
      riskCategories: Array.isArray(learner.riskCategories)
        ? learner.riskCategories
        : [],
    };
  };

  const handleSendEmail = () => {
    navigate("/email-centre", {
      state: {
        selectedRecipient: toEmailRecipient(learner),
        source: "learner-drawer",
      },
    });
  };

  const handleSaveLog = async () => {
    const la = learner as any;
    const note = buildNoteValue(String(callOutcome || ""), callNotes);

    if (la.attendanceDate && la.attendanceModule) {
      onUpdateContactAction?.({
        contactKey: String(la.attendanceContactKey || ""),
        email: String(la.attendanceEmail || ""),
        date: String(la.attendanceDate || ""),
        module: String(la.attendanceModule || ""),
        called: true,
        emailed: Boolean(la.emailed),
        resolved: Boolean(la.isResolved),
        note,
      });
    } else {
      const SOURCE_MAP: Record<string, string> = {
        "review-due": "pr-due",
        "coaching-due": "mcm-due",
        "otj-behind": "otj-behind",
      };
      const cats = Array.isArray(learner?.riskCategories) ? learner.riskCategories : [];
      const logSource = cats.map((c: string) => SOURCE_MAP[c]).find(Boolean) || "attendance";
      try {
        await fetch("/api/contact-log/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            learnerEmail: learner?.email || "",
            learnerName: `${learner?.firstName || ""} ${learner?.lastName || ""}`.trim(),
            coach: learner?.coach || "",
            actionType: "called",
            outcome: String(callOutcome || ""),
            notes: callNotes,
            source: logSource,
          }),
        });
        fetchContactLogs(learner?.email || "");
      } catch {}
    }

    setShowCallLog(false);
  };

  return (
    <>
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-xl">
            {learner.firstName} {learner.lastName}
          </SheetTitle>

          <div className="flex gap-2 flex-wrap">
            {isResolved && (
              <Badge className="bg-green-100 text-green-700 border-0 text-[11px]">
                Resolved
              </Badge>
            )}
            {(learner.riskCategories || []).map((c) => (
              <Badge key={c} variant="outline" className="text-[11px]">
                {kpiLabels[c] || String(c)}
              </Badge>
            ))}

            {learner.priority !== "normal" && (
              <Badge
                className={`text-[11px] border-0 ${
                  learner.priority === "critical"
                    ? "bg-severity-critical-bg text-severity-critical-foreground"
                    : "bg-severity-overdue-bg text-severity-overdue-foreground"
                }`}
              >
                {learner.priority === "critical" ? "Critical" : "High Priority"}
              </Badge>
            )}
          </div>
        </SheetHeader>

        <div className="space-y-5 mt-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <User className="w-3.5 h-3.5" />
              {safeText(learner.coach, "N/A")}
            </div>

            <div className="flex items-center gap-2 text-muted-foreground">
              <Building className="w-3.5 h-3.5" />
              {organisation}
            </div>

            <div className="flex items-center gap-2 text-muted-foreground">
              <BookOpen className="w-3.5 h-3.5" />
              {programme}
            </div>

            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="w-3.5 h-3.5" />
              {safeText(learner.phone, "N/A")}
            </div>

            <div className="flex items-center gap-2 text-muted-foreground col-span-2">
              <Mail className="w-3.5 h-3.5" />
              {safeText(learner.email, "N/A")}
            </div>
          </div>

          <div className="flex gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-xs">
              <span className="text-muted-foreground">Absence ratio:</span>
              <span
                className={`font-semibold ${
                  (learner.absenceRatio || 0) > 25
                    ? "text-severity-critical"
                    : (learner.absenceRatio || 0) > 15
                      ? "text-severity-overdue"
                      : "text-foreground"
                }`}
              >
                {learner.absenceRatio || 0}%
              </span>
            </div>

            <div className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-xs">
              <span className="text-muted-foreground">Missed (10 wks):</span>
              <span
                className={`font-semibold ${
                  (learner.missedLast10Weeks || 0) >= 3
                    ? "text-severity-critical"
                    : (learner.missedLast10Weeks || 0) >= 2
                      ? "text-severity-overdue"
                      : "text-foreground"
                }`}
              >
                {learner.missedLast10Weeks || 0}
              </span>
            </div>

            <div className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-xs">
              <span className="text-muted-foreground">Missed in row:</span>
              <span
                className={`font-semibold ${
                  (learner.missedInRow || 0) >= 3
                    ? "text-severity-critical"
                    : (learner.missedInRow || 0) >= 2
                      ? "text-severity-overdue"
                      : "text-foreground"
                }`}
              >
                {learner.missedInRow || 0}
              </span>
            </div>
          </div>

          <div className="bg-muted/50 rounded-lg p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" /> OTJ Hours
              </p>

              {otjHoursStatusRaw && (
                <span
                  className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full"
                  style={{ background: otjStatusBg, color: otjStatusColor }}
                >
                  {otjHoursStatusRaw}
                </span>
              )}
            </div>

            <div className="flex items-baseline gap-3 flex-wrap">
              <div className="text-sm">
                <span className="font-semibold text-foreground">{completed}h</span>
                <span className="text-muted-foreground"> completed / {targetNow}h target now</span>
              </div>

              <div className={`text-sm font-semibold ${otjTextColor}`}>
                {behindPct > 0 ? `${behindPct}% behind` : "On track"}
              </div>
            </div>

            <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progressWidth}%` }}
              />
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm mt-4">
              <div>
                <p className="text-muted-foreground text-xs mb-1">Planned total</p>
                <p className="font-semibold text-foreground">{planned}h</p>
              </div>

              <div>
                <p className="text-muted-foreground text-xs mb-1">Target now</p>
                <p className="font-semibold text-foreground">{targetNow}h</p>
              </div>

              <div>
                <p className="text-muted-foreground text-xs mb-1">Completed</p>
                <p className="font-semibold text-foreground">{completed}h</p>
              </div>

              <div>
                <p className="text-muted-foreground text-xs mb-1">Required to submit</p>
                <p className={`font-semibold ${otjTextColor}`}>
                  {requiredHoursToSubmit}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-background p-4">
            <p className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Monthly Coaching Meeting
            </p>

            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs mb-1">Last completed</p>
                <p className="font-semibold text-foreground">{monthlyCoachingLastCompleted}</p>
              </div>

              <div>
                <p className="text-muted-foreground text-xs mb-1">Next due</p>
                <p className="font-semibold text-foreground">{monthlyCoachingNextDue}</p>
                {monthlyCoachingStatusLabel && (
                  <p className="text-[10px] mt-0.5" style={{ color: monthlyCoachingBooked ? "#2E9E5B" : "#C0392B" }}>
                    {monthlyCoachingStatusLabel}
                  </p>
                )}
              </div>

              <div>
                <p className="text-muted-foreground text-xs mb-1">Booked?</p>
                <p className={`font-semibold ${monthlyCoachingBooked ? "text-green-600" : "text-red-500"}`}>
                  {yesNoText(monthlyCoachingBooked)}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-background p-4">
            <p className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
              <Briefcase className="w-4 h-4" />
              Progress Review
            </p>

            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs mb-1">Last completed</p>
                <p className="font-semibold text-foreground">{progressReviewLastCompleted}</p>
              </div>

              <div>
                <p className="text-muted-foreground text-xs mb-1">Next due</p>
                <p className="font-semibold text-foreground">{progressReviewNextDue}</p>
              </div>

              <div>
                <p className="text-muted-foreground text-xs mb-1">Booked?</p>
                <p className={`font-semibold ${progressReviewBooked ? "text-green-600" : "text-red-500"}`}>
                  {yesNoText(progressReviewBooked)}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-background p-4">
            <p className="text-sm font-medium text-foreground mb-4">Key Contacts</p>

            <div className="space-y-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs mb-1">Coach</p>
                <p className="font-semibold text-foreground">{coachName}</p>
                <p className="text-muted-foreground flex items-center gap-1 mt-1">
                  <Phone className="w-3.5 h-3.5" />
                  {coachPhone}
                </p>
                <p className="text-muted-foreground flex items-center gap-1 mt-1">
                  <Mail className="w-3.5 h-3.5" />
                  {coachEmail}
                </p>
              </div>

              <Separator />

              <div>
                <p className="text-muted-foreground text-xs mb-1">Line Manager</p>
                <p className="font-semibold text-foreground">{lineManagerName}</p>
                <p className="text-muted-foreground flex items-center gap-1 mt-1">
                  <Phone className="w-3.5 h-3.5" />
                  {lineManagerPhone}
                </p>
                <p className="text-muted-foreground flex items-center gap-1 mt-1">
                  <Mail className="w-3.5 h-3.5" />
                  {lineManagerEmail}
                </p>
              </div>

              <Separator />

              <div>
                <p className="text-muted-foreground text-xs mb-1">HR Manager</p>
                <p className="font-semibold text-foreground">{hrManagerName}</p>
                <p className="text-muted-foreground flex items-center gap-1 mt-1">
                  <Phone className="w-3.5 h-3.5" />
                  {hrManagerPhone}
                </p>
                <p className="text-muted-foreground flex items-center gap-1 mt-1">
                  <Mail className="w-3.5 h-3.5" />
                  {hrManagerEmail}
                </p>
              </div>
            </div>
          </div>

          <Separator />

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setShowCallLog(!showCallLog)} className="gap-1.5">
              <Phone className="w-3.5 h-3.5" /> Log a Call
            </Button>

            <Button size="sm" variant="outline" className="gap-1.5" onClick={handleSendEmail}>
              <Mail className="w-3.5 h-3.5" /> Send Email
            </Button>

            {(() => {
              const links = getBookingLinks(learner?.coach ?? "");
              const hasAny = links.pr || links.mcm || links.support;
              if (!hasAny) return (
                <Button size="sm" variant="outline" className="gap-1.5" disabled>
                  <Calendar className="w-3.5 h-3.5" /> Book Appointment
                </Button>
              );
              return (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="gap-1.5">
                      <Calendar className="w-3.5 h-3.5" /> Book Appointment
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-52">
                    {links.pr && (
                      <DropdownMenuItem className="cursor-pointer" onSelect={() =>
                        setBookingDraft({ sessionType: "PR", sessionLabel: "Progress Review", url: links.pr!, date: "", time: "", notes: "" })
                      }>
                        📋 Progress Review
                      </DropdownMenuItem>
                    )}
                    {links.mcm && (
                      <DropdownMenuItem className="cursor-pointer" onSelect={() =>
                        setBookingDraft({ sessionType: "MCM", sessionLabel: "Monthly Coaching Meeting", url: links.mcm!, date: "", time: "", notes: "" })
                      }>
                        🗓 Monthly Coaching Meeting
                      </DropdownMenuItem>
                    )}
                    {links.support && (
                      <DropdownMenuItem className="cursor-pointer" onSelect={() =>
                        setBookingDraft({ sessionType: "Support", sessionLabel: "Support Session", url: links.support!, date: "", time: "", notes: "" })
                      }>
                        🤝 Support Session
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            })()}

            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                onResolve?.({
                  contactKey: String((learner as any).attendanceContactKey || ""),
                  email: String((learner as any).attendanceEmail || ""),
                  date: String((learner as any).attendanceDate || ""),
                  module: String((learner as any).attendanceModule || ""),
                  resolved: !Boolean((learner as any).isResolved),
                  note: buildNoteValue(String(callOutcome || ""), callNotes),
                });
              }}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {isResolved ? "Reopen Case" : "Mark Resolved"}
            </Button>
          </div>

          {showCallLog && (
            <div className="bg-muted/50 rounded-lg p-4 space-y-3 animate-fade-in">
              <p className="text-sm font-medium text-foreground">Log Call</p>

              <Select value={callOutcome} onValueChange={(v) => setCallOutcome(v as CallOutcome)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select outcome" />
                </SelectTrigger>
                <SelectContent>
                  {outcomeOptions.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Textarea
                placeholder="Notes..."
                value={callNotes}
                onChange={(e) => setCallNotes(e.target.value)}
                rows={3}
              />

              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveLog}>
                  Save Log
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowCallLog(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {(() => {
            const rawNote = String((learner as any).note || "").trim();
            if (!rawNote) return null;
            const { outcome, details } = splitNoteParts(rawNote);
            const called = Boolean((learner as any).called);
            const emailed = Boolean((learner as any).emailed);
            const contactDate = String((learner as any).attendanceDate || "").trim();
            return (
              <div className="rounded-lg border border-[#E8E0F5] bg-[#FAF7FD] p-3 space-y-1">
                <div className="flex items-center gap-2 mb-1">
                  {called && <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#FFF8EE] text-[#B27715]"><Phone className="w-3 h-3" /> Called</span>}
                  {emailed && <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#F0F7FF] text-[#3B82F6]"><Mail className="w-3 h-3" /> Emailed</span>}
                  {contactDate && <span className="text-[10px] text-[#808080] ml-auto">{contactDate}</span>}
                </div>
                {outcome && <p className="text-xs font-medium text-[#4C4C4C]">{outcome}</p>}
                {details && <p className="text-xs text-[#808080]">{details}</p>}
              </div>
            );
          })()}

          <Separator />

          <div>
            <p className="text-sm font-medium text-foreground mb-3">Contact Log History</p>
            <div className="space-y-3">
              {contactLogs.length === 0 && (
                <p className="text-sm text-muted-foreground">No contact logs recorded yet.</p>
              )}

              {contactLogs.map((log: any) => {
                const sourceLabels: Record<string, string> = {
                  "pr-due": "PR Due",
                  "mcm-due": "MCM Due",
                  "otj-behind": "OTJ Behind",
                  "attendance": "Attendance",
                };
                const dt = new Date(log.createdAt);
                return (
                  <div key={log.id} className="flex gap-3 text-sm">
                    <div className="mt-1 w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
                      {log.actionType === "called" ? <Phone className="w-3.5 h-3.5" /> : <Mail className="w-3.5 h-3.5" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-foreground capitalize">{log.actionType}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {sourceLabels[log.source] || log.source}
                        </span>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {dt.toLocaleDateString()} {dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      {log.outcome && <p className="text-xs font-medium text-[#4C4C4C] mt-0.5">{log.outcome}</p>}
                      {log.notes && <p className="text-muted-foreground text-xs mt-0.5">{log.notes}</p>}
                      {log.coach && <p className="text-xs text-muted-foreground/60 mt-0.5">by {log.coach}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>

    <Dialog open={!!bookingDraft} onOpenChange={(o) => { if (!o) setBookingDraft(null); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-[#4C4C4C]">
            Book {bookingDraft?.sessionLabel}
          </DialogTitle>
        </DialogHeader>

        {bookingDraft && (
          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-[#808080] mb-1">Learner</p>
                <p className="font-medium text-[#4C4C4C]">{learner?.firstName} {learner?.lastName}</p>
              </div>
              <div>
                <p className="text-xs text-[#808080] mb-1">Coach</p>
                <p className="font-medium text-[#4C4C4C]">{learner?.coach}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-[#4C4C4C] block mb-1">Date <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  value={bookingDraft.date}
                  onChange={(e) => setBookingDraft({ ...bookingDraft, date: e.target.value })}
                  className="w-full h-9 rounded-lg border border-[#E4E4E4] px-3 text-sm text-[#4C4C4C] outline-none focus:border-[#866CB6]"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#4C4C4C] block mb-1">Time <span className="text-red-500">*</span></label>
                <input
                  type="time"
                  value={bookingDraft.time}
                  onChange={(e) => setBookingDraft({ ...bookingDraft, time: e.target.value })}
                  className="w-full h-9 rounded-lg border border-[#E4E4E4] px-3 text-sm text-[#4C4C4C] outline-none focus:border-[#866CB6]"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-[#4C4C4C] block mb-1">Notes (optional)</label>
              <textarea
                value={bookingDraft.notes}
                onChange={(e) => setBookingDraft({ ...bookingDraft, notes: e.target.value })}
                rows={2}
                placeholder="Add any notes..."
                className="w-full rounded-lg border border-[#E4E4E4] px-3 py-2 text-sm text-[#4C4C4C] outline-none focus:border-[#866CB6] resize-none"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setBookingDraft(null)}
                className="flex-1 h-9 rounded-lg border border-[#E4E4E4] text-sm text-[#808080] hover:bg-[#F8F8F8]"
              >
                Cancel
              </button>
              <button
                disabled={!bookingDraft.date || !bookingDraft.time}
                onClick={async () => {
                  const draft = bookingDraft;
                  setBookingDraft(null);
                  await fetch("/api/bookings/", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      learnerEmail: learner?.email ?? "",
                      learnerName: `${learner?.firstName ?? ""} ${learner?.lastName ?? ""}`.trim(),
                      coach: learner?.coach ?? "",
                      sessionType: draft.sessionType,
                      date: draft.date,
                      time: draft.time,
                      notes: draft.notes,
                      bookingUrl: draft.url,
                    }),
                  });
                  const starttime = `${draft.date}T${draft.time}:00`;
                  const urlWithTime = `${draft.url}?starttime=${encodeURIComponent(starttime)}`;
                  window.open(urlWithTime, "booking", "width=900,height=700,left=200,top=100");
                }}
                className="flex-1 h-9 rounded-lg text-sm font-semibold text-white disabled:opacity-40"
                style={{ background: "#644d93" }}
              >
                Save & Open Booking
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}