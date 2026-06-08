import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Learner, KpiCategory } from "@/types/dashboard";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, Download, Phone, Mail, ArrowUpDown, X, FileText } from "lucide-react";

interface LearnerTableProps {
  learners: Learner[];
  kpiCategory: KpiCategory;
  onSelectLearner: (learner: Learner) => void;
  sessionTypeFilter?: "All Session Types" | "Progress Review" | "MCM" | "Support Session";
  onSessionTypeFilterChange?: (
    value: "All Session Types" | "Progress Review" | "MCM" | "Support Session"
  ) => void;
  isPastMcrMonth?: boolean;
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
}

const SESSION_TYPE_OPTIONS = [
  "All Session Types",
  "Progress Review",
  "MCM",
  "Support Session",
] as const;

const priorityBadge = (priority: Learner["priority"]) => {
  switch (priority) {
    case "critical":
      return (
        <Badge className="pointer-events-none bg-severity-critical-bg text-severity-critical-foreground border-0 text-[11px]">
          Critical
        </Badge>
      );
    case "high":
      return (
        <Badge className="pointer-events-none bg-severity-overdue-bg text-severity-overdue-foreground border-0 text-[11px]">
          High
        </Badge>
      );
    default:
      return null;
  }
};

const otjPriorityBadge = (priority: string) => {
  switch (priority) {
    case "at-risk":
      return (
        <Badge className="bg-severity-critical-bg text-severity-critical-foreground border-0 text-[11px]">
          At Risk
        </Badge>
      );
    case "need-attention":
      return (
        <Badge className="bg-severity-overdue-bg text-severity-overdue-foreground border-0 text-[11px]">
          Need Attention
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-[11px]">
          Normal
        </Badge>
      );
  }
};

const calcBehindPct = (learner: Learner) => {
  const stored = Number((learner as any).otjBehindPct);
  if (Number.isFinite(stored)) return Math.abs(stored);

  const expected = Number(learner.expectedOtjHours || 0);
  const actual = Number(learner.actualOtjHours || 0);
  if (expected <= 0) return 0;

  return Math.abs(Math.round(((expected - actual) / expected) * 100));
};

const getRequiredHoursToSubmit = (learner: Learner) =>
  String((learner as any).requiredHoursToSubmit || "N/A");

const cleanPrStatusLabel = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const parenthesized = raw.match(/\(([^)]+)\)\s*$/);
  const withoutDate = parenthesized?.[1] || raw;

  return withoutDate.replace(/^\((.*)\)$/, "$1").trim();
};

const splitDateStatusLabel = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw || raw === "N/A") return { date: raw || "N/A", status: "" };
  const match = raw.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (!match) return { date: raw, status: "" };
  return { date: match[1].trim(), status: cleanPrStatusLabel(match[2]) };
};

const getStatusPillStyle = (status: unknown) => {
  const s = String(status || "").toLowerCase();
  if (s.includes("completed")) return { bg: "#EDFAF3", color: "#1A7A4A" };
  if (s.includes("in progress")) return { bg: "#FFF8EE", color: "#B27715" };
  if (s.includes("awaiting signature")) return { bg: "#F5EEFF", color: "#644D93" };
  if (s.includes("scheduled") && !s.includes("not")) return { bg: "#EEF4FF", color: "#3B6FD4" };
  if (s.includes("not")) return { bg: "#FFF0F0", color: "#C0392B" };
  return { bg: "#F5F5F5", color: "#666666" };
};

const getLearnerStatusLabel = (learner: Learner) =>
  String(
    (learner as any).aptemProgramStatusRaw ||
      (learner as any).programStatusRaw ||
      learner.status ||
      "Unknown"
  ).trim() || "Unknown";

const getLearnerStatusPillStyle = (status: unknown) => {
  const s = String(status || "").trim().toLowerCase();
  if (s === "active") return { bg: "#ECFAF6", color: "#0F6F57" };
  if (s.includes("break")) return { bg: "#FFF8E8", color: "#94610A" };
  if (s.includes("withdraw")) return { bg: "#FFF1F3", color: "#B42332" };
  if (s.includes("ready") || s.includes("boarding") || s.includes("review")) {
    return { bg: "#EEF7FF", color: "#184D91" };
  }
  return { bg: "#F3F6FA", color: "#5F748B" };
};

const LearnerStatusBadge = ({ learner }: { learner: Learner }) => {
  const status = getLearnerStatusLabel(learner);
  const style = getLearnerStatusPillStyle(status);

  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold"
      style={{ background: style.bg, color: style.color }}
    >
      {status}
    </span>
  );
};

const DateStatusCell = ({ value }: { value: unknown }) => {
  const { date, status } = splitDateStatusLabel(value);
  if (!date || date === "N/A") return <span className="text-xs text-[#A0A0A0]">N/A</span>;
  const style = getStatusPillStyle(status);
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="text-sm text-[#6F6F6F]">{date}</span>
      {status && (
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ background: style.bg, color: style.color }}
        >
          {status}
        </span>
      )}
    </div>
  );
};

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

const normaliseEmail = (value: unknown) => String(value ?? "").trim().toLowerCase();

type EvidenceItem = {
  id: string;
  title: string;
  body: string;
  meta: string;
  source: string;
};

