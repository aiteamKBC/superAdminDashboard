import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, CalendarRange, CheckCircle2, ChevronDown,
  Download, ExternalLink, Plus, RefreshCw, Search,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import BackButton from "@/components/BackButton";
import AppFilterSelect from "@/components/FilterSelect";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useActiveLearnersCount } from "@/hooks/useActiveLearnersCount";

// ─── Types ────────────────────────────────────────────────────────────

interface PRLearner {
  id: number;
  fullName: string;
  email: string;
  group: string;
  caseOwner: string;
  phone: string;
  organisation: string;
  lastActuallyCompletedPr: string;
  lastProgressReview: string;
  nextPrDate: string;
  nextPrState: string;
  overduePrCount: number;
  reviewStatus: "Ahead" | "Normal" | "At Risk" | "Due";
  plannedDates: { date: string; status: string; completed: boolean; isPast: boolean }[];
}

interface PRTicketInfo {
  id: number;
  ticketRef: string;
  status: string;
  learnerEmail: string;
  nextPrDate: string | null;
}

type PrOffset = number | "last12weeks";

// ─── Quarter helpers (same logic as main dashboard Index.tsx) ─────────

const getPrQuarterRange = (offset: number): { start: Date; end: Date } => {
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
  return { start, end };
};

const getPrDateRange = (offset: PrOffset): { start: Date; end: Date } => {
  if (offset === "last12weeks") {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(end.getDate() - 7 * 12 + 1);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }
  return getPrQuarterRange(offset);
};

const getPrMonthLabel = (offset: PrOffset): string => {
  if (offset === "last12weeks") return "Last 12 Weeks";
  const now = new Date();
  const currentQ = Math.floor(now.getMonth() / 3);
  const targetQ = currentQ + (offset as number);
  const yearShift = Math.floor(targetQ / 4);
  const normQ = ((targetQ % 4) + 4) % 4;
  const year = now.getFullYear() + yearShift;
  return `Q${normQ + 1} ${year}`;
};

// Generates quarter dropdown options: Last 12 Weeks + 2 past + current + 2 future
const buildQuarterOptions = (): { value: PrOffset; label: string }[] => {
  const options: { value: PrOffset; label: string }[] = [
    { value: "last12weeks" as PrOffset, label: "Last 12 Weeks" },
  ];
  for (let i = -2; i <= 2; i++) {
    const label = i === 0 ? `Current — ${getPrMonthLabel(0)}` : getPrMonthLabel(i);
    options.push({ value: i, label });
  }
  return options;
};

const QUARTER_OPTIONS = buildQuarterOptions();

const fmtRangeDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

const getPrRangeLabel = (offset: PrOffset): string => {
  const { start, end } = getPrDateRange(offset);
  return `${fmtRangeDate(start)} – ${fmtRangeDate(end)}`;
};

// ─── PR match helper (same logic as main dashboard) ───────────────────

const parseBookedDate = (raw: unknown): Date | null => {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s || s === "N/A") return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

const getProgressReviewMatchInRange = (
  learner: PRLearner,
  start: Date,
  end: Date,
  includeCompleted: boolean,
  beforeDate?: Date
) => {
  const matchesRange = (dt: Date | null) => dt !== null && dt >= start && dt <= end;
  if (learner.plannedDates.length > 0) {
    return learner.plannedDates.find((d) => {
      if (!includeCompleted && d.completed) return false;
      const dt = parseBookedDate(d.date);
      if (!matchesRange(dt)) return false;
      if (beforeDate && dt && dt >= beforeDate) return false;
      return true;
    });
  }
  const dt = parseBookedDate(learner.nextPrDate);
  if (!matchesRange(dt) || (beforeDate && dt && dt >= beforeDate)) return undefined;
  return { date: learner.nextPrDate, completed: false, status: learner.nextPrState };
};

// ─── Visual helpers ───────────────────────────────────────────────────

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const statusIncludes = (value: unknown, text: string) =>
  String(value || "").toLowerCase().includes(text);

const fmtProgressReviewText = (value: string | null) => {
  const text = String(value || "").trim();
  return text && text.toLowerCase() !== "n/a" ? text : "â€”";
};

const getPrTicketKey = (email: string, nextPrDate: string | null | undefined) =>
  `${String(email || "").trim().toLowerCase()}::${String(nextPrDate || "")}`;

