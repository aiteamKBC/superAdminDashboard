import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck2, CheckCircle2, Clock, Download, Search } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import BackButton from "@/components/BackButton";
import { Input } from "@/components/ui/input";
import FilterSelect from "@/components/FilterSelect";

interface MCMRow {
  id: string;
  fullName: string;
  email: string;
  status: string;
  caseOwner: string;
  overdueMcmCount: number;
  nextDueDate: string | null;
  lastActuallyCompletedMcm: string;
  mcrStatus: string;
  programme: string;
  organisationName: string;
  mcmDates: { date: string; status: string; completed: boolean }[];
}

const fmtDate = (s: string | null) => {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return s; }
};

// ─── Mirrors dashboard getMcrMonthRange exactly ───────────────────────────────
function getMcrRange(offset: number): { start: Date; end: Date } {
  const now = new Date();
  if (offset === -1) {
    const end = new Date(now); end.setHours(23, 59, 59, 999);
    const start = new Date(end); start.setDate(end.getDate() - 30); start.setHours(0, 0, 0, 0);
    return { start, end };
  }
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1); start.setHours(0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0); end.setHours(23, 59, 59, 999);
  return { start, end };
}

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

type ScheduledCategory = "scheduled" | "in_progress" | "completed";

// Returns the matching MCM entry for the period plus its category
function getScheduledEntry(
  mcmDates: { date: string; status: string; completed: boolean }[],
  offset: number,
): { date: string; category: ScheduledCategory } | null {
  const { start, end } = getMcrRange(offset);
  const isPast = offset < 0;
  const excludeStart = offset === -1;

  const match = mcmDates.find((d) => {
    const dt = new Date(d.date);
    if (isNaN(dt.getTime())) return false;
    dt.setHours(0, 0, 0, 0);
    if (dt > end) return false;
    if (excludeStart ? dt <= start : dt < start) return false;

    const statusLow = d.status.toLowerCase();
    if (isPast) {
      return (
        statusLow.includes("completed") ||
        (statusLow.includes("scheduled") && !statusLow.includes("not")) ||
        statusLow.includes("in progress")
      );
    }
    return statusLow.includes("scheduled") && !statusLow.includes("not");
  });

  if (!match) return null;

  const s = match.status.toLowerCase();
  let category: ScheduledCategory = "scheduled";
  if (match.completed || s.includes("completed")) category = "completed";
  else if (s.includes("in progress") || s.includes("awaiting")) category = "in_progress";

  return { date: match.date, category };
}

const CATEGORY_CARDS: {
  key: ScheduledCategory;
  label: string;
  sub: string;
  icon: React.ReactNode;
  base: string;
  active: string;
}[] = [
  {
    key: "scheduled",
    label: "Scheduled",
    sub: "Session booked",
    icon: <CalendarCheck2 className="h-4 w-4" />,
    base:   "border-teal-200 bg-teal-50 text-teal-800",
    active: "border-teal-600 bg-teal-600 text-white shadow-md",
  },
  {
    key: "in_progress",
    label: "In Progress",
    sub: "In Progress / Awaiting Sig.",
    icon: <Clock className="h-4 w-4" />,
    base:   "border-blue-200 bg-blue-50 text-blue-800",
    active: "border-blue-600 bg-blue-600 text-white shadow-md",
  },
  {
    key: "completed",
    label: "Completed",
    sub: "MCM done this period",
    icon: <CheckCircle2 className="h-4 w-4" />,
    base:   "border-green-200 bg-green-50 text-green-800",
    active: "border-green-600 bg-green-600 text-white shadow-md",
  },
];

