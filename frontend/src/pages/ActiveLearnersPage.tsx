import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle, Download, GraduationCap,
  RefreshCw, Search, Shield, TrendingUp, Users, X,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import BackButton from "@/components/BackButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ─── Types ────────────────────────────────────────────────────────────

interface Learner {
  id: number;
  fullName: string;
  email: string;
  group: string;
  otjMinimum: number;
  otjPlanned: number;
  otjSubmitted: number;
  otjCompleted: number;
  otjExpected: number;
  otjForecast: number;
  progressVariance: string;
  progressHours: string;
  otjHoursStatus: string;
  ksbStatus: string;
  startDate: string | null;
  endDate: string | null;
  totalDays: number | null;
  elapsedDays: number | null;
  programName: string;
  programStatus: string;
  subprogramme: string;
  compStatus: string;
  completedCompPct: string;
  targetCompPct: string;
  totalCompCount: number | null;
  targetCompCount: number | null;
  completedCompCount: number | null;
  ownerName: string;
  ownerEmail: string;
  coachRag: string;
  organizationName: string;
  managerName: string;
  managerEmail: string;
  managerPhone: string;
  employerRepresentative: string;
  employerEmail: string;
  learnerPhone: string;
  gender: string;
  disability: string;
  subscriptionStatus: string;
  levyOrNot: string;
  workingHours: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return iso; }
};

const ragBadge = (rag: string) => {
  const r = (rag || "").toLowerCase();
  if (r === "red") return <span className="inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">Red</span>;
  if (r === "amber") return <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">Amber</span>;
  if (r === "green") return <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">Green</span>;
  return <span className="text-xs text-[#A0B0C0]">—</span>;
};

const fmtHoursMin = (h: number) => {
  if (!h || h <= 0) return "—";
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return `${hrs}h ${mins}m`;
};

// Parse APTEM progress hours field — handles both decimal ("-166.93") and formatted ("-166h 56m")
const parseProgressHours = (s: string): number => {
  if (!s) return 0;
  const trimmed = s.trim();
  const sign = trimmed.startsWith('-') ? -1 : 1;
  // "166h 56m" or "-166h 56m"
  const fullMatch = trimmed.match(/(\d+)h\s*(\d+)m/);
  if (fullMatch) return sign * (parseInt(fullMatch[1]) + parseInt(fullMatch[2]) / 60);
  // "166h" or "-166h"
  const hMatch = trimmed.match(/(\d+)h/);
  if (hMatch) return sign * parseInt(hMatch[1]);
  // plain number "-166.93"
  const n = parseFloat(trimmed);
  return isNaN(n) ? 0 : n;
};

// Calculate Target Now dynamically from actual current date + programme dates
// Formula: Planned Total × (elapsed days / total days)
const calcTargetNow = (startDate: string | null, endDate: string | null, otjPlanned: number): number => {
  if (!startDate || !endDate || otjPlanned <= 0) return 0;
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  const now = new Date().getTime();
  if (end <= start) return 0;
  const totalMs = end - start;
  const elapsedMs = Math.max(0, Math.min(now - start, totalMs));
  return (otjPlanned * elapsedMs) / totalMs;
};

const otjBadge = (status: string) => {
  const s = (status || "").toLowerCase();
  if (s === "at risk") return <span className="inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">At Risk</span>;
  if (s === "behind") return <span className="inline-flex rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-700">Behind</span>;
  if (s === "on track") return <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">On Track</span>;
  return <span className="text-xs text-[#A0B0C0]">{status || "—"}</span>;
};

// KPI formula: gap as % of planned total (matches learner KPI widget)
// "29% behind" = (target_now - completed) / planned_total × 100
// bar fill      = completed / target_now × 100 (capped at 100%)
const otjKpi = (completed: number, expected: number) => {
  const barPct = expected > 0 ? Math.min(Math.round((completed / expected) * 100), 100) : 0;
  const ahead = completed >= expected;
  return { barPct, ahead };
};

// ─── Main Page ─────────────────────────────────────────────────────────

