import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, CalendarRange, CheckCircle2, ChevronDown,
  Download, ExternalLink, Plus, RefreshCw, Search,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import BackButton from "@/components/BackButton";
import AppFilterSelect from "@/components/FilterSelect";
import { Input } from "@/components/ui/input";

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
  reviewStatus: string;
  plannedDates: { date: string; status: string; completed: boolean; isPast: boolean }[];
}

interface PRTicketInfo {
  id: number;
  ticketRef: string;
  status: string;
  learnerEmail: string;
}

type PrOffset = number | "last12weeks";
type CardFilter = "all" | "scheduled" | "inProgress" | "completed";

// ─── Quarter helpers (identical to RequiredPRPage) ────────────────────

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

const buildQuarterOptions = (): { value: PrOffset; label: string }[] => {
  const options: { value: PrOffset; label: string }[] = [
    { value: "last12weeks", label: "Last 12 Weeks" },
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

// ─── Date / status helpers (identical to RequiredPRPage) ──────────────

const parseBookedDate = (raw: unknown): Date | null => {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s || s === "N/A") return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

const statusIncludes = (value: unknown, text: string) =>
  String(value || "").toLowerCase().includes(text);

const getLearnerKey = (learner: { email: string; id: number }) =>
  String(learner.email || learner.id).trim().toLowerCase();

const fmtProgressReviewText = (value: string | null) => {
  const text = String(value || "").trim();
  return text && text.toLowerCase() !== "n/a" ? text : "â€”";
};

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

// ─── Filter Select components (identical to RequiredPRPage) ──────────

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

// ─── Component ────────────────────────────────────────────────────────

export default function ScheduledPRPage() {
  const navigate = useNavigate();
  const [learners, setLearners] = useState<PRLearner[]>([]);
  const [tickets, setTickets] = useState<PRTicketInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const [prOffset, setPrOffset] = useState<PrOffset>("last12weeks");
  const [programmeFilter, setProgrammeFilter] = useState("");
  const [coachFilter, setCoachFilter] = useState("");
  const [search, setSearch] = useState("");
  const [cardFilter, setCardFilter] = useState<CardFilter>("all");

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

  // ── Ticket map ────────────────────────────────────────────────────────
  const ticketMap = useMemo(() => {
    const m = new Map<string, PRTicketInfo>();
    tickets.forEach((t) => m.set(t.learnerEmail.toLowerCase(), t));
    return m;
  }, [tickets]);

  // ── Total active learners (denominator for percentages) ──────────────
  const totalActive = useMemo(() =>
    learners.filter((l) => !!l.caseOwner).length,
  [learners]);

  // ── Derived filter options ────────────────────────────────────────────
  const programmeOptions = useMemo(() =>
    Array.from(new Set(learners.map((l) => l.group).filter(Boolean))).sort(),
  [learners]);

  const coachOptions = useMemo(() =>
    Array.from(new Set(learners.map((l) => l.caseOwner).filter(Boolean)))
      .filter((c) => !["default owner", "enrolment team"].includes(c.toLowerCase()))
      .sort(),
  [learners]);

  // ── getRangeBookedStatus: categorise booked dates in range ──────────
  // Independent counts — same learner can be in multiple categories
  const getRangeBookedStatus = useCallback((l: PRLearner, start: Date, end: Date) => {
    const datesInRange = l.plannedDates.filter((d) => {
      const dt = parseBookedDate(d.date);
      return dt !== null && dt >= start && dt <= end;
    });

    const completedEntry = [...datesInRange]
      .filter((d) => d.completed === true || statusIncludes(d.status, "completed"))
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    const inProgressEntry = datesInRange.find((d) =>
      !d.completed &&
      !statusIncludes(d.status, "completed") &&
      (statusIncludes(d.status, "awaiting signature") || statusIncludes(d.status, "in progress"))
    );

    const scheduledEntry = datesInRange.find((d) => {
      return (
        !d.completed &&
        !statusIncludes(d.status, "completed") &&
        !statusIncludes(d.status, "in progress") &&
        !statusIncludes(d.status, "awaiting signature") &&
        statusIncludes(d.status, "scheduled") &&
        !statusIncludes(d.status, "not scheduled")
      );
    });

    return {
      inScope: !!(inProgressEntry || scheduledEntry || completedEntry),
      inProgress: !!inProgressEntry && !completedEntry,
      scheduled: !!scheduledEntry,
      completed: !!completedEntry,
      inProgressDate: inProgressEntry?.date ?? "",
      inProgressStatus: inProgressEntry?.status ?? "",
      scheduledDate: scheduledEntry?.date ?? "",
      scheduledStatus: scheduledEntry?.status ?? "",
      completedDate: completedEntry?.date ?? "",
      completedStatus: completedEntry?.status ?? "",
    };
  }, []);

  // ── allBooked: single population ─────────────────────────────────────
  const allBooked = useMemo(() => {
    const { start, end } = getPrDateRange(prOffset);
    const q = search.toLowerCase();

    return learners.filter((l) => {
      if (!l.caseOwner) return false;
      if (programmeFilter && l.group !== programmeFilter) return false;
      if (coachFilter && l.caseOwner !== coachFilter) return false;
      if (q && !l.fullName.toLowerCase().includes(q) && !l.email.toLowerCase().includes(q) && !l.caseOwner.toLowerCase().includes(q)) return false;
      return getRangeBookedStatus(l, start, end).inScope;
    });
  }, [learners, prOffset, programmeFilter, coachFilter, search, getRangeBookedStatus]);

  // ── Summary counts — independent (same learner can appear in multiple) ─
  const summary = useMemo(() => {
    const { start, end } = getPrDateRange(prOffset);
    let scheduled = 0, inProgress = 0, completed = 0;
    const scheduledLearners = new Set<string>();
    const inProgressLearners = new Set<string>();
    for (const l of allBooked) {
      const s = getRangeBookedStatus(l, start, end);
      if (s.inProgress) inProgressLearners.add(getLearnerKey(l));
      if (s.scheduled) scheduledLearners.add(getLearnerKey(l));
      if (s.completed)  completed++;
    }
    scheduled = scheduledLearners.size;
    inProgress = inProgressLearners.size;
    return { total: allBooked.length, scheduled, inProgress, completed };
  }, [allBooked, prOffset, getRangeBookedStatus]);

  // ── displayedRows ─────────────────────────────────────────────────────
  const displayedRows = useMemo(() => {
    if (cardFilter === "all") return allBooked;
    const { start, end } = getPrDateRange(prOffset);
    return allBooked.filter((l) => {
      const s = getRangeBookedStatus(l, start, end);
      if (cardFilter === "inProgress") return s.inProgress;
      if (cardFilter === "scheduled")  return s.scheduled;
      if (cardFilter === "completed")  return s.completed;
      return true;
    });
  }, [cardFilter, allBooked, prOffset, getRangeBookedStatus]);

  // ── Follow-up nav ─────────────────────────────────────────────────────
  const onFollowUp = (l: PRLearner) => {
    const existing = ticketMap.get(l.email.toLowerCase());
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
        nextPrDate: l.nextPrDate || "",
      });
      navigate(`/progress-review/tickets?${params.toString()}`);
    }
  };

  const exportCSV = () => {
    const { start, end } = getPrDateRange(prOffset);
    const headers = ["Learner", "Email", "Coach", "Programme", "Last actual completed", "Last PR", "Booked PR Date", "PR Status"];
    const rows = displayedRows.map((l) => {
      const s = getRangeBookedStatus(l, start, end);
      const displayDate =
        cardFilter === "completed"   ? s.completedDate   :
        cardFilter === "inProgress"  ? s.inProgressDate  :
        cardFilter === "scheduled"   ? s.scheduledDate   :
        s.inProgressDate || s.scheduledDate || s.completedDate;
      const displayStatus =
        cardFilter === "completed"   ? s.completedStatus   :
        cardFilter === "inProgress"  ? s.inProgressStatus  :
        cardFilter === "scheduled"   ? s.scheduledStatus   :
        s.inProgressStatus || s.scheduledStatus || s.completedStatus;
      const statusLabel = (() => {
        const x = String(displayStatus || "").toLowerCase();
        if (x.includes("awaiting signature") || x.includes("in progress")) return "In Progress";
        if (x.includes("completed"))  return "Completed";
        if (x.includes("scheduled"))  return "Scheduled";
        return displayStatus || "";
      })();
      return [
        l.fullName,
        l.email,
        l.caseOwner || "",
        l.group || "",
        fmtProgressReviewText(l.lastActuallyCompletedPr),
        fmtProgressReviewText(l.lastProgressReview),
        fmtDate(displayDate),
        statusLabel,
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scheduled-pr-${getPrMonthLabel(prOffset).replace(/\s/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasFilters = prOffset !== "last12weeks" || search !== "" || programmeFilter !== "" || coachFilter !== "";

  const clearAll = () => {
    setPrOffset("last12weeks"); setSearch(""); setProgrammeFilter(""); setCoachFilter(""); setCardFilter("all");
  };

  // ── PR Status badge (for booked status display) ───────────────────────
  const BookedStatusBadge = ({ status }: { status: string }) => {
    const x = String(status || "").toLowerCase();
    const label =
      (x.includes("awaiting signature") || x.includes("in progress")) ? "In Progress" :
      x.includes("completed")  ? "Completed" :
      x.includes("scheduled")  ? "Scheduled" : status || "—";
    const cls =
      label === "Completed"   ? "bg-green-50 text-green-700 border-green-200" :
      label === "In Progress" ? "bg-blue-50 text-blue-700 border-blue-200" :
      label === "Scheduled"   ? "bg-teal-50 text-teal-700 border-teal-200" :
                                "bg-slate-50 text-slate-600 border-slate-200";
    return (
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
        {label}
      </span>
    );
  };

  return (
    <AppLayout>
      <div className="min-h-full bg-[#F4F8FC]">
        {/* Header */}
        <div className="border-b border-[#DDE7F0] bg-white px-4 pb-5 pt-4 sm:px-6">
          <BackButton to="/progress-review" label="Progress Review" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-[#14264A]">Scheduled PR</h1>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-[#5F7288]">
                <span>Default view: scheduled, in-progress, awaiting signature, or completed progress reviews</span>
                <span className="rounded-full bg-[#14264A] px-2.5 py-0.5 text-xs font-bold text-white shadow-sm">
                  Last 12 Weeks
                </span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={exportCSV}
                disabled={displayedRows.length === 0}
                className="flex items-center gap-1.5 rounded-lg border border-[#DDE7F0] bg-white px-3 py-2 text-xs font-semibold text-[#5F7288] hover:bg-[#F0F4F8] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="h-3.5 w-3.5" /> Export
              </button>
              <button onClick={loadAll} className="flex items-center gap-1.5 rounded-lg border border-[#DDE7F0] bg-white px-3 py-2 text-xs font-semibold text-[#5F7288] hover:bg-[#F0F4F8]">
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </button>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          {/* Row 1: Global filters */}
          <div className="mb-2 flex flex-wrap gap-2">
            <SimpleSelect
              value={programmeFilter}
              onChange={(v) => { setProgrammeFilter(v); setCardFilter("all"); }}
              options={programmeOptions}
              placeholder="All Programmes"
            />
            <SimpleSelect
              value={coachFilter}
              onChange={(v) => { setCoachFilter(v); setCardFilter("all"); }}
              options={coachOptions}
              placeholder="All Coaches"
            />
          </div>

          {/* Row 2: Search + PR Quarter */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative flex-1" style={{ minWidth: 200 }}>
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8AA0B6]" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setCardFilter("all"); }}
                placeholder="Search learner, email, coach…"
                className="h-10 rounded-lg border-[#D7E5F3] bg-white pl-9 text-sm"
              />
            </div>
            <FilterSelect<PrOffset>
              label="PR Quarter"
              value={prOffset}
              onChange={(v) => { setPrOffset(v === "last12weeks" ? "last12weeks" : Number(v) as PrOffset); setCardFilter("all"); }}
              options={QUARTER_OPTIONS}
            />
            <span className="flex h-10 items-center gap-1.5 rounded-lg border border-[#DDE7F0] bg-[#F8FBFE] px-3 text-xs font-medium text-[#5F7288]">
              <CalendarRange className="h-3.5 w-3.5 text-[#8AA0B6]" />
              {getPrRangeLabel(prOffset)}
            </span>
            {hasFilters && (
              <button onClick={clearAll} className="h-10 rounded-lg border border-[#DDE7F0] bg-white px-3 text-xs font-semibold text-[#71849A] hover:bg-[#F0F4F8]">
                Clear filters
              </button>
            )}
          </div>

          {/* Summary cards */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([
              {
                key: "all" as CardFilter,
                label: "Total Shown",
                count: summary.total,
                icon: <CalendarRange className="h-4 w-4" />,
                base: "border-[#DDE7F0] bg-white text-[#14264A]",
                active: "border-[#14264A] bg-[#14264A] text-white shadow-md",
                sub: `Period: ${getPrMonthLabel(prOffset)}`,
              },
              {
                key: "scheduled" as CardFilter,
                label: "Scheduled",
                count: summary.scheduled,
                icon: <CheckCircle2 className="h-4 w-4" />,
                base: "border-teal-200 bg-teal-50 text-teal-800",
                active: "border-teal-600 bg-teal-600 text-white shadow-md",
                sub: "Scheduled / In Progress",
              },
              {
                key: "inProgress" as CardFilter,
                label: "In Progress",
                count: summary.inProgress,
                icon: <AlertTriangle className="h-4 w-4" />,
                base: "border-blue-200 bg-blue-50 text-blue-800",
                active: "border-blue-600 bg-blue-600 text-white shadow-md",
                sub: "In progress / Awaiting signature",
              },
              {
                key: "completed" as CardFilter,
                label: "Completed",
                count: summary.completed,
                icon: <CheckCircle2 className="h-4 w-4" />,
                base: "border-green-200 bg-green-50 text-green-800",
                active: "border-green-600 bg-green-600 text-white shadow-md",
                sub: "PR done this period",
              },
            ]).map(({ key, label, count, icon, base, active, sub }) => {
              const isActive = cardFilter === key;
              return (
                <button
                  key={key}
                  onClick={() => setCardFilter(isActive ? "all" : key)}
                  className={`rounded-xl border p-3 text-left transition-all duration-150 hover:shadow-sm active:scale-[0.98] ${isActive ? active : base}`}
                >
                  <div className="flex items-center gap-2 opacity-70">{icon}<span className="text-xs font-semibold">{label}</span></div>
                  <p className="mt-1 text-2xl font-bold">{count}</p>
                  <p className="mt-0.5 text-sm font-semibold opacity-75">
                    {totalActive > 0 ? Math.round((count / totalActive) * 100) : 0}%
                    <span className="ml-1 text-[10px] font-normal opacity-70">of {totalActive} active</span>
                  </p>
                  <p className="mt-0.5 text-[10px] opacity-50">{sub}</p>
                </button>
              );
            })}
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
                  <button onClick={clearAll} className="text-xs font-semibold text-[#1E6ACB] hover:underline">
                    Clear all filters
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto" style={{ maxHeight: "60vh", overflowY: "auto" }}>
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-[#DDE7F0] bg-[#F8FBFE]">
                      <th className="sticky left-0 z-20 whitespace-nowrap border-r border-[#DDE7F0] bg-[#F8FBFE] px-3 py-3 text-left text-xs font-semibold text-[#5F7288]">Learner</th>
                      {["Email", "Coach", "Programme", "Last actual completed", "Last PR", "Booked PR Date", "PR Status", "Follow-up"].map((h) => (
                        <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-[#5F7288]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayedRows.map((l) => {
                      const { start, end } = getPrDateRange(prOffset);
                      const s = getRangeBookedStatus(l, start, end);
                      const displayDate =
                        cardFilter === "completed"   ? s.completedDate   :
                        cardFilter === "inProgress"  ? s.inProgressDate  :
                        cardFilter === "scheduled"   ? s.scheduledDate   :
                        s.inProgressDate || s.scheduledDate || s.completedDate;
                      const displayStatus =
                        cardFilter === "completed"   ? s.completedStatus   :
                        cardFilter === "inProgress"  ? s.inProgressStatus  :
                        cardFilter === "scheduled"   ? s.scheduledStatus   :
                        s.inProgressStatus || s.scheduledStatus || s.completedStatus;
                      const ticket = ticketMap.get(l.email.toLowerCase());
                      return (
                        <tr key={l.id} className="group border-b border-[#F0F4F8] transition-colors hover:bg-[#F8FBFE]">
                          <td className="sticky left-0 z-10 border-r border-[#DDE7F0] bg-white px-3 py-3 font-semibold text-[#14264A] group-hover:bg-[#F8FBFE]">{l.fullName}</td>
                          <td className="px-3 py-3 text-xs text-[#71849A]">{l.email}</td>
                          <td className="px-3 py-3 text-xs text-[#5F7288]">{l.caseOwner || "—"}</td>
                          <td className="px-3 py-3 text-xs text-[#5F7288] max-w-[180px]">
                            <span className="line-clamp-2">{l.group || "—"}</span>
                          </td>
                          <td className="px-3 py-3 text-xs text-[#5F7288]">{fmtProgressReviewText(l.lastActuallyCompletedPr)}</td>
                          <td className="px-3 py-3 text-xs text-[#5F7288]">{fmtProgressReviewText(l.lastProgressReview)}</td>
                          <td className="px-3 py-3 text-xs font-semibold text-[#14264A]">{fmtDate(displayDate)}</td>
                          <td className="px-3 py-3">
                            <BookedStatusBadge status={displayStatus} />
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
                <div className="border-t border-[#DDE7F0] px-4 py-2 text-xs text-[#8AA0B6]">
                  {displayedRows.length} learner{displayedRows.length !== 1 ? "s" : ""}
                  {cardFilter !== "all" && ` · ${cardFilter === "inProgress" ? "In Progress" : cardFilter === "scheduled" ? "Scheduled" : "Completed"}`}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