export default function ScheduledMCMPage() {
  const [all, setAll] = useState<MCMRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [coachFilter, setCoachFilter] = useState("all");
  const [programmeFilter, setProgrammeFilter] = useState("all");
  const [orgFilter, setOrgFilter] = useState("all");
  const [periodOffset, setPeriodOffset] = useState(-1);
  const [categoryFilter, setCategoryFilter] = useState<ScheduledCategory | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/mcr-summary/");
      if (res.ok) setAll(await res.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const coaches = useMemo(() => ["all", ...Array.from(new Set(all.map((r) => r.caseOwner).filter(Boolean))).sort()], [all]);
  const programmes = useMemo(() => ["all", ...Array.from(new Set(all.map((r) => r.programme).filter(Boolean))).sort()], [all]);
  const orgs = useMemo(() => ["all", ...Array.from(new Set(all.map((r) => r.organisationName).filter(Boolean))).sort()], [all]);

  // Period filter — attach scheduledDate + category
  const withScheduled = useMemo(() =>
    all
      .map((r) => {
        const entry = getScheduledEntry(r.mcmDates, periodOffset);
        return entry ? { ...r, scheduledDate: entry.date, category: entry.category } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null),
  [all, periodOffset]);

  // Search + coach + programme + org filters (without category) — used for card counts
  const periodFiltered = useMemo(() => {
    const q = search.toLowerCase();
    return withScheduled.filter((r) => {
      if (q && !r.fullName.toLowerCase().includes(q) && !r.email.toLowerCase().includes(q)) return false;
      if (coachFilter !== "all" && r.caseOwner !== coachFilter) return false;
      if (programmeFilter !== "all" && r.programme !== programmeFilter) return false;
      if (orgFilter !== "all" && r.organisationName !== orgFilter) return false;
      return true;
    });
  }, [withScheduled, search, coachFilter, programmeFilter, orgFilter]);

  // Category filter on top → final table rows
  const filtered = useMemo(() =>
    categoryFilter ? periodFiltered.filter((r) => r.category === categoryFilter) : periodFiltered,
  [periodFiltered, categoryFilter]);

  // Card counts per category
  const categoryCounts = useMemo(() => {
    const counts: Record<ScheduledCategory, number> = { scheduled: 0, in_progress: 0, completed: 0 };
    for (const r of periodFiltered) counts[r.category]++;
    return counts;
  }, [periodFiltered]);

  const exportCsv = () => {
    const cols = ["Name", "Email", "Programme", "Organisation", "Coach", "Scheduled Date", "Last Completed MCM"];
    const rows = filtered.map((r) => [r.fullName, r.email, r.programme, r.organisationName, r.caseOwner, fmtDate(r.scheduledDate), fmtDate(r.lastActuallyCompletedMcm)]);
    const csv = [cols, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "scheduled-mcm.csv"; a.click();
  };

  const hasFilters = coachFilter !== "all" || programmeFilter !== "all" || orgFilter !== "all" || periodOffset !== -1 || !!search || categoryFilter !== null;

  return (
    <AppLayout>
      <div className="min-h-full bg-[#F4F8FC]">
        <div className="border-b border-[#DDE7F0] bg-white px-4 pb-5 pt-4 sm:px-6">
          <BackButton to="/coaching-meetings" label="Monthly Coaching Meetings" />
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E8F0F9]">
              <CalendarCheck2 className="h-5 w-5 text-[#315D93]" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#14264A]">Scheduled MCM</h1>
              <p className="mt-0.5 text-sm text-[#5F7288]">
                Learners with scheduled coaching activity in the{" "}
                <strong className="font-bold text-[#315D93]">Last 30 days</strong>
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          {/* Summary */}
          <div className="mb-5">
            <div className="rounded-xl border border-[#DDE7F0] bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold text-[#5F7288]">Scheduled MCM</p>
              <p className="mt-1 text-3xl font-bold text-[#315D93]">
                {periodFiltered.length}
                <span className="ml-2 text-base font-normal text-[#8AA0B6]">of {all.length} active learners</span>
              </p>
            </div>
          </div>

          {/* Category cards */}
          <div className="mb-5 grid grid-cols-3 gap-3">
            {CATEGORY_CARDS.map((card) => {
              const count = categoryCounts[card.key];
              const isActive = categoryFilter === card.key;
              return (
                <button
                  key={card.key}
                  onClick={() => setCategoryFilter(isActive ? null : card.key)}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-left transition-all duration-150 ${isActive ? card.active : card.base + " hover:opacity-80"}`}
                >
                  <div className="mt-0.5 shrink-0">{card.icon}</div>
                  <div className="min-w-0">
                    <p className="text-2xl font-bold leading-none">{count}</p>
                    <p className="mt-1 text-sm font-semibold">{card.label}</p>
                    <p className={`mt-0.5 text-xs ${isActive ? "text-white/80" : "opacity-70"}`}>
                      {all.length ? Math.round((count / all.length) * 100) : 0}% of {all.length}
                    </p>
                    <p className={`mt-0.5 text-[11px] ${isActive ? "text-white/70" : "opacity-60"}`}>{card.sub}</p>
                  </div>
                </button>
              );
            })}
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

          {/* Filters — row 2: MCM Period + actions */}
          <div className="mb-4 flex flex-wrap gap-2">
            <FilterSelect
              value={String(periodOffset)}
              onChange={(v) => { setPeriodOffset(Number(v)); setCategoryFilter(null); }}
              options={PERIOD_OPTIONS.map((o) => ({ value: String(o.offset), label: o.label }))}
              minWidth={210}
            />
            {hasFilters && (
              <button
                onClick={() => { setSearch(""); setCoachFilter("all"); setProgrammeFilter("all"); setOrgFilter("all"); setPeriodOffset(-1); setCategoryFilter(null); }}
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
                <CalendarCheck2 className="h-8 w-8 text-[#C5D5E3]" /><p>No scheduled sessions found</p>
              </div>
            ) : (
              <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 500px)" }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#DDE7F0] bg-[#F8FBFE]">
                      <th className="sticky left-0 top-0 z-30 whitespace-nowrap border-r border-[#DDE7F0] bg-[#F8FBFE] px-3 py-3 text-left text-xs font-semibold text-[#5F7288]">Learner</th>
                      {["Email", "Programme", "Organisation", "Coach", "Scheduled Date", "Status", "Last Completed MCM"].map((h) => (
                        <th key={h} className="sticky top-0 z-10 whitespace-nowrap bg-[#F8FBFE] px-3 py-3 text-left text-xs font-semibold text-[#5F7288]">{h}</th>
                      ))}
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
                        <td className="px-3 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            r.category === "completed"  ? "bg-green-100 text-green-700" :
                            r.category === "in_progress"? "bg-blue-100 text-blue-700"  :
                                                          "bg-teal-100 text-teal-700"
                          }`}>
                            {fmtDate(r.scheduledDate)}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                            r.category === "completed"   ? "border-green-200 bg-green-50 text-green-700"  :
                            r.category === "in_progress" ? "border-blue-200 bg-blue-50 text-blue-700"    :
                                                           "border-teal-200 bg-teal-50 text-teal-700"
                          }`}>
                            {r.category === "completed" ? "Completed" : r.category === "in_progress" ? "In Progress" : "Scheduled"}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-xs text-[#5F7288]">{fmtDate(r.lastActuallyCompletedMcm)}</td>
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