// Portal-based tooltip — renders on document.body to escape table overflow clipping
function CompTooltip({ l }: { l: Learner }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  if (l.totalCompCount == null) return <span className="text-xs text-[#5F7288]">{l.completedCompPct || "—"}</span>;
  const remaining = (l.totalCompCount ?? 0) - (l.completedCompCount ?? 0);
  return (
    <span
      onMouseEnter={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setPos(null)}
      className="cursor-help"
    >
      <span className="font-semibold text-[#14264A]">{l.completedCompPct || "—"}</span>
      <span className="ml-1 text-[10px] text-[#A0B0C0]">({l.completedCompCount ?? "?"}/{l.totalCompCount})</span>
      {pos && createPortal(
        <div
          className="pointer-events-none w-60 rounded-2xl bg-[#14264A] p-4 shadow-2xl ring-1 ring-white/10"
          style={{
            position: "fixed",
            left: Math.min(pos.x + 18, window.innerWidth - 260),
            top: pos.y - 200 < 8 ? pos.y + 18 : pos.y - 200,
            zIndex: 9999,
          }}
        >
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-[#7EA8C9]">Learning Plan Activities</p>
          <p className="mb-3 text-center">
            <span className="text-3xl font-bold text-white">{l.completedCompCount ?? "—"}</span>
            <span className="ml-1 text-sm text-[#7EA8C9]">of {l.totalCompCount}</span>
          </p>
          <div className="space-y-2 border-t border-white/10 pt-3">
            {[
              { label: "Target",    value: l.targetCompCount },
              { label: "Completed", value: l.completedCompCount },
              { label: "Remaining", value: remaining },
              { label: "Comp %",    value: l.completedCompPct || "—" },
              { label: "Status",    value: l.compStatus || "—" },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-xs text-[#7EA8C9]">{label}</span>
                <span className={`text-xs font-semibold ${label === "Status" && String(value).toLowerCase() === "behind" ? "text-red-400" : label === "Status" && String(value).toLowerCase() === "on track" ? "text-green-400" : "text-white"}`}>
                  {value ?? "—"}
                </span>
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </span>
  );
}

export default function ActiveLearnersPage() {
  const [all, setAll] = useState<Learner[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [coachFilter, setCoachFilter] = useState("all");
  const [ragFilter, setRagFilter] = useState("all");
  const [otjFilter, setOtjFilter] = useState("all");
  const [levyFilter, setLevyFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/aptem-learners/");
      if (res.ok) {
        const data: Learner[] = await res.json();
        setAll(data);
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Unique statuses for dropdown
  const statusOptions = useMemo(() => Array.from(new Set(all.map((l) => l.programStatus).filter(Boolean))).sort(), [all]);

  // Status-filtered base (default: active only)
  const statusFiltered = useMemo(() =>
    statusFilter === "all"
      ? all
      : all.filter((l) => (l.programStatus || "").toLowerCase() === statusFilter.toLowerCase()),
  [all, statusFilter]);

  // Filter options derived from status-filtered base
  const coaches = useMemo(() => Array.from(new Set(statusFiltered.map((l) => l.ownerName).filter(Boolean))).sort(), [statusFiltered]);
  const otjStatuses = useMemo(() => Array.from(new Set(statusFiltered.map((l) => l.otjHoursStatus).filter(Boolean))).sort(), [statusFiltered]);
  const levyOptions = useMemo(() => Array.from(new Set(statusFiltered.map((l) => l.levyOrNot).filter(Boolean))).sort(), [statusFiltered]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return statusFiltered.filter((l) => {
      if (q && !l.fullName.toLowerCase().includes(q) && !l.email.toLowerCase().includes(q) && !l.organizationName.toLowerCase().includes(q) && !l.programName.toLowerCase().includes(q)) return false;
      if (coachFilter !== "all" && l.ownerName !== coachFilter) return false;
      if (ragFilter !== "all" && (l.coachRag || "").toLowerCase() !== ragFilter) return false;
      if (otjFilter !== "all" && (l.otjHoursStatus || "").toLowerCase().trim() !== otjFilter.toLowerCase().trim()) return false;
      if (levyFilter !== "all" && l.levyOrNot !== levyFilter) return false;
      return true;
    });
  }, [statusFiltered, search, coachFilter, ragFilter, otjFilter, levyFilter]);

  // Summary stats based on status-filtered base
  const stats = useMemo(() => ({
    total: statusFiltered.length,
    redRag: statusFiltered.filter((l) => (l.coachRag || "").toLowerCase() === "red").length,
    otjAtRisk: statusFiltered.filter((l) => (l.otjHoursStatus || "").toLowerCase() === "at risk").length,
    otjBehind: statusFiltered.filter((l) => (l.otjHoursStatus || "").toLowerCase() === "need attention").length,
    levy: statusFiltered.filter((l) => (l.levyOrNot || "").toLowerCase().includes("levy")).length,
  }), [statusFiltered]);

  const activeFilters = [coachFilter !== "all", ragFilter !== "all", otjFilter !== "all", levyFilter !== "all"].filter(Boolean).length;

  const clearFilters = () => { setSearch(""); setCoachFilter("all"); setRagFilter("all"); setOtjFilter("all"); setLevyFilter("all"); setStatusFilter("active"); };

  const exportCsv = () => {
    const cols = ["Name", "Email", "Phone", "Organisation", "Programme", "Subprogramme", "Coach", "Coach RAG", "Start Date", "End Date", "Elapsed Days", "OTJ Status", "OTJ Completed", "OTJ Target Now", "vs Target %", "KSB Status", "Comp Status", "Comp %", "Subscription Status", "Levy", "Working Hours", "Gender", "Disability"];
    const rows = filtered.map((l) => [
      l.fullName, l.email, l.learnerPhone, l.organizationName, l.programName, l.subprogramme,
      l.ownerName, l.coachRag, fmtDate(l.startDate), fmtDate(l.endDate), l.elapsedDays ?? "",
      l.otjHoursStatus, fmtHoursMin(l.otjCompleted), fmtHoursMin(calcTargetNow(l.startDate, l.endDate, l.otjPlanned)), (() => { const varianceNum = parseFloat(l.progressVariance || "0") || 0; const pct = Math.abs(Math.round(varianceNum)); const ph = parseProgressHours(l.progressHours); return `${pct}% ${ph >= 0 ? "ahead" : "behind"}`; })(), fmtHoursMin(parseProgressHours(l.progressHours) < 0 ? Math.abs(parseProgressHours(l.progressHours)) : 0),
      l.ksbStatus, l.compStatus, l.completedCompPct,
      l.subscriptionStatus, l.levyOrNot, l.workingHours, l.gender, l.disability,
    ]);
    const csv = [cols, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "active-learners.csv";
    a.click();
  };

  return (
    <AppLayout>
      <div className="min-h-full bg-[#F4F8FC]">
        {/* Header */}
        <div className="border-b border-[#DDE7F0] bg-white px-4 pb-5 pt-4 sm:px-6">
          <BackButton to="/" label="Home" />
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#DDE7F0]">
                <GraduationCap className="h-5 w-5 text-[#14264A]" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-[#14264A]">Active Learners</h1>
                <p className="mt-0.5 text-sm text-[#5F7288]">All currently active learners and their status</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={load} className="h-9 gap-1.5 rounded-lg border-[#DDE7F0] bg-white text-[#24486D]">
                <RefreshCw className="h-4 w-4" /> Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={exportCsv} className="h-9 gap-1.5 rounded-lg border-[#DDE7F0] bg-white text-[#24486D]">
                <Download className="h-4 w-4" /> Export CSV
              </Button>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          {/* Summary cards */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Total", value: stats.total, icon: Users, color: "text-[#14264A]", bg: "bg-[#EEF3FA] border-[#DDE7F0]" },
              { label: "Red Coach RAG", value: stats.redRag, icon: Shield, color: "text-red-700", bg: "bg-red-50 border-red-200" },
              { label: "OTJ At Risk", value: stats.otjAtRisk, icon: AlertTriangle, color: "text-red-700", bg: "bg-red-50 border-red-200" },
              { label: "Need Attention", value: stats.otjBehind, icon: TrendingUp, color: "text-amber-700", bg: "bg-amber-50 border-amber-200" },
            ].map(({ label, value, icon: Icon, color, bg }) => (
              <div key={label} className={`rounded-xl border p-4 ${bg}`}>
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${color}`} />
                  <span className={`text-xs font-semibold ${color}`}>{label}</span>
                </div>
                <p className={`mt-2 text-2xl font-bold ${color}`}>{loading ? "…" : value}</p>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative flex-1" style={{ minWidth: 220 }}>
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8AA0B6]" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, organisation, programme…" className="h-10 rounded-lg border-[#D7E5F3] bg-white pl-9 text-sm" />
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-10 rounded-lg border border-[#D7E5F3] bg-white px-3 text-sm text-[#24486D] focus:outline-none">
              <option value="active">Active</option>
              <option value="all">All Statuses</option>
              {statusOptions.filter((s) => s.toLowerCase() !== "active").map((s) => <option key={s} value={s.toLowerCase()}>{s}</option>)}
            </select>
            <select value={coachFilter} onChange={(e) => setCoachFilter(e.target.value)} className="h-10 rounded-lg border border-[#D7E5F3] bg-white px-3 text-sm text-[#24486D] focus:outline-none">
              <option value="all">All Coaches</option>
              {coaches.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={ragFilter} onChange={(e) => setRagFilter(e.target.value)} className="h-10 rounded-lg border border-[#D7E5F3] bg-white px-3 text-sm text-[#24486D] focus:outline-none">
              <option value="all">All Coach RAG</option>
              <option value="red">Red</option>
              <option value="amber">Amber</option>
              <option value="green">Green</option>
            </select>
            <select value={otjFilter} onChange={(e) => setOtjFilter(e.target.value)} className="h-10 rounded-lg border border-[#D7E5F3] bg-white px-3 text-sm text-[#24486D] focus:outline-none">
              <option value="all">All OTJ Status</option>
              <option value="At Risk">At Risk</option>
              <option value="On Track">On Track</option>
              <option value="Need Attention">Need Attention</option>
            </select>
            <select value={levyFilter} onChange={(e) => setLevyFilter(e.target.value)} className="h-10 rounded-lg border border-[#D7E5F3] bg-white px-3 text-sm text-[#24486D] focus:outline-none">
              <option value="all">All Levy</option>
              {levyOptions.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            {activeFilters > 0 && (
              <Button variant="outline" size="sm" onClick={clearFilters} className="h-10 gap-1 rounded-lg border-[#DDE7F0] bg-white text-[#5F7288]">
                <X className="h-3.5 w-3.5" /> Clear ({activeFilters})
              </Button>
            )}
            <span className="ml-auto text-xs text-[#71849A]">
              {loading ? "Loading…" : `${filtered.length} of ${statusFiltered.length} learners`}
            </span>
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-xl border border-[#DDE7F0] bg-white shadow-sm">
            {loading ? (
              <div className="flex h-40 items-center justify-center text-sm text-[#5F7288]">Loading learners…</div>
            ) : filtered.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-[#5F7288]">
                <GraduationCap className="h-8 w-8 text-[#C5D5E3]" />
                <p>No learners found</p>
              </div>
            ) : (
              <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 370px)" }}>
                <table className="w-full text-sm">
                  <thead>
                    {/* ── Group header row ── */}
                    <tr className="border-b border-[#DDE7F0] bg-[#F8FBFE]">
                      {/* Learner sticky corner */}
                      <th className="sticky left-0 top-0 z-30 border-r border-[#DDE7F0] bg-[#F8FBFE] px-3 py-1.5" />
                      {/* Info columns (Organisation … End Date) = 7 */}
                      <th colSpan={7} className="sticky top-0 z-20 bg-[#F8FBFE] px-3 py-1.5" />
                      {/* OTJ Hours group = 6 columns */}
                      <th
                        colSpan={6}
                        className="sticky top-0 z-20 whitespace-nowrap border-b-2 border-orange-300 bg-orange-50 px-3 py-1.5 text-center text-[11px] font-bold text-orange-700"
                      >
                        OTJ Hours
                      </th>
                      {/* KSB group = 1 column */}
                      <th
                        colSpan={1}
                        className="sticky top-0 z-20 whitespace-nowrap border-b-2 border-blue-300 bg-blue-50 px-3 py-1.5 text-center text-[11px] font-bold text-blue-700"
                      >
                        KSB
                      </th>
                      {/* Remaining = 2 */}
                      <th colSpan={2} className="sticky top-0 z-20 bg-[#F8FBFE] px-3 py-1.5" />
                    </tr>

                    {/* ── Column header row ── */}
                    <tr className="border-b border-[#DDE7F0] bg-[#F8FBFE]">
                      <th className="sticky left-0 top-[34px] z-30 whitespace-nowrap border-r border-[#DDE7F0] bg-[#F8FBFE] px-3 py-2.5 text-left text-xs font-semibold text-[#5F7288]">
                        Learner
                      </th>
                      {["Organisation", "Manager", "Programme", "Coach", "Coach RAG", "Start Date", "End Date"].map((h) => (
                        <th key={h} className="sticky top-[34px] z-20 whitespace-nowrap bg-[#F8FBFE] px-3 py-2.5 text-left text-xs font-semibold text-[#5F7288]">{h}</th>
                      ))}
                      {/* OTJ group columns */}
                      {["OTJ Status", "Planned Hours", "Completed", "Target Now", "% Behind / Ahead", "Req. to Submit"].map((h) => (
                        <th key={h} className="sticky top-[34px] z-20 whitespace-nowrap bg-orange-50 px-3 py-2.5 text-left text-xs font-semibold text-orange-800">{h}</th>
                      ))}
                      {/* KSB group column */}
                      <th className="sticky top-[34px] z-20 whitespace-nowrap bg-blue-50 px-3 py-2.5 text-left text-xs font-semibold text-blue-800">KSB Status</th>
                      {/* Remaining columns */}
                      <th className="sticky top-[34px] z-20 whitespace-nowrap bg-[#F8FBFE] px-3 py-2.5 text-left text-xs font-semibold text-[#5F7288]">
                        <span className="flex items-center gap-1">
                          Learning Plan
                          <span className="group relative cursor-help">
                            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#C5D5E3] text-[9px] font-bold text-white">i</span>
                            <span className="pointer-events-none absolute left-0 top-5 z-50 hidden w-56 rounded-lg bg-[#14264A] px-3 py-2 text-[11px] font-normal leading-snug text-white shadow-xl group-hover:block">
                              Learning Plan Activities — % of programme components completed vs target. Hover each row cell for full breakdown.
                            </span>
                          </span>
                        </span>
                      </th>
                      <th className="sticky top-[34px] z-20 whitespace-nowrap bg-[#F8FBFE] px-3 py-2.5 text-left text-xs font-semibold text-[#5F7288]">Levy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((l) => {
                      // Target Now: calculated dynamically from actual today's date
                      const targetNow = calcTargetNow(l.startDate, l.endDate, l.otjPlanned);
                      const { barPct, ahead } = otjKpi(l.otjCompleted, targetNow);
                      // % behind/ahead from APTEM pre-calculated field
                      const varianceNum = parseFloat(l.progressVariance || "0") || 0;
                      const diffPct = Math.abs(Math.round(varianceNum));
                      // Required to Submit from APTEM pre-calculated hours field (negative = behind)
                      const progressHoursNum = parseProgressHours(l.progressHours);
                      const reqToSubmit = progressHoursNum < 0 ? Math.abs(progressHoursNum) : 0;
                      return (
                        <tr key={l.id} className="group border-b border-[#F0F4F8] transition-colors hover:bg-[#F8FBFE]">
                          {/* Sticky Learner cell */}
                          <td className="sticky left-0 z-10 border-r border-[#DDE7F0] bg-white px-3 py-3 group-hover:bg-[#F8FBFE]">
                            <p className="whitespace-nowrap font-semibold text-[#14264A]">{l.fullName}</p>
                            <p className="text-xs text-[#71849A]">{l.email}</p>
                            {l.learnerPhone && <p className="text-xs text-[#A0B0C0]">{l.learnerPhone}</p>}
                          </td>
                          {/* Info columns */}
                          <td className="px-3 py-3 text-xs text-[#5F7288]">{l.organizationName || "—"}</td>
                          <td className="px-3 py-3">
                            {l.managerName ? (
                              <>
                                <p className="whitespace-nowrap text-xs font-semibold text-[#14264A]">{l.managerName}</p>
                                {l.managerEmail && <p className="text-[11px] text-[#71849A]">{l.managerEmail}</p>}
                                {l.managerPhone && <p className="text-[11px] text-[#A0B0C0]">{l.managerPhone}</p>}
                              </>
                            ) : <span className="text-xs italic text-[#A0B0C0]">—</span>}
                          </td>
                          <td className="px-3 py-3">
                            <p className="whitespace-nowrap text-xs font-semibold text-[#14264A]">{l.programName || "—"}</p>
                            {l.subprogramme && <p className="text-[11px] text-[#A0B0C0]">{l.subprogramme}</p>}
                          </td>
                          <td className="px-3 py-3 text-xs text-[#5F7288] whitespace-nowrap">{l.ownerName || <span className="italic text-[#A0B0C0]">Unassigned</span>}</td>
                          <td className="px-3 py-3">{ragBadge(l.coachRag)}</td>
                          <td className="px-3 py-3 whitespace-nowrap text-xs text-[#5F7288]">{fmtDate(l.startDate)}</td>
                          <td className="px-3 py-3 whitespace-nowrap text-xs text-[#5F7288]">{fmtDate(l.endDate)}</td>
                          {/* OTJ group cells */}
                          <td className="bg-orange-50/30 px-3 py-3">{otjBadge(l.otjHoursStatus)}</td>
                          <td className="bg-orange-50/30 px-3 py-3 text-right text-xs text-[#71849A]">{fmtHoursMin(l.otjPlanned)}</td>
                          <td className="bg-orange-50/30 px-3 py-3 text-right text-xs font-semibold text-[#14264A]">{fmtHoursMin(l.otjCompleted)}</td>
                          <td className="bg-orange-50/30 px-3 py-3 text-right text-xs text-[#5F7288]">{fmtHoursMin(targetNow)}</td>
                          <td className="bg-orange-50/30 px-3 py-3">
                            <div className="flex flex-col gap-1">
                              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[#E8EFF7]">
                                <div
                                  className={`h-full rounded-full ${ahead ? "bg-green-500" : barPct >= 80 ? "bg-amber-500" : "bg-red-500"}`}
                                  style={{ width: `${barPct}%` }}
                                />
                              </div>
                              {l.otjExpected > 0 ? (
                                <span className={`text-[11px] font-semibold ${ahead ? "text-green-600" : "text-red-600"}`}>
                                  {diffPct}% {ahead ? "ahead" : "behind"}
                                </span>
                              ) : (
                                <span className="text-[11px] text-[#A0B0C0]">—</span>
                              )}
                            </div>
                          </td>
                          <td className="bg-orange-50/30 px-3 py-3 text-right text-xs font-semibold text-red-700">
                            {ahead ? <span className="text-green-600">—</span> : fmtHoursMin(reqToSubmit)}
                          </td>
                          {/* KSB group cell */}
                          <td className="bg-blue-50/30 px-3 py-3">
                            {l.ksbStatus ? (
                              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${(l.ksbStatus || "").toLowerCase() === "on track" ? "bg-green-50 text-green-700" : (l.ksbStatus || "").toLowerCase() === "behind" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"}`}>{l.ksbStatus}</span>
                            ) : <span className="text-xs text-[#A0B0C0]">—</span>}
                          </td>
                          {/* Remaining */}
                          <td className="px-3 py-3"><CompTooltip l={l} /></td>
                          <td className="px-3 py-3 text-xs text-[#5F7288]">{l.levyOrNot || "—"}</td>
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
