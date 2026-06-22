import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CalendarCheck2, CalendarClock, CalendarRange, CheckCircle2, Clock, Download, ExternalLink, Plus, Search, Ticket } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import BackButton from "@/components/BackButton";
import { Input } from "@/components/ui/input";
import FilterSelect from "@/components/FilterSelect";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface MCMRow {
  id: string;
  fullName: string;
  email: string;
  status: string;
  caseOwner: string;
  overdueMcmCount: number;
  nextDueDate: string | null;
  lastMcm: string;
  lastActuallyCompletedMcm: string;
  mcrStatus: string;
  programme: string;
  organisationName: string;
  mcmDates: { date: string; status: string; completed: boolean }[];
}

const fmtDate = (s: string | null | undefined) => {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const nextMeetingStatus = (row: MCMRow): string | null => {
  if (!row.nextDueDate) return null;
  const nextDate = new Date(row.nextDueDate);
  if (isNaN(nextDate.getTime())) return null;
  const nextDateStr = nextDate.toDateString();
  // Find the mcmDate entry matching nextDueDate
  const match = row.mcmDates.find((d) => {
    const dt = new Date(d.date);
    return !isNaN(dt.getTime()) && dt.toDateString() === nextDateStr;
  });
  return match?.status || null;
};

const statusBadge = (status: string | null) => {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s.includes("completed"))
    return <span className="inline-block whitespace-nowrap rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">Completed</span>;
  if (s.includes("in progress") || s.includes("awaiting"))
    return <span className="inline-block whitespace-nowrap rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">In Progress</span>;
  if (s.includes("not scheduled"))
    return <span className="inline-block whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">Not Scheduled</span>;
  if (s.includes("scheduled"))
    return <span className="inline-block whitespace-nowrap rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-semibold text-teal-700">Scheduled</span>;
  return <span className="inline-block whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{status}</span>;
};

const riskBadge = (count: number) => {
  if (count === 0) return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
      <CheckCircle2 className="h-3 w-3 shrink-0" /> On Track
    </span>
  );
  if (count <= 2) return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
      <AlertTriangle className="h-3 w-3 shrink-0" /> {count}
    </span>
  );
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
      <AlertTriangle className="h-3 w-3 shrink-0" /> {count}
    </span>
  );
};

