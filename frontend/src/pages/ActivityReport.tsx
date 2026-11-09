import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClockAlert,
  Mail,
  Phone,
  Search,
  TicketCheck,
  Tickets,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import EngagementNav from "./engagement/EngagementNav";

type Summary = {
  ticketsTotal: number;
  ticketsOpen: number;
  ticketsResolved: number;
  ticketsEscalated: number;
  ticketsArchived: number;
  slaBreached: number;
  callsTotal: number;
  callsAnswered: number;
  callsNotAnswered: number;
  appointmentsBooked: number;
  emailsSent: number;
};

type DailyActivity = {
  date: string;
  ticketsCreated: number;
  ticketsResolved: number;
  calls: number;
  answered: number;
  notAnswered: number;
  appointmentsBooked: number;
  emailsSent: number;
};

type Breakdown = { key: string; label: string; count: number };

type CommunicationTicket = {
  id: number;
  ticketRef: string;
  sourceType: string;
  sourceLabel: string;
  issue: string;
  issueDate: string | null;
  learnerName: string;
  learnerEmail: string;
  learnerPhone: string;
  coach: string;
  organisation: string;
  programme: string;
  risk: string;
  status: string;
  attempts: number;
  misses: number;
  dueAt: string | null;
  slaBreached: boolean;
  escalated: boolean;
  archived: boolean;
  claimedBy: string;
  lastActor: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedBy: string;
  resolutionOption: string;
};

