import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, BriefcaseBusiness, Clock, Download,
  ExternalLink, Loader2, RefreshCw, Search, Ticket,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import BackButton from "@/components/BackButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Types ────────────────────────────────────────────────────────────

interface OTJLearner {
  id: string;
  fullName: string;
  email: string;
  otjMinimum: number;
  otjPlanned: number;
  otjSubmitted: number;
  otjCompleted: number;
  otjForecast: number;
  otjExpected: number;
  progressVariance: string;
  progressHours: string;
  otjHoursStatus: string;
  prStatusLast12Weeks: string;
  mcmStatusLast4Weeks: string;
  programName: string;
  programStatus: string;
  ownerName: string;
  ownerEmail: string;
  organizationName: string;
  learnerPhone: string;
  startDate: string | null;
  endDate: string | null;
  totalDays: number | null;
  elapsedDays: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────

const fmtHoursMin = (h: number) => {
  if (!h || h <= 0) return "—";
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return `${hrs}h ${mins}m`;
};

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

const parseProgressHours = (s: string): number => {
  if (!s) return 0;
  const trimmed = s.trim();
  const sign = trimmed.startsWith("-") ? -1 : 1;
  const fullMatch = trimmed.match(/(\d+)h\s*(\d+)m/);
  if (fullMatch) return sign * (parseInt(fullMatch[1]) + parseInt(fullMatch[2]) / 60);
  const hMatch = trimmed.match(/(\d+)h/);
  if (hMatch) return sign * parseInt(hMatch[1]);
  const n = parseFloat(trimmed);
  return isNaN(n) ? 0 : n;
};

const otjKpi = (completed: number, targetNow: number, variancePct: number) => {
  const ahead = completed >= targetNow;
  const barPct = Math.min(Math.max(Math.round(Math.abs(variancePct)), 0), 100);
  return { barPct, ahead };
};

const reqToSubmit = (progressHours: string): number => {
  const n = parseProgressHours(progressHours);
  return n < 0 ? Math.abs(n) : 0;
};

const statusBadge = (status: string) => {
  const s = (status || "").toLowerCase().trim();
  if (s === "at risk") return <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700"><AlertTriangle className="h-3 w-3" />At Risk</span>;
  if (s === "need attention") return <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">Need Attention</span>;
  if (s === "on track") return <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">On Track</span>;
  return <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">{status || "—"}</span>;
};

// ─── Main Page ─────────────────────────────────────────────────────────

export default function TrackOTJPage() {
  const navigate = useNavigate();
  const [all, setAll] = useState<OTJLearner[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [coachFilter, setCoachFilter] = useState("all");
  const [otjStatusFilter, setOtjStatusFilter] = useState("at risk");
  // email → ticket id map
  const [ticketMap, setTicketMap] = useState<Record<string, number>>({});
  const [bulkCreating, setBulkCreating] = useState(false);

  const buildTicketMap = (data: Array<{ id: number; learnerEmail: string }>) => {
    const map: Record<string, number> = {};
    data.forEach((t) => { if (t.learnerEmail) map[t.learnerEmail] = t.id; });
    return map;
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Load learners + existing tickets in parallel
      const [learnersRes, ticketsRes] = await Promise.all([
        fetch("/api/otj-at-risk/"),
        fetch("/api/otj-tickets/"),
      ]);

      let learners: OTJLearner[] = [];
      let map: Record<string, number> = {};

      if (learnersRes.ok) learners = await learnersRes.json();
      if (ticketsRes.ok) map = buildTicketMap(await ticketsRes.json());

      setAll(learners);
      setTicketMap(map);

      // Auto-create tickets for at-risk learners that don't have one yet
      const toCreate = learners.filter(
        (l) => (l.otjHoursStatus || "").toLowerCase().trim() === "at risk" && !map[l.email]
      );

      if (toCreate.length > 0) {
        setBulkCreating(true);
        const newMap = { ...map };
        for (const l of toCreate) {
          const targetNow = calcTargetNow(l.startDate, l.endDate, l.otjPlanned);
          const res = await fetch("/api/otj-tickets/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              learner_email: l.email,
              learner_name: l.fullName,
              learner_phone: l.learnerPhone || "",
              organisation: l.organizationName || "",
              programme: l.programName || "",
              otj_minimum: l.otjPlanned,
              otj_completed: l.otjCompleted,
              otj_expected: Math.round(targetNow),
              otj_status: l.otjHoursStatus || "at risk",
              risk: "red",
              assigned_owner: "",
              created_by: "System",
            }),
          });
          if (res.ok) {
            const ticket: { id: number; learnerEmail: string } = await res.json();
            if (ticket.id && l.email) newMap[l.email] = ticket.id;
          }
        }
        setTicketMap(newMap);
        setBulkCreating(false);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const coaches = useMemo(() => {
    const set = new Set(all.map((l) => l.ownerName).filter(Boolean));
    return Array.from(set).filter((c) => !["default owner", "enrolment team"].includes(c.toLowerCase())).sort();
  }, [all]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return all.filter((l) => {
      if (q && !l.fullName.toLowerCase().includes(q) && !l.email.toLowerCase().includes(q) && !l.organizationName.toLowerCase().includes(q)) return false;
      if (coachFilter !== "all" && l.ownerName !== coachFilter) return false;
      if (otjStatusFilter !== "all" && (l.otjHoursStatus || "").toLowerCase().trim() !== otjStatusFilter) return false;
      return true;
    });
  }, [all, search, coachFilter, otjStatusFilter]);