const getLearnerKey = (learner: { email: string; id: number }) =>
  String(learner.email || learner.id).trim().toLowerCase();

// ─── Filter Select ────────────────────────────────────────────────────

function FilterSelect<T extends string | number>({
  label, value, onChange, options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  const selectOptions = options.map((o) => ({ value: String(o.value), label: o.label }));

  return (
    <div className="relative inline-flex items-center">
      <span className="pointer-events-none absolute left-3 z-10 whitespace-nowrap text-xs font-bold text-[#14264A]">
        {label}
      </span>
      <AppFilterSelect
        value={String(value)}
        onChange={(next) => {
          const selected = options.find((o) => String(o.value) === next);
          if (selected) onChange(selected.value);
        }}
        options={selectOptions}
        className="pl-[7.25rem] font-semibold text-[#1E6ACB]"
        minWidth={240}
      />
    </div>
  );
}

// ─── Simple native dropdown (GlobalFilters style) ─────────────────────

function SimpleSelect({ value, onChange, options, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
}) {
  return (
    <div className="relative inline-flex min-w-[160px] flex-1">
      <AppFilterSelect
        value={value}
        onChange={onChange}
        options={[{ value: "", label: placeholder }, ...options.map((o) => ({ value: o, label: o }))]}
        className="w-full flex-1 bg-[#F8FBFE] font-normal text-[#20344D]"
        minWidth={160}
      />
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────

export default function RequiredPRPage() {
  const navigate = useNavigate();
  const { count: activeLearnersCount, loading: activeLearnersLoading } = useActiveLearnersCount();
  const [learners, setLearners] = useState<PRLearner[]>([]);
  const [tickets, setTickets] = useState<PRTicketInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [prOffset, setPrOffset] = useState<PrOffset>("last12weeks");
  const [programmeFilter, setProgrammeFilter] = useState("");
  const [coachFilter, setCoachFilter] = useState("");
  const [cardFilter, setCardFilter] = useState<"all" | "scheduled" | "notScheduled" | "inProgress" | "completed" | "overdue">("all");
  const autoCreateOverdueKeyRef = useRef("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [prRes, ticketsRes] = await Promise.all([
        fetch("/api/progress-review-summary/"),
        fetch("/api/pr-tickets/?archived=false"),
      ]);
      if (prRes.ok) setLearners(await prRes.json());
      if (ticketsRes.ok) setTickets(await ticketsRes.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const ticketMap = useMemo(() => {
    const m = new Map<string, PRTicketInfo>();
    tickets.forEach((t) => {
      const emailKey = t.learnerEmail.toLowerCase();
      if (!m.has(emailKey)) m.set(emailKey, t);
      m.set(getPrTicketKey(t.learnerEmail, t.nextPrDate), t);
      if (!t.nextPrDate) m.set(getPrTicketKey(t.learnerEmail, ""), t);
    });
    return m;
  }, [tickets]);

  // ── Derived filter options ────────────────────────────────────────────
  const programmeOptions = useMemo(() =>
    Array.from(new Set(learners.map((l) => l.group).filter(Boolean))).sort(),
    [learners]);

  const coachOptions = useMemo(() =>
    Array.from(new Set(learners.map((l) => l.caseOwner).filter(Boolean)))
      .filter((c) => !["default owner", "enrolment team"].includes(c.toLowerCase()))
      .sort(),
    [learners]);

  // ── All learners in range (completed + non-completed) — single population ──
  // ── Helper: categorise a learner's dates within the selected range ────
  const getRangeStatus = useCallback((l: PRLearner, start: Date, end: Date) => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const matchingDates = l.plannedDates
      .filter((d) => {
        const dt = parseBookedDate(d.date);
        if (dt === null || dt < start || dt > end) return false;
        return true;
      })
      .sort((a, b) => {
        const aTime = parseBookedDate(a.date)?.getTime() ?? 0;
        const bTime = parseBookedDate(b.date)?.getTime() ?? 0;
        return bTime - aTime;
      });

    const completedDates = matchingDates.filter((d) =>
      Boolean(d.completed) || statusIncludes(d.status, "completed")
    );
    const activeDates = matchingDates.filter((d) =>
      !d.completed && !statusIncludes(d.status, "completed")
    );
    const overdueDates = activeDates.filter((d) => {
      const dt = parseBookedDate(d.date);
      return dt !== null && dt < today;
    });
    const inProgressEntry = activeDates.find((d) =>
      statusIncludes(d.status, "in progress") || statusIncludes(d.status, "awaiting signature")
    );
    const scheduledEntry = activeDates.find((d) => {
      return (
        statusIncludes(d.status, "scheduled") &&
        !statusIncludes(d.status, "not scheduled") &&
        !statusIncludes(d.status, "in progress") &&
        !statusIncludes(d.status, "awaiting signature")
      );
    });
    const notScheduledEntry = activeDates.find((d) =>
      !statusIncludes(d.status, "scheduled") ||
      statusIncludes(d.status, "not scheduled")
    );

    let match = overdueDates[0] || inProgressEntry || scheduledEntry || notScheduledEntry || completedDates[0] || matchingDates[0];
    const overdueMatch = overdueDates[0];
    if (!match && l.nextPrDate) {
      const dt = parseBookedDate(l.nextPrDate);
      if (dt && dt >= start && dt <= end) {
        match = {
          date: l.nextPrDate,
          status: l.nextPrState,
          completed: false,
          isPast: dt < today,
        };
      }
    }

    const status = String(match?.status || "").trim().toLowerCase();
    const fallbackCompleted = Boolean(match?.completed) || status.includes("completed");
    const completed = completedDates.length > 0 || (matchingDates.length === 0 && fallbackCompleted);
    const inProgress = (!completed && Boolean(inProgressEntry)) || (
      matchingDates.length === 0 &&
      !fallbackCompleted &&
      (status.includes("in progress") || status.includes("awaiting signature"))
    );
    const scheduled = Boolean(scheduledEntry) || (
      matchingDates.length === 0 &&
      !fallbackCompleted &&
      !inProgress &&
      status.includes("scheduled") &&
      !status.includes("not scheduled")
    );
    const notScheduled = (!completed && !inProgress && !scheduled && Boolean(notScheduledEntry)) || (
      Boolean(match) &&
      matchingDates.length === 0 &&
      !fallbackCompleted &&
      !inProgress &&
      !scheduled
    );
    const matchDate = parseBookedDate(match?.date);

    return {
      inScope: Boolean(match),
      matchDate: match?.date || "",
      overdueDate: overdueMatch?.date || "",
      overdueStatus: overdueMatch?.status || "",
      overdueItems: overdueDates.map((d) => ({
        date: d.date,
        status: d.status || "Not Scheduled",
      })),
      scopedOverdueCount: overdueDates.length,
      completed,
      scheduled,
      notScheduled,
      inProgress,
      overdue: overdueDates.length > 0 || (!completed && matchDate !== null && matchDate < today),
    };
  }, []);

  const getGlobalOverdueStatus = useCallback((l: PRLearner) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const overdueItems = l.plannedDates
      .filter((d) => {
        if (d.completed || statusIncludes(d.status, "completed")) return false;
        const dt = parseBookedDate(d.date);
        return dt !== null && dt < today;
      })
      .sort((a, b) => {
        const aTime = parseBookedDate(a.date)?.getTime() ?? 0;
        const bTime = parseBookedDate(b.date)?.getTime() ?? 0;
        return aTime - bTime;
      })
      .map((d) => ({
        date: d.date,
        status: d.status || "Not Scheduled",
      }));

    if (overdueItems.length === 0) {
      const nextDate = parseBookedDate(l.nextPrDate);
      const nextState = String(l.nextPrState || "").trim();
      if (nextDate && nextDate < today && !statusIncludes(nextState, "completed")) {
        overdueItems.push({
          date: l.nextPrDate,
          status: nextState || "Not Scheduled",
        });
      }
    }

    return {
      overdue: overdueItems.length > 0,
      overdueDate: overdueItems[0]?.date || "",
      overdueItems,
      overdueCount: overdueItems.length,
    };
  }, []);

  const entityFilteredLearners = useMemo(() => {
    const baseQ = search.toLowerCase();

    return learners.filter((l) => {
      if (programmeFilter && l.group !== programmeFilter) return false;
      if (coachFilter && l.caseOwner !== coachFilter) return false;
      if (baseQ && !l.fullName.toLowerCase().includes(baseQ) && !l.email.toLowerCase().includes(baseQ) && !l.caseOwner.toLowerCase().includes(baseQ)) return false;
      return true;
    });
  }, [coachFilter, learners, programmeFilter, search]);

  const allInRange = useMemo(() => {
    const { start, end } = getPrDateRange(prOffset);

    return entityFilteredLearners.filter((l) => {
      return getRangeStatus(l, start, end).inScope;
    });
  }, [entityFilteredLearners, prOffset, getRangeStatus]);

  const globalOverdueRows = useMemo(
    () => entityFilteredLearners.filter((l) => getGlobalOverdueStatus(l).overdue),
    [entityFilteredLearners, getGlobalOverdueStatus],
  );

  // ── Summary counts — all based on dates within the selected range ──────
  const summary = useMemo(() => {
    const { start, end } = getPrDateRange(prOffset);
    const scheduledLearners = new Set<string>();
    const inProgressLearners = new Set<string>();
    const notScheduledLearners = new Set<string>();
    allInRange.forEach((l) => {
      const status = getRangeStatus(l, start, end);
      if (status.scheduled) scheduledLearners.add(getLearnerKey(l));
      if (status.inProgress) inProgressLearners.add(getLearnerKey(l));
      if (status.notScheduled) notScheduledLearners.add(getLearnerKey(l));
    });

    return {
      total: allInRange.length,
      scheduled: scheduledLearners.size,
      notScheduled: notScheduledLearners.size,
      inProgress: inProgressLearners.size,
      completed: allInRange.filter((l) => getRangeStatus(l, start, end).completed).length,
      overdue: globalOverdueRows.length,
    };
  }, [allInRange, globalOverdueRows, prOffset, getRangeStatus]);

  // ── Rows shown in table based on card selection ───────────────────────
  const displayedRows = useMemo(() => {
    if (cardFilter === "overdue") return globalOverdueRows;
    if (cardFilter === "all") return allInRange;
    const { start, end } = getPrDateRange(prOffset);
    return allInRange.filter((l) => {
      const s = getRangeStatus(l, start, end);
      if (cardFilter === "scheduled") return s.scheduled;
      if (cardFilter === "notScheduled") return s.notScheduled;
      if (cardFilter === "inProgress") return s.inProgress;
      if (cardFilter === "completed") return s.completed;
      return true;
    });
  }, [cardFilter, allInRange, globalOverdueRows, prOffset, getRangeStatus]);

  const getScopedTicketDate = useCallback((l: PRLearner) => {
    if (cardFilter === "overdue") {
      const globalStatus = getGlobalOverdueStatus(l);
      if (globalStatus.overdueDate) return globalStatus.overdueDate;
    }
    const { start, end } = getPrDateRange(prOffset);
    const status = getRangeStatus(l, start, end);
    return status.overdueDate || status.matchDate || l.nextPrDate || "";
  }, [cardFilter, getGlobalOverdueStatus, getRangeStatus, prOffset]);

  useEffect(() => {
    if (loading || globalOverdueRows.length === 0) return;

    const candidates = globalOverdueRows
      .map((learner) => ({ learner, status: getGlobalOverdueStatus(learner) }))
      .filter(({ learner, status }) => {
        if (!status.overdueDate) return false;
        const existingTicket = ticketMap.get(learner.email.toLowerCase());
        return !existingTicket || existingTicket.status === "resolved";
      });

    if (candidates.length === 0) return;

    const runKey = candidates
      .map(({ learner, status }) => getPrTicketKey(learner.email, status.overdueDate))
      .sort()
      .join("|");
    if (!runKey || autoCreateOverdueKeyRef.current === runKey) return;
    autoCreateOverdueKeyRef.current = runKey;

    fetch("/api/pr-tickets/auto-create/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        learners: candidates.map(({ learner, status }) => ({
          email: learner.email,
          name: learner.fullName,
          phone: learner.phone || "",
          organisation: learner.organisation || "",
          programme: learner.group || "",
          assigned_owner: "",
          last_progress_review: learner.lastProgressReview || "",
          last_actually_completed_pr: learner.lastActuallyCompletedPr || "",
          last_pr_date: "",
          next_pr_date: status.overdueDate,
          overdue_count: status.overdueCount || 1,
          risk: "amber",
          status: "new",
          notes: "",
          created_by: "System",
        })),
      }),
    }).then((res) => {
      if (res.ok) void loadAll();
    }).catch(() => {
      autoCreateOverdueKeyRef.current = "";
    });
  }, [getGlobalOverdueStatus, globalOverdueRows, loadAll, loading, ticketMap]);

  const onFollowUp = (l: PRLearner) => {
    const scopedPrDate = getScopedTicketDate(l);
    const { start, end } = getPrDateRange(prOffset);
    const scopedStatus = getRangeStatus(l, start, end);
    const existing = ticketMap.get(l.email.toLowerCase()) ?? ticketMap.get(getPrTicketKey(l.email, scopedPrDate));
    if (existing) {
      navigate(`/progress-review/tickets?ticket=${existing.id}`);
    } else {
      const params = new URLSearchParams({
        create: "1", email: l.email, name: l.fullName,
        phone: l.phone || "", organisation: l.organisation || "",
        programme: l.group,
        lastProgressReview: l.lastProgressReview || "",
        lastActuallyCompletedPr: l.lastActuallyCompletedPr || "",
        lastPrDate: "",
        nextPrDate: scopedPrDate,
        overdue: String(scopedStatus.scopedOverdueCount || l.overduePrCount),
      });
      navigate(`/progress-review/tickets?${params.toString()}`);
    }
  };

  const hasFilters = prOffset !== "last12weeks" || search !== "" || programmeFilter !== "" || coachFilter !== "";

  const clearAll = () => {
    setPrOffset("last12weeks");
    setSearch(""); setProgrammeFilter(""); setCoachFilter(""); setCardFilter("all");
  };

  const exportCsv = () => {
    const { start, end } = getPrDateRange(prOffset);
    const cols = [
      "Learner",
      "Email",
      "Coach",
      "Programme",
      "Last actual completed",
      "Last PR",
      "Next Progress Review Date",
      "Next Progress Review State",
      "Overdue Count",
      "Overdue Items",
      "Follow-up Ticket",
      "Ticket Status",
    ];
    const rows = displayedRows.map((l) => {
      const rangeStatus = getRangeStatus(l, start, end);
      const globalOverdueStatus = getGlobalOverdueStatus(l);
      const overdueCount = cardFilter === "overdue" ? globalOverdueStatus.overdueCount : rangeStatus.scopedOverdueCount;
      const overdueItems = cardFilter === "overdue" ? globalOverdueStatus.overdueItems : rangeStatus.overdueItems;
      const ticket = ticketMap.get(l.email.toLowerCase());
      return [
        l.fullName,
        l.email,
        l.caseOwner || "",
        l.group || "",
        fmtProgressReviewText(l.lastActuallyCompletedPr),
        fmtProgressReviewText(l.lastProgressReview),
        fmtDate(l.nextPrDate),
        l.nextPrState || "Not Scheduled",
        overdueCount,
        overdueItems.map((item) => `${fmtDate(item.date)} ${item.status}`.trim()).join("; "),
        ticket?.ticketRef || "",
        ticket?.status || "",
      ];
    });
    const csv = [cols, ...rows]
      .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `required-pr-${cardFilter}-${prOffset}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const highlightedColumns = useMemo(() => {
    const columns: Record<typeof cardFilter, string[]> = {
      all: [],
      scheduled: ["lastPr"],
      notScheduled: ["lastPr"],
      inProgress: ["lastActual", "lastPr"],
      completed: ["lastActual"],
      overdue: ["overdue"],
    };
    return new Set(columns[cardFilter]);
  }, [cardFilter]);

  const highlightTone =
    cardFilter === "scheduled" ? "teal" :
      cardFilter === "notScheduled" ? "red" :
        cardFilter === "inProgress" ? "blue" :
          cardFilter === "completed" ? "green" :
            cardFilter === "overdue" ? "amber" :
              "";

  const highlightClass = (column: string, target: "header" | "cell" = "cell") => {
    if (!highlightedColumns.has(column)) return "";
    const classes = {
      teal: target === "header" ? "bg-teal-50/80 text-teal-800" : "bg-teal-50/45",
      red: target === "header" ? "bg-red-50/80 text-red-800" : "bg-red-50/45",
      blue: target === "header" ? "bg-blue-50/80 text-blue-800" : "bg-blue-50/45",
      green: target === "header" ? "bg-green-50/80 text-green-800" : "bg-green-50/45",
      amber: target === "header" ? "bg-amber-50/80 text-amber-800" : "bg-amber-50/45",
    } as const;
    return classes[highlightTone as keyof typeof classes] ?? "";
  };

  return (
    <AppLayout>
      <div className="min-h-full bg-[#F4F8FC]">
        {/* Header */}
        <div className="border-b border-[#DDE7F0] bg-white px-4 pb-5 pt-4 sm:px-6">
          <BackButton to="/progress-review" label="Progress Review" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-[#14264A]">Required PR</h1>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-[#5F7288]">
                <span>Default view: learners with overdue or upcoming progress reviews</span>
                <span className="rounded-full bg-[#14264A] px-2.5 py-0.5 text-xs font-bold text-white shadow-sm">
                  Last 12 Weeks
                </span>
                <span className="inline-flex items-center rounded-full bg-[#14264A] px-2.5 py-0.5 text-xs font-bold text-white shadow-sm ring-2 ring-[#8DB6F3]/30 motion-safe:animate-pulse">
                  {activeLearnersLoading ? "..." : activeLearnersCount} active learners
                </span>
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={loadAll} className="flex items-center gap-1.5 rounded-lg border border-[#DDE7F0] bg-white px-3 py-2 text-xs font-semibold text-[#5F7288] hover:bg-[#F0F4F8]">
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </button>
              <button
                onClick={exportCsv}
                disabled={loading || displayedRows.length === 0}
                className="flex items-center gap-1.5 rounded-lg border border-[#DDE7F0] bg-white px-3 py-2 text-xs font-semibold text-[#24486D] hover:bg-[#F0F4F8] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" /> Export CSV
              </button>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          {/* Filter bar — row 1: entity filters */}
          <div className="mb-2 flex flex-wrap gap-2">
            <SimpleSelect
              value={programmeFilter}
              onChange={setProgrammeFilter}
              options={programmeOptions}
              placeholder="All Programmes"
            />
            <SimpleSelect
              value={coachFilter}
              onChange={setCoachFilter}
              options={coachOptions}
              placeholder="All Coaches"
            />
          </div>

          {/* Filter bar — row 2: search + PR quarter */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative flex-1" style={{ minWidth: 200 }}>
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8AA0B6]" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search learner, email, coach…"
                className="h-10 rounded-lg border-[#D7E5F3] bg-white pl-9 text-sm" />
            </div>
            <FilterSelect<PrOffset>
              label="PR Quarter"
              value={prOffset}
              onChange={setPrOffset}
              options={QUARTER_OPTIONS}
            />
            <span className="flex h-10 items-center gap-1.5 rounded-lg border border-[#DDE7F0] bg-[#F8FBFE] px-3 text-xs font-medium text-[#5F7288]">
              <CalendarRange className="h-3.5 w-3.5 text-[#8AA0B6]" />
              {getPrRangeLabel(prOffset)}
            </span>
            {hasFilters && (
              <button onClick={clearAll}
                className="h-10 rounded-lg border border-[#DDE7F0] bg-white px-3 text-xs font-semibold text-[#71849A] hover:bg-[#F0F4F8]">
                Clear filters
              </button>
            )}
          </div>

          {/* Summary cards — clickable filters */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {([
              { key: "all", label: "Total Shown", count: summary.total, icon: <CalendarRange className="h-4 w-4" />, base: "border-[#DDE7F0] bg-white text-[#14264A]", active: "border-[#14264A] bg-[#14264A] text-white shadow-md", sub: `Period: ${getPrMonthLabel(prOffset)}` },
              { key: "scheduled", label: "Scheduled", count: summary.scheduled, icon: <CheckCircle2 className="h-4 w-4" />, base: "border-teal-200 bg-teal-50 text-teal-800", active: "border-teal-600 bg-teal-600 text-white shadow-md", sub: "Date booked" },
              { key: "notScheduled", label: "Not Scheduled", count: summary.notScheduled, icon: <AlertTriangle className="h-4 w-4" />, base: "border-red-200 bg-red-50 text-red-800", active: "border-red-600 bg-red-600 text-white shadow-md", sub: "No date booked" },
              { key: "inProgress", label: "In Progress", count: summary.inProgress, icon: <CheckCircle2 className="h-4 w-4" />, base: "border-blue-200 bg-blue-50 text-blue-800", active: "border-blue-600 bg-blue-600 text-white shadow-md", sub: "In Progress / Awaiting Sig." },
              { key: "completed", label: "Completed", count: summary.completed, icon: <CheckCircle2 className="h-4 w-4" />, base: "border-green-200 bg-green-50 text-green-800", active: "border-green-600 bg-green-600 text-white shadow-md", sub: "PR done this period" },
              { key: "overdue", label: "Overdue PR", count: summary.overdue, icon: <AlertTriangle className="h-4 w-4" />, base: "border-amber-200 bg-amber-50 text-amber-800", active: "border-amber-500 bg-amber-500 text-white shadow-md", sub: "Any past, incomplete PR" },
            ] as const).map(({ key, label, count, icon, base, active, sub }) => {
              const isActive = cardFilter === key;
              const showPercentage = key !== "all" && key !== "overdue";
              const pct = summary.total > 0 ? Math.round((count / summary.total) * 100) : 0;
              return (
                <button
                  key={key}
                  onClick={() => setCardFilter(isActive ? "all" : key)}
                  className={`rounded-xl border p-3 text-left transition-all duration-150 hover:shadow-sm active:scale-[0.98] ${isActive ? active : base}`}
                >
                  <div className="flex items-center gap-2 opacity-70">{icon}<span className="text-xs font-semibold">{label}</span></div>
                  <p className="mt-1 text-2xl font-bold">{count}</p>
                  {showPercentage && (
                    <p className="mt-0.5 text-sm font-semibold opacity-75">
                      {pct}%
                      <span className="ml-1 text-[10px] font-normal opacity-70">of {summary.total} shown</span>
                    </p>
                  )}
                  <p className="mt-0.5 text-[10px] opacity-50">{sub}</p>
                </button>
              );
            })}
          </div>

          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p>
              <strong className="font-bold">Overdue PR :</strong> this card counts learners with any past, incomplete progress review anywhere in their PR history. It ignores the PR Quarter date filter, but still follows Programme, Coach, and Search filters.
            </p>
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-xl border border-[#DDE7F0] bg-white shadow-sm">
            {loading ? (
              <div className="flex h-40 items-center justify-center text-sm text-[#5F7288]">Loading…</div>
            ) : displayedRows.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-[#5F7288]">
                <CheckCircle2 className="h-8 w-8 text-[#C5D5E3]" />
                <p>No learners found for this selection</p>
                {(hasFilters || cardFilter !== "all") && (
                  <button onClick={clearAll}
                    className="text-xs font-semibold text-[#1E6ACB] hover:underline">Clear all filters</button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto" style={{ maxHeight: "60vh", overflowY: "auto" }}>
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-[#DDE7F0] bg-[#F8FBFE]">
                      <th rowSpan={2} className="sticky left-0 z-20 whitespace-nowrap border-r border-[#DDE7F0] bg-[#F8FBFE] px-3 py-3 text-left text-xs font-semibold text-[#5F7288]">Learner</th>
                      {[
                        { label: "Email", column: "email" },
                        { label: "Coach", column: "coach" },
                        { label: "Programme", column: "programme" },
                        { label: "Last actual completed", column: "lastActual" },
                        { label: "Last PR", column: "lastPr" },
                      ].map(({ label, column }) => (
                        <th key={label} rowSpan={2} className={`px-3 py-3 text-left text-xs font-semibold text-[#5F7288] ${highlightClass(column, "header")}`}>{label}</th>
                      ))}
                      <th colSpan={2} className={`border-x border-[#CFE0F2] bg-[#EEF7FF] px-3 py-2 text-center text-xs font-bold text-[#1E6ACB] ${highlightedColumns.has("nextDate") || highlightedColumns.has("nextState") ? highlightClass("nextDate", "header") : ""}`}>
                        Next Progress Review
                      </th>
                      <th rowSpan={2} className={`px-3 py-3 text-left text-xs font-semibold text-[#5F7288] ${highlightClass("overdue", "header")}`}>Overdue</th>
                      <th rowSpan={2} className="px-3 py-3 text-left text-xs font-semibold text-[#5F7288]">Follow-up</th>
                    </tr>
                    <tr className="border-b border-[#DDE7F0] bg-[#F8FBFE]">
                      <th className={`border-l border-[#CFE0F2] px-3 py-2 text-left text-xs font-semibold text-[#5F7288] ${highlightClass("nextDate", "header")}`}>Date</th>
                      <th className={`border-r border-[#CFE0F2] px-3 py-2 text-left text-xs font-semibold text-[#5F7288] ${highlightClass("nextState", "header")}`}>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedRows.map((l) => {
                      const ticket = ticketMap.get(l.email.toLowerCase());
                      const { start, end } = getPrDateRange(prOffset);
                      const rangeStatus = getRangeStatus(l, start, end);
                      const globalOverdueStatus = getGlobalOverdueStatus(l);
                      const overdueCount =
                        cardFilter === "overdue" ? globalOverdueStatus.overdueCount : rangeStatus.scopedOverdueCount;
                      const overdueItems =
                        cardFilter === "overdue" ? globalOverdueStatus.overdueItems : rangeStatus.overdueItems;
                      const state = String(l.nextPrState || "").trim();
                      const stateL = state.toLowerCase();
                      const stateCls =
                        stateL.includes("not scheduled") || stateL === ""
                          ? "bg-red-50 text-red-700 border-red-200"
                          : stateL.includes("completed")
                            ? "bg-green-50 text-green-700 border-green-200"
                            : stateL.includes("awaiting signature")
                              ? "bg-purple-50 text-purple-700 border-purple-200"
                              : stateL.includes("in progress")
                                ? "bg-blue-50 text-blue-700 border-blue-200"
                                : stateL.includes("scheduled")
                                  ? "bg-teal-50 text-teal-700 border-teal-200"
                                  : "bg-slate-50 text-slate-700 border-slate-200";

                      return (
                        <tr key={l.id} className="group border-b border-[#F0F4F8] transition-colors hover:bg-[#F8FBFE]">
                          <td className="sticky left-0 z-10 border-r border-[#DDE7F0] bg-white px-3 py-3 font-semibold text-[#14264A] group-hover:bg-[#F8FBFE]">{l.fullName}</td>
                          <td className="px-3 py-3 text-xs text-[#71849A]">{l.email}</td>
                          <td className="px-3 py-3 text-xs text-[#5F7288]">{l.caseOwner || "—"}</td>
                          <td className="px-3 py-3 text-xs text-[#5F7288]">{l.group || "—"}</td>
                          <td className={`px-3 py-3 text-xs text-[#5F7288] ${highlightClass("lastActual")}`}>{fmtProgressReviewText(l.lastActuallyCompletedPr)}</td>
                          <td className={`px-3 py-3 text-xs text-[#5F7288] ${highlightClass("lastPr")}`}>{fmtProgressReviewText(l.lastProgressReview)}</td>
                          <td className={`px-3 py-3 text-xs font-semibold text-[#14264A] ${highlightClass("nextDate")}`}>{fmtDate(l.nextPrDate)}</td>
                          <td className={`px-3 py-3 ${highlightClass("nextState")}`}>
                            {state
                              ? <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${stateCls}`}>{state}</span>
                              : <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${stateCls}`}>Not Scheduled</span>
                            }
                          </td>
                          <td className={`px-3 py-3 ${highlightClass("overdue")}`}>
                            {overdueCount > 0
                              ? (
                                <TooltipProvider delayDuration={120}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="inline-flex cursor-help items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                                        <AlertTriangle className="h-3 w-3" />
                                        {overdueCount}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="left" align="center" className="max-w-xs border-red-100 bg-white p-3 text-[#14264A] shadow-lg">
                                      <p className="mb-2 text-xs font-bold text-red-700">
                                        {cardFilter === "overdue" ? "All overdue meetings" : "Overdue meetings"}
                                      </p>
                                      <div className="space-y-1.5">
                                        {overdueItems.map((item) => (
                                          <div key={`${item.date}-${item.status}`} className="grid grid-cols-[5.5rem_1fr] gap-2 text-xs">
                                            <span className="font-semibold text-[#14264A]">{fmtDate(item.date)}</span>
                                            <span className="text-[#5F7288]">{item.status}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )
                              : <span className="text-xs text-[#A0B0C0]">0</span>
                            }
                          </td>
                          <td className="px-3 py-3">
                            {ticket ? (
                              <button onClick={() => onFollowUp(l)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#EEF7FF] px-2.5 py-1.5 text-xs font-semibold text-[#1E6ACB] hover:bg-[#D8EEFF]">
                                <ExternalLink className="h-3.5 w-3.5" /> View Ticket
                              </button>
                            ) : (
                              <button onClick={() => onFollowUp(l)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#14264A] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1E3A6A]">
                                <Plus className="h-3.5 w-3.5" /> Open Ticket
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