type ReportData = {
  period: {
    value: string;
    label: string;
    from: string | null;
    to: string | null;
    timezone: string;
  };
  summary: Summary;
  daily: DailyActivity[];
  statusBreakdown: Breakdown[];
  sourceBreakdown: Breakdown[];
  months: Array<{ value: string; count: number }>;
  filters: {
    statuses: Array<{ value: string; label: string }>;
    sources: Array<{ value: string; label: string }>;
  };
  tickets: CommunicationTicket[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
  ticketsIncluded: boolean;
};

const EMPTY_SUMMARY: Summary = {
  ticketsTotal: 0,
  ticketsOpen: 0,
  ticketsResolved: 0,
  ticketsEscalated: 0,
  ticketsArchived: 0,
  slaBreached: 0,
  callsTotal: 0,
  callsAnswered: 0,
  callsNotAnswered: 0,
  appointmentsBooked: 0,
  emailsSent: 0,
};

const CHART_COLORS = ["#24557F", "#22C55E", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4", "#64748B"];

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value: string) {
  if (value === "all") return "Since 1 Sep 2026";
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Date(year, month - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function dayLabel(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function fullDayLabel(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function dateTimeLabel(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/London",
      });
}

function numberLabel(value: number) {
  return new Intl.NumberFormat("en-GB").format(value || 0);
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusBadge(status: string, archived: boolean) {
  if (archived) {
    return <Badge className="border-slate-200 bg-slate-100 text-slate-700">Archived</Badge>;
  }
  const classes: Record<string, string> = {
    resolved: "border-emerald-200 bg-emerald-50 text-emerald-700",
    new: "border-blue-200 bg-blue-50 text-blue-700",
    in_progress: "border-cyan-200 bg-cyan-50 text-cyan-700",
    pending_learner: "border-amber-200 bg-amber-50 text-amber-700",
    pending_verification: "border-violet-200 bg-violet-50 text-violet-700",
    ai_suggested_close: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
    escalated: "border-red-200 bg-red-50 text-red-700",
    unreachable: "border-orange-200 bg-orange-50 text-orange-700",
  };
  return (
    <Badge className={classes[status] || "border-slate-200 bg-slate-50 text-slate-700"}>
      {titleCase(status)}
    </Badge>
  );
}

function riskBadge(risk: string) {
  const normalized = risk.toLowerCase();
  const classes: Record<string, string> = {
    red: "border-red-200 bg-red-50 text-red-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };
  return (
    <Badge className={classes[normalized] || "border-slate-200 bg-slate-50 text-slate-700"}>
      {titleCase(risk || "Unknown")}
    </Badge>
  );
}

export default function ActivityReport() {
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [statusFilter, setStatusFilter] = useState("open");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [showTickets, setShowTickets] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      month: selectedMonth,
      page: String(page),
      page_size: "50",
      status: statusFilter,
      source: sourceFilter,
      include_tickets: showTickets ? "true" : "false",
    });
    if (search) params.set("search", search);

    setLoading(true);
    setError(null);
    fetch(`/api/communication-tickets/report/?${params.toString()}`, {
      signal: controller.signal,
      credentials: "include",
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Failed to load Communication Centre tickets");
        return payload as ReportData;
      })
      .then((payload) => {
        setData(payload);
        if (payload.pagination.page !== page) setPage(payload.pagination.page);
      })
      .catch((requestError) => {
        if (requestError?.name !== "AbortError") {
          setError(requestError?.message || "Failed to load Communication Centre tickets");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [selectedMonth, statusFilter, sourceFilter, search, page, reloadKey, showTickets]);

  const summary = data?.summary || EMPTY_SUMMARY;
  const monthOptions = useMemo(() => {
    const values = new Map<string, number>();
    data?.months.forEach((item) => values.set(item.value, item.count));
    if (selectedMonth !== "all" && !values.has(selectedMonth)) values.set(selectedMonth, 0);
    return Array.from(values.entries()).sort(([left], [right]) => right.localeCompare(left));
  }, [data?.months, selectedMonth]);
  const statusPie = useMemo(
    () => (data?.statusBreakdown || []).filter((item) => item.count > 0),
    [data?.statusBreakdown],
  );
  const largestSource = Math.max(1, ...(data?.sourceBreakdown || []).map((item) => item.count));
  const startRow = data?.pagination.total ? (data.pagination.page - 1) * data.pagination.pageSize + 1 : 0;
  const endRow = data?.pagination.total
    ? Math.min(data.pagination.page * data.pagination.pageSize, data.pagination.total)
    : 0;

  const stats = [
    { label: "Tickets Created", value: summary.ticketsTotal, icon: Tickets, hint: data?.period.label || monthLabel(selectedMonth) },
    { label: "Open Tickets", value: summary.ticketsOpen, icon: TicketCheck, hint: "Active cases" },
    { label: "Resolved", value: summary.ticketsResolved, icon: CheckCircle2, hint: "Current status" },
    { label: "SLA Breached", value: summary.slaBreached, icon: ClockAlert, hint: "Open and overdue" },
    { label: "Escalated", value: summary.ticketsEscalated, icon: AlertTriangle, hint: "Unique cases" },
    { label: "Calls", value: summary.callsTotal, icon: Phone, hint: `${numberLabel(summary.callsAnswered)} answered` },
    { label: "Sessions Booked", value: summary.appointmentsBooked, icon: CalendarCheck, hint: "Case bookings" },
    { label: "Emails Sent", value: summary.emailsSent, icon: Mail, hint: "Accepted delivery" },
  ];

  return (
    <AppLayout>
      <div className="space-y-5 p-4 sm:p-5 lg:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#1E6ACB]">Engagement Centre · Super Admin</p>
            <h1 className="mt-1 text-xl font-bold text-[#14264A]">Communication Centre overview</h1>
            <p className="mt-0.5 text-sm text-[#5F7288]">
              Operational cases from 1 September 2026 and verified engagement activity
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="secondary">From 1 Sep 2026</Badge>
            <Select
              value={selectedMonth}
              onValueChange={(value) => {
                setSelectedMonth(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-10 w-[190px] rounded-lg border-[#D7E5F3] bg-white text-sm font-semibold text-[#14264A]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-[#DDE7F0] bg-white shadow-xl">
                <SelectItem value="all">Since 1 Sep 2026</SelectItem>
                {monthOptions.map(([value, count]) => (
                  <SelectItem key={value} value={value}>
                    {monthLabel(value)} ({numberLabel(count)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <EngagementNav />

        {error && (
          <Card className="flex items-center justify-between border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-700">{error}</p>
            <button
              type="button"
              onClick={() => setReloadKey((value) => value + 1)}
              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700"
            >
              Retry
            </button>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
          {stats.map((stat) => (
            <Card key={stat.label} className="p-4">
              <stat.icon className="mb-3 h-4 w-4 text-[#5F7288]" />
              <p className="text-2xl font-bold text-[#14264A]">
                {loading && !data ? "…" : numberLabel(stat.value)}
              </p>
              <p className="mt-1 text-xs font-semibold text-[#314A67]">{stat.label}</p>
              <p className="mt-0.5 truncate text-[10px] text-[#8293A8]">{stat.hint}</p>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <Card className="p-5 xl:col-span-2">
            <div className="mb-4">
              <p className="text-sm font-semibold text-[#14264A]">Tickets by Day</p>
              <p className="text-xs text-[#71849A]">Cases created and cases resolved during the period</p>
            </div>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.daily || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E3EBF3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={dayLabel} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip labelFormatter={(value) => fullDayLabel(String(value))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="ticketsCreated" fill="#24557F" name="Created" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="ticketsResolved" fill="#22C55E" name="Resolved" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="p-5">
            <p className="text-sm font-semibold text-[#14264A]">Current Status Breakdown</p>
            <p className="text-xs text-[#71849A]">Status now for tickets created in the period</p>
            <div className="h-[300px]">
              {statusPie.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusPie} dataKey="count" nameKey="label" cx="50%" cy="48%" innerRadius={55} outerRadius={88} paddingAngle={2}>
                      {statusPie.map((item, index) => (
                        <Cell key={item.key} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => numberLabel(Number(value))} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-[#8293A8]">No status data found</div>
              )}
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <div className="border-b border-[#E3EBF3] p-4">
              <p className="text-sm font-semibold text-[#14264A]">Daily Activity Log</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[850px] w-full text-sm">
                <thead>
                  <tr className="border-b bg-[#F8FBFE] text-xs text-[#5F7288]">
                    <th className="p-3 text-left font-semibold">Date</th>
                    <th className="p-3 text-right font-semibold">Tickets</th>
                    <th className="p-3 text-right font-semibold">Resolved</th>
                    <th className="p-3 text-right font-semibold">Calls</th>
                    <th className="p-3 text-right font-semibold">Answered</th>
                    <th className="p-3 text-right font-semibold">Not Answered</th>
                    <th className="p-3 text-right font-semibold">Sessions</th>
                    <th className="p-3 text-right font-semibold">Emails</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.daily || []).slice().reverse().map((row) => (
                    <tr key={row.date} className="border-b border-[#EEF3F7]">
                      <td className="p-3 font-semibold text-[#14264A]">{fullDayLabel(row.date)}</td>
                      <td className="p-3 text-right text-[#52677D]">{numberLabel(row.ticketsCreated)}</td>
                      <td className="p-3 text-right text-[#52677D]">{numberLabel(row.ticketsResolved)}</td>
                      <td className="p-3 text-right text-[#52677D]">{numberLabel(row.calls)}</td>
                      <td className="p-3 text-right text-emerald-700">{numberLabel(row.answered)}</td>
                      <td className="p-3 text-right text-red-700">{numberLabel(row.notAnswered)}</td>
                      <td className="p-3 text-right text-[#52677D]">{numberLabel(row.appointmentsBooked)}</td>
                      <td className="p-3 text-right text-[#52677D]">{numberLabel(row.emailsSent)}</td>
                    </tr>
                  ))}
                  {!loading && !(data?.daily.length) && (
                    <tr><td colSpan={8} className="p-8 text-center text-sm text-[#8293A8]">No activity found for this period</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-4">
            <p className="text-sm font-semibold text-[#14264A]">Ticket Sources</p>
            <p className="mb-4 text-xs text-[#71849A]">Every case category from Communication Centre</p>
            <div className="max-h-[390px] space-y-3 overflow-y-auto pr-1">
              {(data?.sourceBreakdown || []).map((source) => (
                <button
                  type="button"
                  key={source.key}
                  onClick={() => {
                    setSourceFilter(source.key);
                    setStatusFilter("all");
                    setPage(1);
                    setShowTickets(true);
                  }}
                  className="block w-full text-left"
                >
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium text-[#314A67]">{source.label}</span>
                    <span className="font-semibold text-[#14264A]">{numberLabel(source.count)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[#EDF3F8]">
                    <div className="h-full rounded-full bg-[#24557F]" style={{ width: `${Math.max(2, (source.count / largestSource) * 100)}%` }} />
                  </div>
                </button>
              ))}
            </div>
          </Card>
        </div>

        <Card className="overflow-hidden border-[#C9D9E8] bg-gradient-to-r from-[#F7FAFD] to-[#EEF5FB]">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#14264A] text-white">
                <Tickets className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-[#14264A]">Communication Centre Cases</p>
                <p className="mt-1 text-sm text-[#5F7288]">
                  Review outstanding cases and the resolution recorded for completed cases.
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-blue-100 px-2.5 py-1 font-semibold text-blue-700">
                    {numberLabel(summary.ticketsOpen)} unresolved
                  </span>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 font-semibold text-emerald-700">
                    {numberLabel(summary.ticketsResolved)} resolved
                  </span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setPage(1);
                setShowTickets((visible) => !visible);
              }}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#14264A] px-5 text-sm font-semibold text-white shadow-sm hover:bg-[#203A68]"
            >
              {showTickets ? "Hide cases" : "Load and view cases"}
              {showTickets ? <ChevronLeft className="h-4 w-4 rotate-90" /> : <ChevronRight className="h-4 w-4 rotate-90" />}
            </button>
          </div>
        </Card>

        {showTickets && <Card>
          <div className="space-y-3 border-b border-[#E3EBF3] p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-[#14264A]">All Communication Centre Tickets</p>
                <p className="text-xs text-[#71849A]">
                  Showing {numberLabel(startRow)}–{numberLabel(endRow)} of {numberLabel(data?.pagination.total || 0)} matching tickets
                </p>
              </div>
              {loading && <span className="text-xs font-medium text-[#71849A]">Refreshing…</span>}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {[
                { value: "all", label: "All cases", count: summary.ticketsTotal, tone: "text-[#14264A]" },
                { value: "open", label: "Unresolved", count: summary.ticketsOpen, tone: "text-blue-700" },
                { value: "resolved", label: "Resolved", count: summary.ticketsResolved, tone: "text-emerald-700" },
              ].map((item) => (
                <button
                  type="button"
                  key={item.value}
                  onClick={() => {
                    setStatusFilter(item.value);
                    setPage(1);
                  }}
                  className={`rounded-xl border p-3 text-left transition ${
                    statusFilter === item.value
                      ? "border-[#24557F] bg-[#EEF6FC] shadow-sm"
                      : "border-[#DDE7F0] bg-white hover:bg-[#F8FBFE]"
                  }`}
                >
                  <span className="text-xs font-medium text-[#71849A]">{item.label}</span>
                  <strong className={`mt-1 block text-xl ${item.tone}`}>{numberLabel(item.count)}</strong>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(240px,1fr)_220px_240px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8293A8]" />
                <Input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Search ticket, learner, email, coach…"
                  className="h-10 border-[#D7E5F3] bg-white pl-9"
                />
              </div>
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-10 border-[#D7E5F3] bg-white"><SelectValue placeholder="All statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="open">All open tickets</SelectItem>
                  {(data?.filters.statuses || []).map((item) => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={sourceFilter}
                onValueChange={(value) => {
                  setSourceFilter(value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-10 border-[#D7E5F3] bg-white"><SelectValue placeholder="All ticket sources" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All ticket sources</SelectItem>
                  {(data?.filters.sources || []).map((item) => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="max-h-[620px] overflow-auto">
            <table className="min-w-[1650px] w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[#F8FBFE]">
                <tr className="border-b text-xs text-[#5F7288]">
                  <th className="p-3 text-left font-semibold">Ticket</th>
                  <th className="p-3 text-left font-semibold">Learner</th>
                  <th className="p-3 text-left font-semibold">Type / Issue</th>
                  <th className="p-3 text-left font-semibold">Status</th>
                  <th className="p-3 text-left font-semibold">Risk</th>
                  <th className="p-3 text-left font-semibold">Coach</th>
                  <th className="p-3 text-left font-semibold">Claimed By</th>
                  <th className="p-3 text-left font-semibold">Created</th>
                  <th className="p-3 text-left font-semibold">Due</th>
                  <th className="p-3 text-left font-semibold">Outcome</th>
                  <th className="p-3 text-right font-semibold">Attempts</th>
                </tr>
              </thead>
              <tbody>
                {(data?.tickets || []).map((ticket) => (
                  <tr key={ticket.id} className={`border-b border-[#EEF3F7] align-top hover:bg-[#FAFCFE] ${ticket.status === "resolved" ? "bg-emerald-50/30" : ""}`}>
                    <td className="whitespace-nowrap p-3 font-mono text-xs font-semibold text-[#24557F]">{ticket.ticketRef}</td>
                    <td className="p-3">
                      <p className="max-w-[230px] truncate font-semibold text-[#14264A]">{ticket.learnerName || "Unknown learner"}</p>
                      <p className="max-w-[230px] truncate text-xs text-[#71849A]">{ticket.learnerEmail || "—"}</p>
                    </td>
                    <td className="p-3">
                      <p className="max-w-[250px] truncate font-medium text-[#314A67]">{ticket.sourceLabel}</p>
                      <p className="max-w-[250px] truncate text-xs text-[#8293A8]">{ticket.issue}</p>
                      {ticket.issueDate && <p className="mt-1 text-[10px] text-[#8293A8]">Issue date: {fullDayLabel(ticket.issueDate)}</p>}
                    </td>
                    <td className="whitespace-nowrap p-3">
                      <div className="flex flex-col items-start gap-1">
                        {statusBadge(ticket.status, ticket.archived)}
                        {ticket.slaBreached && <span className="text-[10px] font-semibold text-red-600">SLA breached</span>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap p-3">{riskBadge(ticket.risk)}</td>
                    <td className="p-3 text-[#52677D]"><p className="max-w-[190px] truncate">{ticket.coach || "—"}</p></td>
                    <td className="p-3 text-[#52677D]"><p className="max-w-[170px] truncate">{ticket.claimedBy || "Unclaimed"}</p></td>
                    <td className="whitespace-nowrap p-3 text-xs text-[#52677D]">{dateTimeLabel(ticket.createdAt)}</td>
                    <td className={`whitespace-nowrap p-3 text-xs ${ticket.slaBreached ? "font-semibold text-red-700" : "text-[#52677D]"}`}>
                      {dateTimeLabel(ticket.dueAt)}
                    </td>
                    <td className="p-3">
                      {ticket.status === "resolved" ? (
                        <div className="max-w-[230px]">
                          <p className="font-semibold text-emerald-700">Resolved {dateTimeLabel(ticket.resolvedAt)}</p>
                          <p className="mt-1 text-xs text-[#5F7288]">
                            {titleCase(ticket.resolvedBy || "resolved")}
                            {ticket.resolutionOption ? ` · ${titleCase(ticket.resolutionOption)}` : ""}
                          </p>
                        </div>
                      ) : ticket.archived ? (
                        <p className="font-semibold text-slate-600">Archived</p>
                      ) : (
                        <div className="max-w-[230px]">
                          <p className="font-semibold text-blue-700">Outstanding</p>
                          <p className={`mt-1 text-xs ${ticket.slaBreached ? "font-semibold text-red-600" : "text-[#5F7288]"}`}>
                            {ticket.slaBreached ? "SLA breached" : `Current status: ${titleCase(ticket.status)}`}
                          </p>
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-right text-[#52677D]">{ticket.attempts}</td>
                  </tr>
                ))}
                {!loading && !(data?.tickets.length) && (
                  <tr><td colSpan={11} className="p-12 text-center text-sm text-[#8293A8]">No tickets match these filters</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 border-t border-[#E3EBF3] p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-[#71849A]">Page {numberLabel(data?.pagination.page || 1)} of {numberLabel(data?.pagination.pages || 1)}</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={loading || (data?.pagination.page || 1) <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-[#D7E5F3] bg-white px-3 text-xs font-semibold text-[#314A67] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </button>
              <button
                type="button"
                disabled={loading || (data?.pagination.page || 1) >= (data?.pagination.pages || 1)}
                onClick={() => setPage((value) => value + 1)}
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-[#D7E5F3] bg-white px-3 text-xs font-semibold text-[#314A67] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </Card>}
      </div>
    </AppLayout>
  );
}