function OverdueBadge({ row }: { row: MCMRow }) {
  const overdueMeetings = row.mcmDates.filter((d) => {
    if (d.completed) return false;
    const dt = new Date(d.date);
    if (isNaN(dt.getTime())) return false;
    return dt < new Date();
  });

  if (row.overdueMcmCount === 0) return riskBadge(0);

  if (!overdueMeetings.length) return riskBadge(row.overdueMcmCount);

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-default">{riskBadge(row.overdueMcmCount)}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[240px] p-0 border border-[#DDE7F0] bg-white shadow-xl rounded-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-[#DDE7F0] bg-[#F8FBFE]">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[#5F7288]">Overdue Meetings</p>
          </div>
          <div className="flex flex-col gap-0 px-3 py-2">
            {overdueMeetings.map((d, i) => (
              <div key={i} className="flex items-center justify-between gap-2 rounded-lg py-1">
                <span className="text-xs font-semibold text-[#14264A]">{fmtDate(d.date)}</span>
                <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 capitalize">{d.status || "Not Scheduled"}</span>
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Mirrors dashboard getMcrMonthRange / getMcrPeriodLabel logic exactly
function getMcrRange(offset: number): { start: Date; end: Date } {
  const now = new Date();
  if (offset === -1) {
    // "Last 30 days" — rolling 30-day window ending now
    const end = new Date(now); end.setHours(23, 59, 59, 999);
    const start = new Date(end); start.setDate(end.getDate() - 30); start.setHours(0, 0, 0, 0);
    return { start, end };
  }
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1); start.setHours(0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0); end.setHours(23, 59, 59, 999);
  return { start, end };
}

// Same options as dashboard MCM Period dropdown (no "All Periods")
function getMcmPeriodOptions() {
  const now = new Date();
  const opts: { label: string; offset: number }[] = [
    { label: "Last 30 days", offset: -1 },
    {
      label: `This Month - ${new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`,
      offset: 0,
    },
  ];
  for (let i = 1; i <= 5; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    opts.push({ label: d.toLocaleDateString("en-GB", { month: "long", year: "numeric" }), offset: i });
  }
  return opts;
}

const PERIOD_OPTIONS = getMcmPeriodOptions();

const fmtRangeDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

const getMcrRangeLabel = (offset: number): string => {
  const { start, end } = getMcrRange(offset);
  return `${fmtRangeDate(start)} – ${fmtRangeDate(end)}`;
};

// Exact same logic as dashboard coaching-due filter
function matchesPeriod(row: MCMRow, offset: number): boolean {
  const { start, end } = getMcrRange(offset);
  const isPast = offset < 0; // "Last 30 days"
  const excludeStart = offset === -1;
  const mcrToday = new Date(); mcrToday.setHours(0, 0, 0, 0);

  return row.mcmDates.some((d) => {
    const dt = new Date(d.date);
    if (isNaN(dt.getTime())) return false;
    dt.setHours(0, 0, 0, 0);
    // mirror isDateWithinRange(dt, start, end, excludeStart)
    if (dt > end) return false;
    if (excludeStart ? dt <= start : dt < start) return false;
    // Past period (Last 30 days): include ALL statuses
    if (isPast) return true;
    // Current / future months: only pending/due
    if (d.completed) return false;
    const statusLow = d.status.toLowerCase();
    const isScheduled = statusLow.includes("scheduled") && !statusLow.includes("not");
    if (dt > mcrToday && isScheduled) return false;
    return true;
  });
}

type MCMCategory = "not_scheduled" | "scheduled" | "in_progress" | "completed";

function getMcmCategory(row: MCMRow, offset: number): MCMCategory {
  const { start, end } = getMcrRange(offset);
  const isPast = offset < 0;
  const excludeStart = offset === -1;

  // Keep category selection identical to Scheduled MCM: use the first
  // qualifying entry in the source order for the selected period.
  const match = row.mcmDates.find((d) => {
    const dt = new Date(d.date);
    if (isNaN(dt.getTime())) return false;
    dt.setHours(0, 0, 0, 0);
    if (dt > end) return false;
    if (excludeStart ? dt <= start : dt < start) return false;

    const s = d.status.toLowerCase();
    if (isPast) {
      return (
        s.includes("completed") ||
        (s.includes("scheduled") && !s.includes("not")) ||
        s.includes("in progress")
      );
    }
    return s.includes("scheduled") && !s.includes("not");
  });

  if (!match) return "not_scheduled";

  const status = match.status.toLowerCase();
  if (match.completed || status.includes("completed")) return "completed";
  if (status.includes("in progress") || status.includes("awaiting")) return "in_progress";
  return "scheduled";
}

const CATEGORY_CARDS = [
  {
    key: "not_scheduled" as MCMCategory,
    label: "Not Scheduled",
    sub: "No session booked",
    icon: <AlertTriangle className="h-4 w-4" />,
    base:   "border-red-200 bg-red-50 text-red-800",
    active: "border-red-600 bg-red-600 text-white shadow-md",
  },
  {
    key: "scheduled" as MCMCategory,
    label: "Scheduled",
    sub: "Session booked",
    icon: <CalendarCheck2 className="h-4 w-4" />,
    base:   "border-teal-200 bg-teal-50 text-teal-800",
    active: "border-teal-600 bg-teal-600 text-white shadow-md",
  },
  {
    key: "in_progress" as MCMCategory,
    label: "In Progress",
    sub: "In Progress / Awaiting Sig.",
    icon: <Clock className="h-4 w-4" />,
    base:   "border-blue-200 bg-blue-50 text-blue-800",
    active: "border-blue-600 bg-blue-600 text-white shadow-md",
  },
  {
    key: "completed" as MCMCategory,
    label: "Completed",
    sub: "MCM done this period",
    icon: <CheckCircle2 className="h-4 w-4" />,
    base:   "border-green-200 bg-green-50 text-green-800",
    active: "border-green-600 bg-green-600 text-white shadow-md",
  },
];

type OpenTicket = { id: number; ticketRef: string; learnerEmail: string; status: string };

export default function RequiredMCMPage() {
  const navigate = useNavigate();
  const [all, setAll] = useState<MCMRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [ticketMap, setTicketMap] = useState<Record<string, OpenTicket>>({});
  const [search, setSearch] = useState("");
  const [coachFilter, setCoachFilter] = useState("all");
  const [programmeFilter, setProgrammeFilter] = useState("all");
  const [orgFilter, setOrgFilter] = useState("all");
  const [periodOffset, setPeriodOffset] = useState(-1);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<MCMCategory | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/mcr-summary/");
      if (res.ok) setAll(await res.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    fetch("/api/mcm-tickets/?archived=false")
      .then((r) => r.ok ? r.json() : [])
      .then((tickets: OpenTicket[]) => {
        const map: Record<string, OpenTicket> = {};
        for (const t of tickets) {
          if (t.status !== "resolved") map[t.learnerEmail.toLowerCase()] = t;
        }
        setTicketMap(map);
      })
      .catch(() => {});
  }, []);

  // Count of period-filtered learners who have at least 1 overdue MCM
  const totalOverdue = useMemo(() => {
    const q = search.toLowerCase();
    return all.filter((r) => {
      if (!matchesPeriod(r, periodOffset)) return false;
      if (q && !r.fullName.toLowerCase().includes(q) && !r.email.toLowerCase().includes(q)) return false;
      if (coachFilter !== "all" && r.caseOwner !== coachFilter) return false;
      if (programmeFilter !== "all" && r.programme !== programmeFilter) return false;
      if (orgFilter !== "all" && r.organisationName !== orgFilter) return false;
      return r.overdueMcmCount >= 1;
    }).length;
  }, [all, search, coachFilter, programmeFilter, orgFilter, periodOffset]);

  const coaches = useMemo(() => ["all", ...Array.from(new Set(all.map((r) => r.caseOwner).filter(Boolean))).filter((c) => !["default owner", "enrolment team"].includes(c.toLowerCase())).sort()], [all]);
  const programmes = useMemo(() => ["all", ...Array.from(new Set(all.map((r) => r.programme).filter(Boolean))).sort()], [all]);
  const orgs = useMemo(() => ["all", ...Array.from(new Set(all.map((r) => r.organisationName).filter(Boolean))).sort()], [all]);

  // Period + dropdown filters (without categoryFilter) — used for card counts
  const periodFiltered = useMemo(() => {
    const q = search.toLowerCase();
    return all.filter((r) => {
      if (!matchesPeriod(r, periodOffset)) return false;
      if (overdueOnly && r.overdueMcmCount < 1) return false;
      if (q && !r.fullName.toLowerCase().includes(q) && !r.email.toLowerCase().includes(q)) return false;
      if (coachFilter !== "all" && r.caseOwner !== coachFilter) return false;
      if (programmeFilter !== "all" && r.programme !== programmeFilter) return false;
      if (orgFilter !== "all" && r.organisationName !== orgFilter) return false;
      return true;
    });
  }, [all, search, coachFilter, programmeFilter, orgFilter, periodOffset, overdueOnly]);

  // Category breakdown — counts per MCM status within the period
  const categoryCounts = useMemo(() => {
    const counts: Record<MCMCategory, number> = { not_scheduled: 0, scheduled: 0, in_progress: 0, completed: 0 };
    for (const r of periodFiltered) counts[getMcmCategory(r, periodOffset)]++;
    return counts;
  }, [periodFiltered, periodOffset]);

  // Final rows = period filtered + optional category filter
  const filtered = useMemo(() =>
    categoryFilter ? periodFiltered.filter((r) => getMcmCategory(r, periodOffset) === categoryFilter) : periodFiltered,
  [periodFiltered, categoryFilter, periodOffset]);

  const exportCsv = () => {
    const cols = ["Name", "Email", "Programme", "Organisation", "Coach", "Overdue Count", "Next Due Date", "Last MCM", "Last Completed MCM"];
    const rows = filtered.map((r) => [r.fullName, r.email, r.programme, r.organisationName, r.caseOwner, r.overdueMcmCount, fmtDate(r.nextDueDate), r.lastMcm || "—", r.lastActuallyCompletedMcm || "—"]);
    const csv = [cols, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "required-mcm.csv"; a.click();
  };

  return (
    <AppLayout>
      <div className="min-h-full bg-[#F4F8FC]">
        <div className="border-b border-[#DDE7F0] bg-white px-4 pb-5 pt-4 sm:px-6">
          <BackButton to="/coaching-meetings" label="Monthly Coaching Meetings" />
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E8F0F9]">
                <CalendarClock className="h-5 w-5 text-[#315D93]" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-[#14264A]">Required MCM</h1>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-[#5F7288]">
                  <span>
                    Learners requiring monthly coaching action in the{" "}
                    <strong className="font-bold text-[#315D93]">Last 30 days</strong>
                  </span>
                  <span className="rounded-full bg-[#14264A] px-2.5 py-0.5 text-xs font-bold text-white shadow-sm">
                    {loading ? "..." : all.length} active learners
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          {/* Summary cards — same pattern as PR page */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {(() => {
              const count = periodFiltered.length;
              const isActive = categoryFilter === null && !overdueOnly;
              return (
                <button
                  onClick={() => { setCategoryFilter(null); setOverdueOnly(false); }}
                  className={`rounded-xl border p-3 text-left transition-all duration-150 hover:shadow-sm active:scale-[0.98] ${isActive ? "border-[#14264A] bg-[#14264A] text-white shadow-md" : "border-[#DDE7F0] bg-white text-[#14264A]"}`}
                >
                  <div className="flex items-center gap-2 opacity-70">
                    <CalendarRange className="h-4 w-4" />
                    <span className="text-xs font-semibold">Total Shown</span>
                  </div>
                  <p className="mt-1 text-2xl font-bold">{count}</p>
                  <p className="mt-0.5 text-[11px] opacity-60">
                    Period: {PERIOD_OPTIONS.find((option) => option.offset === periodOffset)?.label || "Selected period"}
                  </p>
                </button>
              );
            })()}
            {CATEGORY_CARDS.map(({ key, label, sub, icon, base, active }) => {
              const count = categoryCounts[key];
              const totalShown = periodFiltered.length;
              const pct = totalShown ? Math.round((count / totalShown) * 100) : 0;
              const isActive = categoryFilter === key;
              return (
                <button
                  key={key}
                  onClick={() => { setOverdueOnly(false); setCategoryFilter(isActive ? null : key); }}
                  className={`rounded-xl border p-3 text-left transition-all duration-150 hover:shadow-sm active:scale-[0.98] ${isActive ? active : base}`}
                >
                  <div className="flex items-center gap-2 opacity-70">
                    {icon}
                    <span className="text-xs font-semibold">{label}</span>
                  </div>
                  <p className="mt-1 text-2xl font-bold">{count}</p>
                  <p className="mt-0.5 text-sm font-semibold opacity-75">
                    {pct}%
                    <span className="ml-1 text-[10px] font-normal opacity-70">of {totalShown} shown</span>
                  </p>
                  <p className="mt-0.5 text-[11px] opacity-60">{sub}</p>
                </button>
              );
            })}
            {(() => {
              const count = totalOverdue;
              return (
                <button
                  onClick={() => { setCategoryFilter(null); setOverdueOnly((current) => !current); }}
                  className={`rounded-xl border p-3 text-left transition-all duration-150 hover:shadow-sm active:scale-[0.98] ${overdueOnly ? "border-amber-500 bg-amber-500 text-white shadow-md" : "border-amber-200 bg-amber-50 text-amber-800"}`}
                >
                  <div className="flex items-center gap-2 opacity-70">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-xs font-semibold">Overdue</span>
                  </div>
                  <p className="mt-1 text-2xl font-bold">{count}</p>
                  <p className="mt-0.5 text-[11px] opacity-60">Past date, not completed</p>
                </button>
              );
            })()}
          </div>

          {/* Filters — row 1 */}
          <div className="mb-2 flex flex-wrap gap-2">
            <div className="relative flex-1" style={{ minWidth: 200 }}>
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8AA0B6]" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email…" className="h-10 rounded-lg border-[#D7E5F3] bg-white pl-9 text-sm" />
            </div>
            <FilterSelect
              value={programmeFilter}
              onChange={setProgrammeFilter}
              options={[{ value: "all", label: "All Programmes" }, ...programmes.filter((p) => p !== "all").map((p) => ({ value: p, label: p }))]}
              minWidth={180}
            />
            <FilterSelect
              value={coachFilter}
              onChange={setCoachFilter}
              options={[{ value: "all", label: "All Coaches" }, ...coaches.filter((c) => c !== "all").map((c) => ({ value: c, label: c }))]}
              minWidth={160}
            />
            <FilterSelect
              value={orgFilter}
              onChange={setOrgFilter}
              options={[{ value: "all", label: "All Organizations" }, ...orgs.filter((o) => o !== "all").map((o) => ({ value: o, label: o }))]}
              minWidth={180}
            />
          </div>

          {/* Filters — row 2: MCM Period + Overdue toggle */}
          <div className="mb-4 flex flex-wrap gap-2">
            <FilterSelect
              value={String(periodOffset)}
              onChange={(v) => setPeriodOffset(Number(v))}
              options={PERIOD_OPTIONS.map((o) => ({ value: String(o.offset), label: o.label }))}
              minWidth={210}
            />
            <span className="flex h-10 items-center gap-1.5 rounded-lg border border-[#DDE7F0] bg-[#F8FBFE] px-3 text-xs font-medium text-[#5F7288]">
              <CalendarRange className="h-3.5 w-3.5 text-[#8AA0B6]" />
              {getMcrRangeLabel(periodOffset)}
            </span>
            {(coachFilter !== "all" || programmeFilter !== "all" || orgFilter !== "all" || periodOffset !== -1 || search || overdueOnly || categoryFilter) && (
              <button
                onClick={() => { setSearch(""); setCoachFilter("all"); setProgrammeFilter("all"); setOrgFilter("all"); setPeriodOffset(-1); setOverdueOnly(false); setCategoryFilter(null); }}
                className="h-10 rounded-lg border border-[#DDE7F0] bg-white px-3 text-sm text-[#5F7288] hover:bg-[#F0F6FF]"
              >
                Clear Filters
              </button>
            )}
            <button onClick={exportCsv} className="ml-auto flex h-10 items-center gap-1.5 rounded-lg border border-[#DDE7F0] bg-white px-3 text-sm font-semibold text-[#24486D] hover:bg-[#F0F6FF]">
              <Download className="h-4 w-4" /> Export CSV
            </button>
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-xl border border-[#DDE7F0] bg-white shadow-sm">
            {loading ? (
              <div className="flex h-40 items-center justify-center text-sm text-[#5F7288]">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-[#5F7288]">
                <AlertTriangle className="h-8 w-8 text-[#C5D5E3]" /><p>No learners found</p>
              </div>
            ) : (
              <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 400px)" }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#DDE7F0] bg-[#F8FBFE]">
                      <th className="sticky left-0 top-0 z-30 whitespace-nowrap border-r border-[#DDE7F0] bg-[#F8FBFE] px-3 py-3 text-left text-xs font-semibold text-[#5F7288]">Learner</th>
                      {["Email", "Programme", "Organisation", "Coach", "Overdue", "Last MCM", "Last Completed MCM"].map((h) => (
                        <th key={h} className="sticky top-0 z-10 whitespace-nowrap bg-[#F8FBFE] px-3 py-3 text-left text-xs font-semibold text-[#5F7288]">{h}</th>
                      ))}
                      <th colSpan={2} className="sticky top-0 z-10 bg-[#F8FBFE] px-3 py-1.5 text-center text-xs font-semibold text-[#5F7288] border-l border-[#DDE7F0]">
                        Next Due Date
                        <div className="flex mt-1 border-t border-[#DDE7F0]">
                          <span className="flex-1 py-1 text-[10px] font-semibold text-[#8AA0B6]">Date</span>
                          <span className="flex-1 py-1 text-[10px] font-semibold text-[#8AA0B6]">State</span>
                        </div>
                      </th>
                      <th className="sticky top-0 z-10 whitespace-nowrap bg-[#F8FBFE] px-3 py-3 text-left text-xs font-semibold text-[#5F7288] border-l border-[#DDE7F0]">Follow-up</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.id} className="group border-b border-[#F0F4F8] hover:bg-[#F8FBFE]">
                        <td className="sticky left-0 z-10 border-r border-[#DDE7F0] bg-white px-3 py-3 font-semibold text-[#14264A] group-hover:bg-[#F8FBFE]">{r.fullName}</td>
                        <td className="px-3 py-3 text-xs text-[#71849A]">{r.email}</td>
                        <td className="px-3 py-3 text-xs text-[#5F7288]">{r.programme || "—"}</td>
                        <td className="px-3 py-3 text-xs text-[#5F7288]">{r.organisationName || "—"}</td>
                        <td className="px-3 py-3 text-xs text-[#5F7288]">{r.caseOwner || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-3"><OverdueBadge row={r} /></td>
                        <td className="px-3 py-3 text-xs text-[#5F7288]">{r.lastMcm || "—"}</td>
                        <td className="px-3 py-3 text-xs text-[#5F7288]">{r.lastActuallyCompletedMcm || "—"}</td>
                        {/* Next Due Date — Date cell */}
                        <td className="border-l border-[#DDE7F0] px-3 py-3 text-xs font-semibold">
                          {(() => {
                            const d = r.nextDueDate ? new Date(r.nextDueDate) : null;
                            const isOverdue = d && !isNaN(d.getTime()) && d < new Date();
                            return <span className={isOverdue ? "text-red-600" : "text-[#14264A]"}>{fmtDate(r.nextDueDate)}</span>;
                          })()}
                        </td>
                        {/* Next Due Date — State cell */}
                        <td className="whitespace-nowrap px-3 py-3">{statusBadge(nextMeetingStatus(r))}</td>
                        {/* Follow-up */}
                        <td className="whitespace-nowrap border-l border-[#DDE7F0] px-3 py-3">
                          {(() => {
                            const ticket = ticketMap[r.email.toLowerCase()];
                            if (ticket) {
                              return (
                                <button
                                  onClick={() => navigate(`/coaching-meetings/tickets?learner=${encodeURIComponent(r.email)}`)}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#EEF3FB] px-2.5 py-1.5 text-xs font-bold text-[#315D93] hover:bg-[#D7E8F7] transition-colors"
                                >
                                  <Ticket className="h-3 w-3 shrink-0" />
                                  {ticket.ticketRef}
                                  <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                                </button>
                              );
                            }
                            return (
                              <button
                                onClick={() => navigate(`/coaching-meetings/tickets?newFor=${encodeURIComponent(r.email)}&newName=${encodeURIComponent(r.fullName)}`)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[#B8D7F2] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#5F7288] hover:border-[#315D93] hover:bg-[#F0F7FF] hover:text-[#315D93] transition-colors"
                              >
                                <Plus className="h-3 w-3 shrink-0" />
                                Open Ticket
                              </button>
                            );
                          })()}
                        </td>
                      </tr>
                    ))}
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