export default function LearnerTable({
  learners,
  kpiCategory,
  onSelectLearner,
  sessionTypeFilter = "All Session Types",
  onSessionTypeFilterChange,
  isPastMcrMonth = false,
  onUpdateContactAction,
}: LearnerTableProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<string>("lastName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [ticketFilter, setTicketFilter] = useState<"all" | "open" | "closed">("all");
  const [showCallModal, setShowCallModal] = useState(false);
  const [callOutcome, setCallOutcome] = useState("");
  const [callNotes, setCallNotes] = useState("");
  const [callSaving, setCallSaving] = useState(false);
  const [tableContactLogs, setTableContactLogs] = useState<any[]>([]);
  const [evidenceLearner, setEvidenceLearner] = useState<Learner | null>(null);

  useEffect(() => {
    if (kpiCategory === "review-due") {
      setSortField("overduePrCount");
      setSortDir("desc");
    } else if (kpiCategory === "coaching-due" && !isPastMcrMonth) {
      setSortField("overdueMcmCount");
      setSortDir("desc");
    } else {
      setSortField("lastName");
      setSortDir("asc");
    }
  }, [isPastMcrMonth, kpiCategory]);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/contact-log/", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!cancelled) setTableContactLogs(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setTableContactLogs([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleEmailSelected = (sel: Learner[]) => {
    const recipients = sel.map((l) => {
      const la = l as any;
      return {
        learnerName: `${l.firstName || ""} ${l.lastName || ""}`.trim(),
        learnerEmail: l.email || "",
        programme: l.programme || "",
        coachName: l.coach || "",
        coachEmail: la.coachEmail || "",
        lastSessionDate: la.lastMonthlyMeetingDate || l.lastProgressReviewDate || "",
        lineManagerEmail: l.lineManagerEmail || "",
        hrEmail: l.hrManagerEmail || "",
        status: l.status || "Active",
        riskCategories: Array.isArray(l.riskCategories) ? l.riskCategories : [],
      };
    });
    navigate("/email-centre", { state: { selectedRecipients: recipients, source: "learner-table" } });
  };

  const SOURCE_MAP: Record<string, string> = {
    "review-due": "pr-due",
    "coaching-due": "mcm-due",
    "otj-behind": "otj-behind",
    "missed-session": "attendance",
  };

  const handleSaveCallLog = async (sel: Learner[]) => {
    if (!callOutcome) return;
    setCallSaving(true);
    const logSource = SOURCE_MAP[kpiCategory] || "attendance";
    for (const learner of sel) {
      const la = learner as any;
      const email = la.attendanceEmail || learner.email || "";
      const date = la.attendanceDate || "";
      const module = la.attendanceModule || "";
      if (!email) continue;

      if (date && module) {
        const note = callNotes ? `${callOutcome} | ${callNotes}` : callOutcome;
        onUpdateContactAction?.({
          contactKey: la.attendanceContactKey || "",
          email,
          date,
          module,
          called: true,
          emailed: Boolean(la.emailed),
          resolved: Boolean(la.isResolved),
          note,
        });
      } else {
        await fetch("/api/contact-log/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            learnerEmail: email,
            learnerName: `${learner.firstName || ""} ${learner.lastName || ""}`.trim(),
            coach: learner.coach || "",
            actionType: "called",
            outcome: callOutcome,
            notes: callNotes,
            source: logSource,
          }),
        });
      }
    }
    setCallSaving(false);
    setShowCallModal(false);
    setCallOutcome("");
    setCallNotes("");
    setSelected(new Set());
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    const data = learners
      .filter((l) => {
        const isClosedTicket = Boolean((l as any).isResolved);
        if (ticketFilter === "open" && isClosedTicket) return false;
        if (ticketFilter === "closed" && !isClosedTicket) return false;

        const sessionType =
          kpiCategory === "coaching-booked"
            ? String((l as any).anyBookedSessionType || "Unknown").toLowerCase()
            : String((l as any).monthlyCoachingSessionType || "Unknown").toLowerCase();

        const sessionDate =
          kpiCategory === "coaching-booked"
            ? String((l as any).anyBookedSessionDate || "").toLowerCase()
            : String((l as any).monthlyCoachingSessionDate || "").toLowerCase();

        const serviceName = String((l as any).anyBookedServiceName || "").toLowerCase();
        const groupName = String((l as any).anyBookedGroupName || "").toLowerCase();

        const phone = String(l.phone || "").toLowerCase();
        const requiredHoursToSubmit = getRequiredHoursToSubmit(l).toLowerCase();
        const note = String((l as any).note || "").toLowerCase();
        const learnerStatus = getLearnerStatusLabel(l).toLowerCase();

        const matchesSearch =
          !q ||
          `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) ||
          String(l.organisation || "").toLowerCase().includes(q) ||
          String(l.email || "").toLowerCase().includes(q) ||
          phone.includes(q) ||
          String(l.programme || "").toLowerCase().includes(q) ||
          String(l.coach || "").toLowerCase().includes(q) ||
          sessionType.includes(q) ||
          sessionDate.includes(q) ||
          serviceName.includes(q) ||
          groupName.includes(q) ||
          requiredHoursToSubmit.includes(q) ||
          note.includes(q) ||
          learnerStatus.includes(q);

        return matchesSearch;
      })

      .sort((a, b) => {
        let av: any;
        let bv: any;

        if (sortField === "otjBehind") {
          av = calcBehindPct(a);
          bv = calcBehindPct(b);
        } else if (sortField === "overduePrCount") {
          av = Number((a as any).overduePrCount ?? 0);
          bv = Number((b as any).overduePrCount ?? 0);
        } else if (sortField === "overdueMcmCount") {
          av = Number((a as any).overdueMcmCount ?? 0);
          bv = Number((b as any).overdueMcmCount ?? 0);
        } else if (sortField === "sessionType") {
          av =
            kpiCategory === "coaching-booked"
              ? String((a as any).anyBookedSessionType || "")
              : String((a as any).monthlyCoachingSessionType || "");

          bv =
            kpiCategory === "coaching-booked"
              ? String((b as any).anyBookedSessionType || "")
              : String((b as any).monthlyCoachingSessionType || "");
        } else if (sortField === "sessionDate") {
          av =
            kpiCategory === "coaching-booked"
              ? String((a as any).anyBookedSessionDate || "")
              : String((a as any).monthlyCoachingSessionDate || "");

          bv =
            kpiCategory === "coaching-booked"
              ? String((b as any).anyBookedSessionDate || "")
              : String((b as any).monthlyCoachingSessionDate || "");
        } else if (sortField === "nextMonthlyMeetingDue") {
          const parseDMY = (val: string) => {
            const parts = String(val || "").split("-");
            if (parts.length === 3) {
              const dt = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
              if (!isNaN(dt.getTime())) return dt.getTime();
            }
            return 0;
          };
          av = parseDMY(String((a as any).nextMonthlyMeetingDue || ""));
          bv = parseDMY(String((b as any).nextMonthlyMeetingDue || ""));
        } else {
          av = (a as any)[sortField] || "";
          bv = (b as any)[sortField] || "";
        }

        if (av < bv) return sortDir === "asc" ? -1 : 1;
        if (av > bv) return sortDir === "asc" ? 1 : -1;
        return 0;
      });

    return data;
  }, [learners, search, sessionTypeFilter, sortField, sortDir, kpiCategory, ticketFilter]);


  const getRowKey = (l: Learner) => {
    const anyLearner = l as any;

    return [
      kpiCategory,
      l.id,
      anyLearner.attendanceContactKey || "",
      anyLearner.anyBookedSessionType || "",
      anyLearner.anyBookedSessionDate || "",
      anyLearner.anyBookedServiceName || "",
      anyLearner.nextMonthlyMeetingDue || "",
      anyLearner.nextMonthlyMeetingStatus || "",
    ].join("::");
  };

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const sortPresetValue = `${sortField}:${sortDir}`;
  const handleSortPresetChange = (value: string) => {
    const [field, direction] = value.split(":");
    setSortField(field);
    setSortDir(direction === "desc" ? "desc" : "asc");
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((l) => l.id)));
  };

  const contactLogsByEmail = useMemo(() => {
    const map = new Map<string, any[]>();

    for (const log of tableContactLogs) {
      const email = normaliseEmail(log?.learnerEmail);
      if (!email) continue;
      const items = map.get(email) || [];
      items.push(log);
      map.set(email, items);
    }

    for (const items of map.values()) {
      items.sort((a, b) =>
        String(b?.createdAt || "").localeCompare(String(a?.createdAt || ""))
      );
    }

    return map;
  }, [tableContactLogs]);

  const getLearnerEvidenceItems = (learner: Learner): EvidenceItem[] => {
    const items: EvidenceItem[] = [];
    const email = normaliseEmail(learner.email || (learner as any).attendanceEmail);

    const currentNote = String((learner as any).note || "").trim();
    if (currentNote) {
      const parts = splitNoteParts(currentNote);
      items.push({
        id: "current-note",
        title: parts.outcome || "Ticket note",
        body: parts.details || parts.outcome || currentNote,
        meta: String((learner as any).attendanceDate || "Current ticket"),
        source: "Dashboard",
      });
    }

    const logs = contactLogsByEmail.get(email) || [];
    for (const log of logs) {
      const outcome = String(log?.outcome || "").trim();
      const notes = String(log?.notes || "").trim();
      const body = notes || outcome;
      if (!body) continue;

      const created = log?.createdAt ? new Date(log.createdAt) : null;
      const createdText =
        created && !Number.isNaN(created.getTime())
          ? `${created.toLocaleDateString()} ${created.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}`
          : "No date";

      items.push({
        id: String(log?.id || `${email}-${createdText}-${items.length}`),
        title: outcome || "Contact note",
        body,
        meta: createdText,
        source: String(log?.source || "contact-log"),
      });
    }

    return items;
  };

  const renderEvidenceButton = (learner: Learner) => {
    const evidenceItems = getLearnerEvidenceItems(learner);
    const count = evidenceItems.length;

    if (!count) {
      return <span className="text-xs text-[#A0A0A0]">-</span>;
    }

    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setEvidenceLearner(learner);
        }}
        className="inline-flex h-8 min-w-12 items-center justify-center gap-1 rounded-full border border-[#BCEBDE] bg-[#ECFAF6] px-2.5 text-xs font-bold text-[#0F6F57] transition-colors hover:bg-[#DDF7EF]"
        title="View evidence"
      >
        <FileText className="h-3.5 w-3.5" />
        {count}
      </button>
    );
  };

  const handleExport = (rowsToExport: Learner[] = filtered, suffix = "learners") => {
    let headers: string[] = [];
    let rows: any[][] = [];

    if (kpiCategory === "coaching-booked") {
      headers = [
        "Name",
        "Phone",
        "Status",
        "Organisation",
        "Programme",
        "Coach",
        "Booked MCM Date",
        "MCM Status",
      ];

      rows = rowsToExport.map((l) => [
        `${l.firstName} ${l.lastName}`,
        l.phone || "N/A",
        getLearnerStatusLabel(l),
        l.organisation,
        l.programme,
        l.coach,
        (l as any).bookedMcmDate || "N/A",
        (l as any).bookedMcmStatus || "",
      ]);
    } else if (kpiCategory === "review-booked") {
      headers = [
        "Name",
        "Phone",
        "Status",
        "Organisation",
        "Programme",
        "Coach",
        "Email",
        "Booked PR Date",
        "PR Status",
      ];

      rows = rowsToExport.map((l) => [
        `${l.firstName} ${l.lastName}`,
        l.phone || "N/A",
        getLearnerStatusLabel(l),
        l.organisation,
        l.programme,
        l.coach,
        l.email,
        (l as any).bookedPrDate || "N/A",
        cleanPrStatusLabel((l as any).bookedPrStatus) || "N/A",
      ]);
    } else if (kpiCategory === "review-due") {
      headers = [
        "Name",
        "Phone",
        "Status",
        "Organisation",
        "Programme",
        "Coach",
        "Email",
        "Evidence Count",
        "Evidence Notes",
        "Last Progress Review",
        "Why shown",
        "Next PR",
        "No. of overdue PR",
        "Booked Date",
        "Review Status",
      ];

      rows = rowsToExport.map((l) => [
        `${l.firstName} ${l.lastName}`,
        l.phone || "N/A",
        getLearnerStatusLabel(l),
        l.organisation,
        l.programme,
        l.coach,
        l.email,
        getLearnerEvidenceItems(l).length,
        getLearnerEvidenceItems(l).map((item) => item.body).join(" | "),
        l.lastProgressReviewDate || "N/A",
        (l as any).prMatchReason || "N/A",
        (l as any).nextPrDate || (l as any).nextProgressReviewDue || "N/A",
        Number((l as any).overduePrCount ?? 0),
        (l as any).bookedPrDate || "N/A",
        (l as any).reviewStatusLabel || "Normal",
      ]);
    } else if (kpiCategory === "otj-behind") {
      headers = [
        "Name",
        "Phone",
        "Status",
        "Organisation",
        "Programme",
        "Coach",
        "Email",
        "Behind %",
        "Planned",
        "Completed",
        "Required Hours to submit",
        "Last Progress Review",
      ];

      rows = rowsToExport.map((l) => [
        `${l.firstName} ${l.lastName}`,
        l.phone || "N/A",
        getLearnerStatusLabel(l),
        l.organisation,
        l.programme,
        l.coach,
        l.email,
        `${calcBehindPct(l)}%`,
        l.plannedOtjHours,
        l.actualOtjHours,
        getRequiredHoursToSubmit(l),
        l.lastProgressReviewDate || "",
      ]);
    } else if (kpiCategory === "missed-session") {
      headers = [
        "Name",
        "Phone",
        "Status",
        "Called",
        "Emailed",
        "Resolved",
        "Note",
        "Booked Meeting",
        "Organisation",
        "Programme",
        "Coach",
        "Last Session",
        "Session Status",
        "Priority",
      ];

      rows = rowsToExport.map((l) => [
        `${l.firstName} ${l.lastName}`,
        l.phone || "N/A",
        getLearnerStatusLabel(l),
        Boolean((l as any).called) ? "Yes" : "No",
        Boolean((l as any).emailed) ? "Yes" : "No",
        Boolean((l as any).isResolved) ? "Yes" : "No",
        String((l as any).note || ""),
        Boolean((l as any).anyBooked) ? String((l as any).anyBookedSessionDate || "") : "",
        l.organisation,
        l.programme,
        l.coach,
        l.lastSessionDate || "N/A",
        l.lastSessionStatus || "Unknown",
        l.priority || "",
      ]);
    } else if (kpiCategory === "coaching-due") {
      headers = [
        "Name",
        "Phone",
        "Status",
        "Organisation",
        "Programme",
        "Coach",
        "Email",
        isPastMcrMonth ? "Meeting Date" : "Required Date",
        "MCM Status",
        ...(isPastMcrMonth ? [] : ["Overdue MCMs"]),
      ];

      rows = rowsToExport.map((l) => [
        `${l.firstName} ${l.lastName}`,
        l.phone || "N/A",
        getLearnerStatusLabel(l),
        l.organisation,
        l.programme,
        l.coach,
        l.email,
        String((l as any).nextMonthlyMeetingDue || (isPastMcrMonth ? "N/A" : "Required")),
        String((l as any).nextMonthlyMeetingStatus || ""),
        ...(isPastMcrMonth ? [] : [Number((l as any).overdueMcmCount ?? 0)]),
      ]);
    } else {
      headers = [
        "Name",
        "Phone",
        "Status",
        "Organisation",
        "Programme",
        "Coach",
        "Email",
      ];

      rows = rowsToExport.map((l) => [
        `${l.firstName} ${l.lastName}`,
        l.phone || "N/A",
        getLearnerStatusLabel(l),
        l.organisation,
        l.programme,
        l.coach,
        l.email,
      ]);
    }

    const csv = [headers, ...rows]
      .map((r) => r.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${kpiCategory}-${suffix}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectedRows = filtered.filter((l) => selected.has(l.id));
  const openTicketCount = useMemo(
    () => learners.filter((l) => !Boolean((l as any).isResolved)).length,
    [learners]
  );
  const closedTicketCount = useMemo(
    () => learners.filter((l) => Boolean((l as any).isResolved)).length,
    [learners]
  );

  const tableSummary = useMemo(() => {
    const statusIncludes = (value: unknown, text: string) =>
      String(value || "").toLowerCase().includes(text);

    if (kpiCategory === "review-due") {
      return [
        {
          label: "Scheduled",
          value: filtered.filter((l) =>
            statusIncludes((l as any).prMatchReason || (l as any).nextPrState, "scheduled") &&
            !statusIncludes((l as any).prMatchReason, "not scheduled")
          ).length,
          tone: "blue",
        },
        {
          label: "Not Scheduled",
          value: filtered.filter((l) =>
            statusIncludes((l as any).prMatchReason || (l as any).nextPrState, "not scheduled")
          ).length,
          tone: "red",
        },
        {
          label: "Overdue PR",
          value: filtered.filter((l) => Number((l as any).overduePrCount ?? 0) > 0).length,
          tone: "amber",
        },
      ];
    }

    if (kpiCategory === "review-booked") {
      return [
        {
          label: "Completed",
          value: filtered.filter((l) => statusIncludes((l as any).bookedPrStatus, "completed")).length,
          tone: "green",
        },
        {
          label: "Awaiting Signature",
          value: filtered.filter((l) => statusIncludes((l as any).bookedPrStatus, "awaiting signature")).length,
          tone: "purple",
        },
        {
          label: "Scheduled",
          value: filtered.filter((l) =>
            statusIncludes((l as any).bookedPrStatus, "scheduled") &&
            !statusIncludes((l as any).bookedPrStatus, "not")
          ).length,
          tone: "blue",
        },
      ];
    }

    if (kpiCategory === "coaching-due") {
      return [
        {
          label: isPastMcrMonth ? "Meetings in period" : "Required",
          value: filtered.length,
          tone: "purple",
        },
        {
          label: "Scheduled",
          value: filtered.filter((l) =>
            statusIncludes((l as any).nextMonthlyMeetingStatus, "scheduled") &&
            !statusIncludes((l as any).nextMonthlyMeetingStatus, "not")
          ).length,
          tone: "blue",
        },
        {
          label: "Not Scheduled",
          value: filtered.filter((l) => statusIncludes((l as any).nextMonthlyMeetingStatus, "not scheduled")).length,
          tone: "red",
        },
      ];
    }

    if (kpiCategory === "coaching-booked") {
      return [
        {
          label: "Completed",
          value: filtered.filter((l) => statusIncludes((l as any).bookedMcmStatus, "completed")).length,
          tone: "green",
        },
        {
          label: "In Progress",
          value: filtered.filter((l) => statusIncludes((l as any).bookedMcmStatus, "in progress")).length,
          tone: "amber",
        },
        {
          label: "Scheduled",
          value: filtered.filter((l) =>
            statusIncludes((l as any).bookedMcmStatus, "scheduled") &&
            !statusIncludes((l as any).bookedMcmStatus, "not")
          ).length,
          tone: "blue",
        },
      ];
    }

    if (kpiCategory === "missed-session") {
      return [
        { label: "Called", value: filtered.filter((l) => Boolean((l as any).called)).length, tone: "green" },
        { label: "Emailed", value: filtered.filter((l) => Boolean((l as any).emailed)).length, tone: "blue" },
        { label: "Unresolved", value: filtered.filter((l) => !Boolean((l as any).isResolved)).length, tone: "red" },
      ];
    }

    if (kpiCategory === "otj-behind") {
      return [
        { label: "At Risk", value: filtered.filter((l) => String((l as any).otjHoursStatus || "").toLowerCase() === "at risk").length, tone: "red" },
        { label: "Need Attention", value: filtered.filter((l) => String((l as any).otjHoursStatus || "").toLowerCase() === "need attention").length, tone: "amber" },
        {
          label: "Avg behind",
          value: filtered.length ? `${Math.round(filtered.reduce((sum, l) => sum + calcBehindPct(l), 0) / filtered.length)}%` : "0%",
          tone: "purple",
        },
      ];
    }

    return [];
  }, [filtered, kpiCategory, isPastMcrMonth]);

  const summaryToneClass = (tone: string) => {
    switch (tone) {
      case "green":
        return "bg-[#ECFAF6] text-[#0F6F57] ring-[#BCEBDE]";
      case "blue":
        return "bg-[#EEF7FF] text-[#184D91] ring-[#B8D7F2]";
      case "red":
        return "bg-[#FFF1F3] text-[#B42332] ring-[#FFD4DA]";
      case "amber":
        return "bg-[#FFF8E8] text-[#94610A] ring-[#F1D79D]";
      case "purple":
      default:
        return "bg-[#F3F0FF] text-[#5440A3] ring-[#DCD6FF]";
    }
  };

  const colSpan =
    kpiCategory === "otj-behind"
      ? 12
      : kpiCategory === "missed-session"
        ? 15
        : kpiCategory === "review-due"
          ? 15
        : kpiCategory === "coaching-due"
            ? isPastMcrMonth ? 9 : 10
            : kpiCategory === "coaching-booked"
              ? 9
              : 8;
  const headerCellClass = "sticky top-0 z-40 bg-[#F8FBFE] p-3 text-left font-semibold text-[#5F748B]";
  const headerCellCenterClass = "sticky top-0 z-40 bg-[#F8FBFE] p-3 text-center font-semibold text-[#5F748B]";
  const headerCellRightClass = "sticky top-0 z-40 bg-[#F8FBFE] p-3 text-right font-semibold text-[#5F748B]";
  const evidenceItems = evidenceLearner ? getLearnerEvidenceItems(evidenceLearner) : [];

  return (
    <div className="animate-fade-in rounded-lg border border-[#DDE7F0] bg-white p-3 shadow-[0_8px_22px_rgba(20,38,74,0.05)] sm:p-4">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-[360px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#71849A]" />
            <Input
              type="search"
              name="learner_lookup"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Search by name, employer, email, phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 rounded-lg border-[#D7E5F3] bg-[#F8FBFE] pl-10 pr-4 text-sm text-[#20344D] placeholder:text-[#8FA1B4] focus-visible:border-[#1E6ACB] focus-visible:ring-2 focus-visible:ring-[#1E6ACB]/20"
            />
          </div>

          {kpiCategory === "review-due" && (
            <Select value={sortPresetValue} onValueChange={handleSortPresetChange}>
              <SelectTrigger className="h-10 w-full rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm text-[#20344D] sm:w-[230px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="overduePrCount:desc">Most overdue PR</SelectItem>
                <SelectItem value="overduePrCount:asc">Least overdue PR</SelectItem>
                <SelectItem value="lastName:asc">Learner A-Z</SelectItem>
                <SelectItem value="lastName:desc">Learner Z-A</SelectItem>
              </SelectContent>
            </Select>
          )}

          {kpiCategory === "coaching-due" && !isPastMcrMonth && (
            <Select value={sortPresetValue} onValueChange={handleSortPresetChange}>
              <SelectTrigger className="h-10 w-full rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm text-[#20344D] sm:w-[240px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="overdueMcmCount:desc">Most overdue MCM</SelectItem>
                <SelectItem value="overdueMcmCount:asc">Least overdue MCM</SelectItem>
                <SelectItem value="lastName:asc">Learner A-Z</SelectItem>
                <SelectItem value="lastName:desc">Learner Z-A</SelectItem>
              </SelectContent>
            </Select>
          )}

          <div className="flex w-full gap-2 sm:w-auto">
            <Button
              type="button"
              variant="outline"
              onClick={() => setTicketFilter((value) => (value === "open" ? "all" : "open"))}
              className={`h-10 flex-1 rounded-lg px-3 text-sm font-bold sm:flex-none ${
                ticketFilter === "open"
                  ? "border-[#14264A] bg-[#14264A] text-white shadow-[0_8px_18px_rgba(20,38,74,0.22)] hover:bg-[#0D1B36] hover:text-white"
                  : "border-[#184D91] bg-[#184D91] text-white shadow-[0_8px_18px_rgba(24,77,145,0.18)] hover:bg-[#14264A] hover:text-white"
              }`}
            >
              Open Ticket
              <span className="ml-2 rounded-full bg-white/18 px-2 py-0.5 text-xs text-white">
                {openTicketCount}
              </span>
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => setTicketFilter((value) => (value === "closed" ? "all" : "closed"))}
              className={`h-10 flex-1 rounded-lg px-3 text-sm font-bold sm:flex-none ${
                ticketFilter === "closed"
                  ? "border-[#0B5D49] bg-[#0B5D49] text-white shadow-[0_8px_18px_rgba(15,111,87,0.22)] hover:bg-[#084536] hover:text-white"
                  : "border-[#0F6F57] bg-[#0F6F57] text-white shadow-[0_8px_18px_rgba(15,111,87,0.18)] hover:bg-[#0B5D49] hover:text-white"
              }`}
            >
              Closed Ticket
              <span className="ml-2 rounded-full bg-white/18 px-2 py-0.5 text-xs text-white">
                {closedTicketCount}
              </span>
            </Button>
          </div>

        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleExport()}
            className="h-10 gap-1.5 rounded-lg border-[#BFD4E7] bg-[#EEF7FF] text-[#1E6ACB] hover:bg-[#DFF0FF] hover:text-[#184D91]"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      {tableSummary.length > 0 && (
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {tableSummary.map((item) => (
            <div
              key={item.label}
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ring-1 ${summaryToneClass(item.tone)}`}
            >
              <span className="font-medium">{item.label}</span>
              <span className="text-base font-bold tabular-nums">{item.value}</span>
            </div>
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <div className="mb-3 flex flex-col gap-2 rounded-lg border border-[#B8D7F2] bg-[#EEF7FF] p-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="px-2 text-sm font-semibold text-[#184D91]">
            {selected.size} selected
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleEmailSelected(selectedRows)}
              className="h-9 gap-1.5 rounded-lg border-[#D7E5F3] bg-white text-[#184D91] hover:bg-[#F8FBFE] hover:text-[#14264A]"
            >
              <Mail className="h-3.5 w-3.5" />
              Email
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => { setCallOutcome(""); setCallNotes(""); setShowCallModal(true); }}
              className="h-9 gap-1.5 rounded-lg border-[#D7E5F3] bg-white text-[#94610A] hover:bg-[#FFF8E8] hover:text-[#94610A]"
            >
              <Phone className="h-3.5 w-3.5" />
              Call
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => handleExport(selectedRows, "selected-learners")}
              className="h-9 gap-1.5 rounded-lg border-[#D7E5F3] bg-white text-[#1E6ACB] hover:bg-[#F8FBFE] hover:text-[#184D91]"
            >
              <Download className="h-3.5 w-3.5" />
              Export selected
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
              className="h-9 gap-1.5 rounded-lg text-[#71849A] hover:bg-white hover:text-[#20344D]"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-[#DDE7F0] bg-white">
        <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-280px)]">
          <table className="min-w-[1120px] w-full text-sm">
            <thead>
              <tr className="border-b border-[#DDE7F0] bg-[#F8FBFE]">
                <th className="sticky left-0 top-0 z-50 w-12 bg-[#F8FBFE] p-3" aria-label="Select learners" />

                <th
                  className="sticky left-12 top-0 z-50 min-w-[180px] cursor-pointer bg-[#F8FBFE] p-3 text-left font-semibold text-[#5F748B] shadow-[6px_0_12px_-10px_rgba(20,38,74,0.45),1px_0_0_#DDE7F0]"
                  onClick={() => toggleSort("lastName")}
                >
                  <span className="flex items-center gap-1">
                    Learner <ArrowUpDown className="w-3 h-3" />
                  </span>
                </th>

                <th className="sticky top-0 z-40 bg-[#F8FBFE] px-4 py-3 text-left text-[13px] font-semibold text-[#5F748B]">
                  Learner Phone
                </th>
                <th className={headerCellClass}>Status</th>

                {kpiCategory === "missed-session" && (
                  <>
                    <th className={headerCellClass}>Called</th>
                    <th className={headerCellClass}>Emailed</th>
                    <th className={headerCellClass}>Resolved</th>
                    <th className={headerCellClass}>Note</th>
                    <th className={headerCellClass}>Booked Meeting</th>
                  </>
                )}

                <th className={headerCellClass}>Organisation</th>
                <th className={headerCellClass}>Programme</th>
                <th className={headerCellClass}>Coach</th>

                {kpiCategory === "otj-behind" && (
                  <>
                    <th
                      className={`${headerCellRightClass} cursor-pointer`}
                      onClick={() => toggleSort("otjBehind")}
                    >
                      <span className="flex items-center gap-1 justify-end">
                        Behind % <ArrowUpDown className="w-3 h-3" />
                      </span>
                    </th>
                    <th className={headerCellRightClass}>Planned</th>
                    <th className={headerCellRightClass}>Completed</th>
                    <th className={headerCellRightClass}>
                      Required Hours to submit
                    </th>
                  </>
                )}

                {kpiCategory === "missed-session" && (
                  <>
                    <th className={headerCellClass}>Last Session</th>
                    <th className={headerCellClass}>Session Status</th>
                  </>
                )}

                {kpiCategory === "review-due" && (
                  <>
                    <th className={headerCellClass}>Evidence</th>
                    <th className={headerCellClass}>Last Progress Review</th>
                    <th className={headerCellClass}>Why shown</th>
                    <th className={headerCellClass}>Next PR</th>
                    <th
                      className={`${headerCellClass} cursor-pointer`}
                      onClick={() => toggleSort("overduePrCount")}
                    >
                      <span className="flex items-center gap-1">
                        No. of overdue PR <ArrowUpDown className="w-3 h-3" />
                      </span>
                    </th>
                    <th className={headerCellClass}>Booked Date</th>
                    <th className={headerCellClass}>Review Status</th>
                  </>
                )}

                {kpiCategory === "coaching-due" && (
                  <>
                    <th
                      className={`${headerCellClass} cursor-pointer`}
                      onClick={() => toggleSort("nextMonthlyMeetingDue")}
                    >
                      <span className="flex items-center gap-1">
                        {isPastMcrMonth ? "Meeting Date" : "Required Date"} <ArrowUpDown className="w-3 h-3" />
                      </span>
                    </th>
                    <th className={headerCellClass}>MCM Status</th>
                    {!isPastMcrMonth && (
                      <th
                        className={`${headerCellCenterClass} cursor-pointer`}
                        onClick={() => toggleSort("overdueMcmCount")}
                      >
                        <span className="flex items-center justify-center gap-1">
                          Overdue MCMs <ArrowUpDown className="w-3 h-3" />
                        </span>
                      </th>
                    )}
                  </>
                )}

                {kpiCategory === "coaching-booked" && (
                  <>
                    <th className={headerCellClass}>Booked MCM Date</th>
                    <th className={headerCellClass}>MCM Status</th>
                  </>
                )}

                {kpiCategory === "review-booked" && (
                  <>
                    <th className={headerCellClass}>Booked PR Date</th>
                    <th className={headerCellClass}>PR Status</th>
                  </>
                )}

                {kpiCategory !== "coaching-booked" && kpiCategory !== "coaching-due" && kpiCategory !== "review-due" && kpiCategory !== "review-booked" && kpiCategory !== "status-view" && (
                  <th className={headerCellClass}>
                    {kpiCategory === "otj-behind" ? "Status" : "Priority"}
                  </th>
                )}
              </tr>
            </thead>

            <tbody>
              {filtered.map((l) => {
                const behindPct = calcBehindPct(l);
                const noteParts = splitNoteParts((l as any).note);

                if (kpiCategory === "missed-session") {
                  return (
                    <tr
                      key={getRowKey(l)}
                      className="group cursor-pointer border-b border-[#F4F4F4] transition-colors hover:bg-[#FCFCFC]"
                      onClick={() => onSelectLearner(l)}
                    >
                      <td className="sticky left-0 z-10 w-12 bg-white p-3 transition-colors group-hover:bg-[#FCFCFC]" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(l.id)}
                          onCheckedChange={() => {
                            const next = new Set(selected);
                            next.has(l.id) ? next.delete(l.id) : next.add(l.id);
                            setSelected(next);
                          }}
                        />
                      </td>

                      <td className="sticky left-12 z-10 min-w-[180px] bg-white px-4 py-3.5 font-medium text-[#20344D] shadow-[6px_0_12px_-10px_rgba(20,38,74,0.35),1px_0_0_#DDE7F0] transition-colors group-hover:bg-[#F8FBFE]">
                        <div className="flex items-center gap-2">
                          {l.firstName} {l.lastName}
                          {(l as any).isResolved && (
                            <Badge className="border-0 bg-green-100 text-green-700 text-[11px]">
                              Resolved
                            </Badge>
                          )}
                        </div>
                      </td>

                      <td className="p-3 text-muted-foreground">{l.phone || "N/A"}</td>
                      <td className="p-3">
                        <LearnerStatusBadge learner={l} />
                      </td>

                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={Boolean((l as any).called)}
                          onCheckedChange={(checked) => {
                            onUpdateContactAction?.({
                              contactKey: String((l as any).attendanceContactKey || ""),
                              email: String((l as any).attendanceEmail || ""),
                              date: String((l as any).attendanceDate || ""),
                              module: String((l as any).attendanceModule || ""),
                              called: Boolean(checked),
                              emailed: Boolean((l as any).emailed),
                              resolved: Boolean((l as any).isResolved),
                              note: String((l as any).note || ""),
                            });
                          }}
                        />
                      </td>

                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={Boolean((l as any).emailed)}
                          onCheckedChange={(checked) => {
                            onUpdateContactAction?.({
                              contactKey: String((l as any).attendanceContactKey || ""),
                              email: String((l as any).attendanceEmail || ""),
                              date: String((l as any).attendanceDate || ""),
                              module: String((l as any).attendanceModule || ""),
                              called: Boolean((l as any).called),
                              emailed: Boolean(checked),
                              resolved: Boolean((l as any).isResolved),
                              note: String((l as any).note || ""),
                            });
                          }}
                        />
                      </td>

                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={Boolean((l as any).isResolved)}
                          onCheckedChange={(checked) => {
                            onUpdateContactAction?.({
                              contactKey: String((l as any).attendanceContactKey || ""),
                              email: String((l as any).attendanceEmail || ""),
                              date: String((l as any).attendanceDate || ""),
                              module: String((l as any).attendanceModule || ""),
                              called: Boolean((l as any).called),
                              emailed: Boolean((l as any).emailed),
                              resolved: Boolean(checked),
                              note: String((l as any).note || ""),
                            });
                          }}
                        />
                      </td>

                      <td className="p-3 min-w-[240px] max-w-[280px]" onClick={(e) => e.stopPropagation()}>
                        {String((l as any).note || "").trim() ? (
                          <div className="flex flex-col gap-1">
                            <span className="inline-flex w-fit rounded-full bg-[#FFF8E8] px-2 py-1 text-[11px] font-medium text-[#94610A]">
                              {noteParts.outcome || "Logged"}
                            </span>
                            {noteParts.details ? (
                              <p
                                className="text-xs text-[#5F748B] line-clamp-2"
                                title={noteParts.details}
                              >
                                {noteParts.details}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-xs text-[#A0A0A0]">No log</span>
                        )}
                      </td>

                      <td className="p-3 min-w-[140px]" onClick={(e) => e.stopPropagation()}>
                        {Boolean((l as any).anyBooked) && String((l as any).anyBookedSessionDate || "").trim() ? (
                          <Badge className="pointer-events-none rounded-full border-0 bg-[#EEF7FF] px-3 py-1 text-[11px] font-medium text-[#184D91]">
                            {String((l as any).anyBookedSessionDate)}
                          </Badge>
                        ) : (
                          <span className="text-xs text-[#A0A0A0]">Not booked</span>
                        )}
                      </td>

                      <td className="px-4 py-3.5 text-[#7C7C7C]">{l.organisation}</td>
                      <td className="p-3 text-muted-foreground">{l.programme}</td>
                      <td className="p-3 text-muted-foreground">{l.coach}</td>
                      <td className="p-3 text-muted-foreground">{l.lastSessionDate}</td>

                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={
                            l.lastSessionStatus === "Attended"
                              ? "text-[11px] border-emerald-300 text-emerald-700 bg-emerald-50"
                              : l.lastSessionStatus === "Missed"
                                ? "text-[11px] border-rose-300 text-rose-700 bg-rose-50"
                                : "text-[11px] border-slate-300 text-slate-600 bg-slate-50"
                          }
                        >
                          {l.lastSessionStatus}
                        </Badge>
                      </td>

                      <td className="p-3">{priorityBadge(l.priority)}</td>
                    </tr>
                  );
                }

                if (kpiCategory === "coaching-booked") {
                  return (
                    <tr
                      key={getRowKey(l)}
                      className="group cursor-pointer border-b border-[#F4F4F4] transition-colors hover:bg-[#FCFCFC]"
                      onClick={() => onSelectLearner(l)}
                    >
                      <td className="sticky left-0 z-10 w-12 bg-white p-3 transition-colors group-hover:bg-[#FCFCFC]" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(l.id)}
                          onCheckedChange={() => {
                            const next = new Set(selected);
                            next.has(l.id) ? next.delete(l.id) : next.add(l.id);
                            setSelected(next);
                          }}
                        />
                      </td>
                      <td className="sticky left-12 z-10 min-w-[180px] bg-white px-4 py-3.5 font-medium text-[#20344D] shadow-[6px_0_12px_-10px_rgba(20,38,74,0.35),1px_0_0_#DDE7F0] transition-colors group-hover:bg-[#F8FBFE]">
                        {l.firstName} {l.lastName}
                      </td>
                      <td className="p-3 text-muted-foreground">{l.phone || "N/A"}</td>
                      <td className="p-3">
                        <LearnerStatusBadge learner={l} />
                      </td>
                      <td className="px-4 py-3.5 text-[#7C7C7C]">{l.organisation}</td>
                      <td className="p-3 text-muted-foreground">{l.programme}</td>
                      <td className="p-3 text-muted-foreground">{l.coach}</td>
                      <td className="p-3 min-w-[140px]">
                        {(l as any).bookedMcmDate ? (
                          <Badge className="pointer-events-none rounded-full border-0 bg-[#ECFAF6] px-3 py-1 text-[11px] font-medium text-[#0F6F57]">
                            {(l as any).bookedMcmDate}
                          </Badge>
                        ) : (
                          <span className="text-xs text-[#A0A0A0]">N/A</span>
                        )}
                      </td>
                      <td className="p-3 min-w-[160px]">
                        {(() => {
                          const st = String((l as any).bookedMcmStatus || "").trim();
                          if (!st) return <span className="text-xs text-[#A0A0A0]">-</span>;
                          const stL = st.toLowerCase();
                          const { bg, color } =
                            stL.includes("completed")
                              ? { bg: "#ECFAF6", color: "#0F6F57" }
                              : stL.includes("in progress")
                              ? { bg: "#FFF8E8", color: "#94610A" }
                              : stL.includes("awaiting signature")
                              ? { bg: "#F3F0FF", color: "#5440A3" }
                              : stL.includes("scheduled") && !stL.includes("not")
                              ? { bg: "#EEF7FF", color: "#184D91" }
                              : { bg: "#F3F6FA", color: "#5F748B" };
                          return (
                            <span
                              className="inline-flex rounded-xl px-3 py-1 text-[11px] font-medium"
                              style={{ background: bg, color }}
                            >
                              {st}
                            </span>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                }

                if (kpiCategory === "review-booked") {
                  return (
                    <tr
                      key={getRowKey(l)}
                      className="group cursor-pointer border-b border-[#F4F4F4] transition-colors hover:bg-[#FCFCFC]"
                      onClick={() => onSelectLearner(l)}
                    >
                      <td className="sticky left-0 z-10 w-12 bg-white p-3 transition-colors group-hover:bg-[#FCFCFC]" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(l.id)}
                          onCheckedChange={() => {
                            const next = new Set(selected);
                            next.has(l.id) ? next.delete(l.id) : next.add(l.id);
                            setSelected(next);
                          }}
                        />
                      </td>
                      <td className="sticky left-12 z-10 min-w-[180px] bg-white px-4 py-3.5 font-medium text-[#20344D] shadow-[6px_0_12px_-10px_rgba(20,38,74,0.35),1px_0_0_#DDE7F0] transition-colors group-hover:bg-[#F8FBFE]">
                        {l.firstName} {l.lastName}
                      </td>
                      <td className="p-3 text-muted-foreground">{l.phone || "N/A"}</td>
                      <td className="p-3">
                        <LearnerStatusBadge learner={l} />
                      </td>
                      <td className="px-4 py-3.5 text-[#7C7C7C]">{l.organisation}</td>
                      <td className="p-3 text-muted-foreground">{l.programme}</td>
                      <td className="p-3 text-muted-foreground">{l.coach}</td>
                      <td className="p-3 min-w-[140px]">
                        {(l as any).bookedPrDate ? (
                          <Badge className="pointer-events-none rounded-full border-0 bg-[#FFF8E8] px-3 py-1 text-[11px] font-medium text-[#94610A]">
                            {(l as any).bookedPrDate}
                          </Badge>
                        ) : (
                          <span className="text-xs text-[#A0A0A0]">N/A</span>
                        )}
                      </td>
                      <td className="p-3 min-w-[160px]">
                        {(() => {
                          const st = cleanPrStatusLabel((l as any).bookedPrStatus);
                          if (!st) return <span className="text-xs text-[#A0A0A0]">-</span>;
                          const stL = st.toLowerCase();
                          const { bg, color } =
                            stL.includes("completed")
                              ? { bg: "#ECFAF6", color: "#0F6F57" }
                              : stL.includes("in progress")
                              ? { bg: "#FFF8E8", color: "#94610A" }
                              : stL.includes("awaiting signature")
                              ? { bg: "#F3F0FF", color: "#5440A3" }
                              : (stL.includes("scheduled") && !stL.includes("not"))
                              ? { bg: "#EEF7FF", color: "#184D91" }
                              : { bg: "#F3F6FA", color: "#5F748B" };
                          return (
                            <span
                              className="inline-flex rounded-xl px-3 py-1 text-[11px] font-medium"
                              style={{ background: bg, color }}
                            >
                              {st}
                            </span>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr
                    key={getRowKey(l)}
                    className="group cursor-pointer border-b border-[#F4F4F4] transition-colors hover:bg-[#FCFCFC]"
                    onClick={() => onSelectLearner(l)}
                  >
                    <td className="sticky left-0 z-10 w-12 bg-white p-3 transition-colors group-hover:bg-[#FCFCFC]" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(l.id)}
                        onCheckedChange={() => {
                          const next = new Set(selected);
                          next.has(l.id) ? next.delete(l.id) : next.add(l.id);
                          setSelected(next);
                        }}
                      />
                    </td>

                    <td className="sticky left-12 z-10 min-w-[180px] bg-white px-4 py-3.5 font-medium text-[#20344D] shadow-[6px_0_12px_-10px_rgba(20,38,74,0.35),1px_0_0_#DDE7F0] transition-colors group-hover:bg-[#F8FBFE]">
                      <div className="flex items-center gap-2">
                        {l.firstName} {l.lastName}
                        {(l as any).isResolved && (
                          <Badge className="border-0 bg-green-100 text-green-700 text-[11px]">
                            Resolved
                          </Badge>
                        )}
                      </div>
                    </td>

                    <td className="p-3 text-muted-foreground">{l.phone || "N/A"}</td>
                    <td className="p-3">
                      <LearnerStatusBadge learner={l} />
                    </td>
                    <td className="px-4 py-3.5 text-[#7C7C7C]">{l.organisation}</td>
                    <td className="p-3 text-muted-foreground">{l.programme}</td>
                    <td className="p-3 text-muted-foreground">{l.coach}</td>

                    {kpiCategory === "otj-behind" && (
                      <>
                        <td className="p-3 text-center font-semibold">
                          <span
                            className={
                              behindPct > 40
                                ? "text-severity-critical"
                                : behindPct > 20
                                  ? "text-severity-overdue"
                                  : "text-foreground"
                            }
                          >
                            {behindPct}%
                          </span>
                        </td>
                        <td className="p-3 text-center text-muted-foreground">{l.plannedOtjHours}h</td>
                        <td className="p-3 text-center text-muted-foreground">{l.actualOtjHours}h</td>
                        <td className="p-3 text-center text-muted-foreground">
                          {getRequiredHoursToSubmit(l)}
                        </td>
                      </>
                    )}

                    {kpiCategory === "review-due" && (
                      <>
                        <td className="p-3" onClick={(e) => e.stopPropagation()}>
                          {renderEvidenceButton(l)}
                        </td>

                        <td className="p-3 text-muted-foreground">{l.lastProgressReviewDate || "N/A"}</td>

                        <td className="p-3 min-w-[130px]">
                          <DateStatusCell value={(l as any).prMatchReason || "N/A"} />
                        </td>

                        <td className="p-3 min-w-[130px]">
                          <DateStatusCell
                            value={
                              (l as any).nextPrDate
                                ? `${(l as any).nextPrDate}${(l as any).nextPrState ? ` (${(l as any).nextPrState})` : ""}`
                                : "N/A"
                            }
                          />
                        </td>

                        <td className="p-3 text-muted-foreground">
                          {Number((l as any).overduePrCount ?? 0)}
                        </td>

                        <td className="p-3 min-w-[140px]">
                          {(l as any).bookedPrDate && (l as any).bookedPrDate !== "N/A" ? (
                            <Badge className="pointer-events-none rounded-full border-0 bg-[#EEF7FF] px-3 py-1 text-[11px] font-medium text-[#184D91]">
                              {(l as any).bookedPrDate}
                            </Badge>
                          ) : (
                            <span className="text-xs text-[#A0A0A0]">Not booked</span>
                          )}
                        </td>

                        <td className="p-3">
                          <Badge
                            className={
                              (l as any).reviewStatusTone === "due"
                                ? "border-0 bg-severity-critical-bg text-severity-critical-foreground text-[11px]"
                                : (l as any).reviewStatusTone === "at-risk"
                                  ? "border-0 bg-severity-overdue-bg text-severity-overdue-foreground text-[11px]"
                                  : (l as any).reviewStatusTone === "ahead"
                                    ? "border-0 bg-emerald-100 text-emerald-700 text-[11px]"
                                    : "border-0 bg-slate-100 text-slate-700 text-[11px]"
                            }
                          >
                            {(l as any).reviewStatusLabel || "Normal"}
                          </Badge>
                        </td>
                      </>
                    )}

                    {kpiCategory === "coaching-due" && (
                      <>
                        <td className="px-4 py-3.5">
                          <Badge className="rounded-full border-0 bg-[#FFF8E8] px-3 py-1 text-[11px] font-medium text-[#94610A] pointer-events-none w-fit">
                            {String((l as any).nextMonthlyMeetingDue || (isPastMcrMonth ? "N/A" : "Required"))}
                          </Badge>
                        </td>
                        <td className="p-3">
                          {(l as any).nextMonthlyMeetingStatus ? (
                            <span
                              className="text-[10px] font-medium px-2 py-0.5 rounded-full w-fit"
                              style={{
                                background:
                                  String((l as any).nextMonthlyMeetingStatus).toLowerCase().includes("not scheduled") || String((l as any).nextMonthlyMeetingStatus).toLowerCase().includes("not started")
                                    ? "#FFF1F3"
                                    : String((l as any).nextMonthlyMeetingStatus).toLowerCase().includes("scheduled")
                                      ? "#ECFAF6"
                                      : "#F3F6FA",
                                color:
                                  String((l as any).nextMonthlyMeetingStatus).toLowerCase().includes("not scheduled") || String((l as any).nextMonthlyMeetingStatus).toLowerCase().includes("not started")
                                    ? "#B42332"
                                    : String((l as any).nextMonthlyMeetingStatus).toLowerCase().includes("scheduled")
                                      ? "#0F6F57"
                                      : "#5F748B",
                              }}
                            >
                              {String((l as any).nextMonthlyMeetingStatus)}
                            </span>
                          ) : (
                            <span className="text-xs text-[#A0A0A0]">N/A</span>
                          )}
                        </td>
                        {!isPastMcrMonth && (
                          <td className="p-3 text-center">
                          {(() => {
                            const count = Number((l as any).overdueMcmCount ?? 0);
                            if (count === 0) return <span className="text-xs text-[#A0A0A0]">0</span>;
                            return (
                              <span
                                className="inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                                style={{
                                  background: count > 6 ? "#FFF1F3" : count > 3 ? "#FFF8E8" : "#F3F6FA",
                                  color: count > 6 ? "#B42332" : count > 3 ? "#94610A" : "#5F748B",
                                }}
                              >
                                {count}
                              </span>
                            );
                          })()}
                          </td>
                        )}
                      </>
                    )}

                    {kpiCategory !== "review-due" && kpiCategory !== "coaching-due" && kpiCategory !== "status-view" && (
                      <td className="p-3">
                        {kpiCategory === "otj-behind" ? (
                          (() => {
                            const status = String((l as any).otjHoursStatus || "").trim();
                            if (!status) return null;
                            const sl = status.toLowerCase();
                            return (
                              <span
                                className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                                style={{
                                  background: sl === "at risk" ? "#FFF1F3" : sl === "on track" ? "#ECFAF6" : "#F3F6FA",
                                  color: sl === "at risk" ? "#B42332" : sl === "on track" ? "#0F6F57" : "#5F748B",
                                }}
                              >
                                {status}
                              </span>
                            );
                          })()
                        ) : (
                          priorityBadge(l.priority)
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="p-10 text-center">
                    <div className="mx-auto max-w-sm">
                      <p className="text-sm font-semibold text-[#14264A]">No learners found</p>
                      <p className="mt-1 text-xs text-[#71849A]">
                        Try changing the period, coach, status, or search filters.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs text-[#71849A]">
          {filtered.length} learner{filtered.length !== 1 ? "s" : ""} | {selected.size} selected
        </p>
      </div>

      <Dialog
        open={!!evidenceLearner}
        onOpenChange={(open) => {
          if (!open) setEvidenceLearner(null);
        }}
      >
        <DialogContent className="overflow-hidden rounded-2xl border-[#DDE7F0] p-0 sm:max-w-lg [&>button]:hidden">
          <div className="bg-[#14264A] px-5 py-4 text-white">
            <DialogHeader className="pr-10">
              <DialogTitle className="flex items-center gap-2 text-base font-bold text-white">
                <FileText className="h-4 w-4" />
                Evidence
                {evidenceLearner ? (
                  <span className="font-normal text-white/70">
                    · {evidenceLearner.firstName} {evidenceLearner.lastName}
                  </span>
                ) : null}
              </DialogTitle>
            </DialogHeader>
            <DialogClose asChild>
              <button
                type="button"
                className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/30 bg-white/12 text-white transition-colors hover:bg-white/22 focus:outline-none focus:ring-2 focus:ring-white/70"
                aria-label="Close evidence"
              >
                <X className="h-4 w-4" />
              </button>
            </DialogClose>
          </div>

          <div className="max-h-[60vh] space-y-3 overflow-y-auto bg-white p-5">
            {evidenceItems.length > 0 ? (
              evidenceItems.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-[#DDE7F0] bg-[#F8FBFE] p-4"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[#EEF7FF] px-2.5 py-1 text-xs font-bold text-[#184D91]">
                      {item.title}
                    </span>
                    <span className="text-xs text-[#71849A]">{item.meta}</span>
                    <span className="ml-auto rounded-full bg-[#ECFAF6] px-2 py-0.5 text-[11px] font-semibold text-[#0F6F57]">
                      {item.source}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-[#20344D]">
                    {item.body}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-[#71849A]">No evidence recorded for this learner yet.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Call log modal */}
      <Dialog open={showCallModal} onOpenChange={(o) => { if (!o) setShowCallModal(false); }}>
        <DialogContent className="max-w-md rounded-lg border-[#DDE7F0]">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-[#14264A]">
              Log Call - {selected.size} learner{selected.size !== 1 ? "s" : ""}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 pt-1">
            {(() => { const sel = filtered.filter((l) => selected.has(l.id)); return sel.length > 0 && (
              <div className="max-h-24 overflow-y-auto rounded-lg bg-[#F8FBFE] px-3 py-2 text-xs text-[#20344D] space-y-0.5">
                {sel.map((l) => (
                  <div key={l.id}>{l.firstName} {l.lastName} - {l.email}</div>
                ))}
              </div>
            ); })()}

            <div>
              <label className="text-xs font-medium text-[#5F748B] block mb-1">Outcome <span className="text-[#B42332]">*</span></label>
              <Select value={callOutcome} onValueChange={setCallOutcome}>
                <SelectTrigger className="h-9 rounded-lg border-[#D7E5F3] text-sm">
                  <SelectValue placeholder="Select outcome..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Sent email with details">Sent email with details</SelectItem>
                  <SelectItem value="Booked an appointment with the coach">Booked an appointment with the coach</SelectItem>
                  <SelectItem value="Escalated to line manager">Escalated to line manager</SelectItem>
                  <SelectItem value="Escalated to HR">Escalated to HR</SelectItem>
                  <SelectItem value="No answer - voicemail left">No answer - voicemail left</SelectItem>
                  <SelectItem value="No answer - will try again">No answer - will try again</SelectItem>
                  <SelectItem value="Other (specify)">Other (specify)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs font-medium text-[#5F748B] block mb-1">Notes (optional)</label>
              <Textarea
                value={callNotes}
                onChange={(e) => setCallNotes(e.target.value)}
                rows={3}
                placeholder="Add any notes..."
                className="resize-none rounded-lg border-[#D7E5F3] text-sm"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowCallModal(false)}
                className="flex-1 h-9 rounded-lg border border-[#D7E5F3] text-sm text-[#5F748B] hover:bg-[#F8FBFE]"
              >
                Cancel
              </button>
              <button
                disabled={!callOutcome || callSaving}
                onClick={() => handleSaveCallLog(filtered.filter((l) => selected.has(l.id)))}
                className="flex-1 h-9 rounded-lg text-sm font-semibold text-white disabled:opacity-40"
                style={{ background: "#1E6ACB" }}
              >
                {callSaving ? "Saving..." : "Save Log"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