  const exportCsv = () => {
    const cols = ["Name", "Email", "Organisation", "Programme", "Coach", "Planned Hours", "Completed", "Target Now", "Gap", "Status"];
    const rows = filtered.map((l) => {
      const targetNow = calcTargetNow(l.startDate, l.endDate, l.otjPlanned);
      return [
        l.fullName, l.email, l.organizationName, l.programName, l.ownerName,
        fmtHoursMin(l.otjPlanned), fmtHoursMin(l.otjCompleted), fmtHoursMin(targetNow),
        fmtHoursMin(Math.abs(l.otjCompleted - targetNow)),
        l.otjHoursStatus,
      ];
    });
    const csv = [cols, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "otjh-track.csv";
    a.click();
  };

  const openTicket = (l: OTJLearner) => {
    const targetNow = calcTargetNow(l.startDate, l.endDate, l.otjPlanned);
    const params = new URLSearchParams({
      create: "1",
      email: l.email,
      name: l.fullName,
      phone: l.learnerPhone || "",
      organisation: l.organizationName || "",
      programme: l.programName || "",
      otj_minimum: String(l.otjMinimum),
      otj_completed: String(l.otjCompleted),
      otj_expected: String(Math.round(targetNow)),
      otj_status: l.otjHoursStatus || "at risk",
      assigned_owner: l.ownerName || "",
    });
    navigate(`/otj-hours/tickets?${params.toString()}`);
  };

  const atRiskCount = useMemo(() => all.filter((l) => (l.otjHoursStatus || "").toLowerCase().trim() === "at risk").length, [all]);
  const activeLearnersCount = useMemo(() => {
    const activeKeys = new Set<string>();
    all.forEach((learner) => {
      if ((learner.programStatus || "").toLowerCase().trim() !== "active") return;
      activeKeys.add((learner.email || learner.id || learner.fullName).toLowerCase().trim());
    });
    return activeKeys.size;
  }, [all]);

  return (
    <AppLayout>
      <div className="min-h-full bg-[#F4F8FC]">
        {/* Header */}
        <div className="border-b border-[#DDE7F0] bg-white px-4 pb-5 pt-4 sm:px-6">
          <BackButton to="/otj-hours" label="OTJH" />
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E5F0F7]">
                <Clock className="h-5 w-5 text-[#24557F]" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-[#14264A]">Track OTJH</h1>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <p className="text-sm text-[#5F7288]">Learners behind on off-the-job hours</p>
                  <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800 shadow-sm">
                    Active learners: {loading ? "..." : activeLearnersCount}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              {bulkCreating && (
                <span className="flex h-9 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700">
                  <Loader2 className="h-4 w-4 animate-spin" /> Creating tickets…
                </span>
              )}
              <Button onClick={() => navigate("/otj-hours/tickets")} className="h-9 gap-1.5 rounded-lg bg-[#24557F] text-white hover:bg-[#1B466B]">
                <Ticket className="h-4 w-4" /> OTJH Tickets
              </Button>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          {/* Summary cards */}
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <span className="text-xs font-semibold text-red-800">At Risk</span>
              </div>
              <p className="mt-1 text-2xl font-bold text-red-900">{loading ? "…" : atRiskCount}</p>
              <p className="text-xs text-red-700">learners at risk on hours</p>
            </div>
            <div className="rounded-xl border border-[#DDE7F0] bg-white p-4">
              <div className="flex items-center gap-2">
                <BriefcaseBusiness className="h-4 w-4 text-[#5F7288]" />
                <span className="text-xs font-semibold text-[#5F7288]">Showing</span>
              </div>
              <p className="mt-1 text-2xl font-bold text-[#14264A]">{loading ? "…" : filtered.length}</p>
              <p className="text-xs text-[#71849A]">currently filtered</p>
            </div>
            <div className="rounded-xl border border-[#DDE7F0] bg-white p-4">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-[#5F7288]" />
                <span className="text-xs font-semibold text-[#5F7288]">Coaches Affected</span>
              </div>
              <p className="mt-1 text-2xl font-bold text-[#14264A]">{loading ? "…" : coaches.length}</p>
              <p className="text-xs text-[#71849A]">with at-risk learners</p>
            </div>
          </div>

          {/* Controls */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative flex-1" style={{ minWidth: 200 }}>
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8AA0B6]" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, organisation…" className="h-10 rounded-lg border-[#D7E5F3] bg-white pl-9 text-sm" />
            </div>
            <Select value={otjStatusFilter} onValueChange={setOtjStatusFilter}>
              <SelectTrigger className="h-10 w-auto min-w-[150px] rounded-lg border-[#D7E5F3] bg-white text-sm font-medium text-[#14264A]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-[#DDE7F0] shadow-xl">
                <SelectItem value="all">All OTJH Status</SelectItem>
                <SelectItem value="at risk">At Risk</SelectItem>
                <SelectItem value="on track">On Track</SelectItem>
                <SelectItem value="need attention">Need Attention</SelectItem>
              </SelectContent>
            </Select>

            <Select value={coachFilter} onValueChange={setCoachFilter}>
              <SelectTrigger className="h-10 w-auto min-w-[160px] rounded-lg border-[#D7E5F3] bg-white text-sm font-medium text-[#14264A]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72 rounded-xl border-[#DDE7F0] shadow-xl">
                <SelectItem value="all">All Coaches</SelectItem>
                {coaches.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={load} className="h-10 gap-1.5 rounded-lg border-[#DDE7F0] bg-white text-[#24486D]">
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} className="h-10 gap-1.5 rounded-lg border-[#DDE7F0] bg-white text-[#24486D]">
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-xl border border-[#DDE7F0] bg-white shadow-sm">
            {loading ? (
              <div className="flex h-40 items-center justify-center text-sm text-[#5F7288]">Loading learners…</div>
            ) : filtered.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-[#5F7288]">
                <BriefcaseBusiness className="h-8 w-8 text-[#C5D5E3]" />
                <p>No learners found</p>
              </div>
            ) : (
              <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 320px)" }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#DDE7F0] bg-[#F8FBFE]">
                      <th className="sticky left-0 top-0 z-30 whitespace-nowrap border-r border-[#DDE7F0] bg-[#F8FBFE] px-3 py-3 text-left text-xs font-semibold text-[#5F7288]">Learner</th>
                      {["Organisation", "Programme", "Coach", "Planned Hours", "Completed", "Target Now", "Req. to Submit", "Progress", "Status", "Follow-up"].map((h) => (
                        <th key={h} className="sticky top-0 z-20 whitespace-nowrap bg-[#F8FBFE] px-3 py-3 text-left text-xs font-semibold text-[#5F7288]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((l) => {
                      const targetNow = calcTargetNow(l.startDate, l.endDate, l.otjPlanned);
                      const varianceNum = parseFloat(l.progressVariance || "0") || 0;
                      const diffPct = Math.abs(Math.round(varianceNum));
                      const { barPct, ahead } = otjKpi(l.otjCompleted, targetNow, varianceNum);
                      const progressTone = ahead
                        ? "bg-green-500"
                        : barPct >= 50
                          ? "bg-red-600"
                          : barPct >= 25
                            ? "bg-orange-500"
                            : "bg-red-500";
                      return (
                        <tr key={l.id} className="group border-b border-[#F0F4F8] transition-colors hover:bg-[#F8FBFE]">
                          <td className="sticky left-0 z-10 border-r border-[#DDE7F0] bg-white px-3 py-3 group-hover:bg-[#F8FBFE]">
                            <p className="whitespace-nowrap font-semibold text-[#14264A]">{l.fullName}</p>
                            <p className="text-xs text-[#71849A]">{l.email}</p>
                          </td>
                          <td className="px-3 py-3 text-xs text-[#5F7288]">{l.organizationName || "—"}</td>
                          <td className="px-3 py-3 text-xs text-[#5F7288]">{l.programName || "—"}</td>
                          <td className="px-3 py-3 text-xs text-[#5F7288]">{l.ownerName || <span className="italic text-[#A0B0C0]">Unassigned</span>}</td>
                          <td className="px-3 py-3 text-xs font-semibold text-[#14264A]">{fmtHoursMin(l.otjPlanned)}</td>
                          <td className="px-3 py-3 text-xs font-semibold text-[#14264A]">{fmtHoursMin(l.otjCompleted)}</td>
                          <td className="px-3 py-3 text-xs text-[#5F7288]">{fmtHoursMin(targetNow)}</td>
                          <td className="px-3 py-3 text-xs font-semibold text-red-600">
                            {reqToSubmit(l.progressHours) > 0 ? fmtHoursMin(reqToSubmit(l.progressHours)) : <span className="text-green-600">—</span>}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-col gap-1">
                              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[#E8EFF7]">
                                <div
                                  className={`h-full rounded-full transition-all ${progressTone}`}
                                  style={{ width: `${barPct}%` }}
                                />
                              </div>
                              <span className={`text-[11px] font-semibold ${ahead ? "text-green-600" : "text-red-600"}`}>
                                {diffPct}% {ahead ? "ahead" : "behind"}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-3">{statusBadge(l.otjHoursStatus)}</td>
                          <td className="px-3 py-3">
                            {ticketMap[l.email] ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => navigate(`/otj-hours/tickets?ticket=${ticketMap[l.email]}`)}
                                className="h-7 gap-1 rounded-lg border-green-200 bg-green-50 px-2 text-xs font-semibold text-green-700 hover:bg-green-100"
                              >
                                <ExternalLink className="h-3 w-3" /> View Ticket
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openTicket(l)}
                                className="h-7 gap-1 rounded-lg border-[#D7E5F3] px-2 text-xs font-semibold text-[#24557F] hover:bg-[#EEF7FF]"
                              >
                                <Ticket className="h-3 w-3" /> Open Ticket
                              </Button>
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
