import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clock3, FileText, RefreshCw } from "lucide-react";
import ZoomHoursDialog from "@/components/ZoomHoursDialog";
import ZoomRecordingDialog from "@/components/ZoomRecordingDialog";
import ZoomTranscriptsDialog from "@/components/ZoomTranscriptsDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Metrics = {
  calls: number; answered: number; not_answered: number; other: number;
  duration_seconds: number; answered_duration_seconds: number; missing_duration: number;
};
type Account = Metrics & {
  key: string; label: string; configured: boolean; last_success_at: string | null;
  syncing: boolean; error: string;
  recordings_error?: string; recordings_last_success_at?: string | null;
};
type Call = {
  id: number; source_account: string; direction: string;
  caller_number: string; caller_name: string; caller_email: string;
  callee_number: string; callee_name: string; started_at: string;
  contact_name: string; contact_email: string; contact_role: string;
  duration_seconds: number | null; result: string; raw_result: string;
};
type Report = {
  timezone: string; accounts: Account[]; totals: Metrics; calls: Call[];
  daily: (Metrics & { date: string; source_account: string })[];
  page: number; page_size: number; total_records: number; has_next: boolean;
};

function londonDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function duration(seconds: number | null) {
  if (seconds === null) return "Unavailable";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m ${seconds % 60}s`;
}
const label = (key: string) => key === "student" ? "Student" : "Office (Accountant)";
const resultLabels: Record<string, string> = {
  answered: "Answered", no_answer: "No answer", missed: "Missed", busy: "Busy",
  rejected: "Rejected", voicemail: "Voicemail", other: "Other",
};
const roleLabels: Record<string, string> = { learner: "Learner", line_manager: "Line manager" };

function providerName(value: string) {
  const name = (value || "").trim();
  return /^(unknown|anonymous|unavailable)$/i.test(name) ? "" : name;
}

function party(call: Call, side: "caller" | "recipient") {
  const contactSide = (call.direction === "inbound" && side === "caller") || (call.direction === "outbound" && side === "recipient");
  const matchedRole = roleLabels[call.contact_role] || "";
  if (side === "caller") return {
    name: contactSide ? call.contact_name || providerName(call.caller_name) : providerName(call.caller_name),
    email: contactSide ? call.contact_email || call.caller_email : call.caller_email,
    number: call.caller_number,
    role: contactSide ? matchedRole || "Unmatched number" : "",
  };
  return {
    name: contactSide ? call.contact_name || providerName(call.callee_name) : providerName(call.callee_name),
    email: contactSide ? call.contact_email : "",
    number: call.callee_number,
    role: contactSide ? matchedRole || "Unmatched number" : "",
  };
}

export default function ZoomCallsReport() {
  const [filters, setFilters] = useState(() => {
    const today = londonDate();
    return { from: `${today.slice(0, 7)}-01`, to: today, account: "all", direction: "outbound", page: 1 };
  });
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [recordingCall, setRecordingCall] = useState<number | null>(null);
  const [showHours, setShowHours] = useState(false);
  const [showTranscripts, setShowTranscripts] = useState(false);
  const requestId = useRef(0);
  const change = (key: string, value: string) => setFilters(current => ({ ...current, [key]: value, page: 1 }));

  const load = useCallback(async (signal: AbortSignal, silent = false) => {
      const currentRequest = ++requestId.current;
      if (!silent) setLoading(true);
      if (!filters.from || !filters.to || filters.from > filters.to) {
        setError("Choose a valid date range.");
        if (!silent) setLoading(false);
        return;
      }
      const query = new URLSearchParams({ ...filters, page: String(filters.page) });
      try {
        const response = await fetch(`/api/zoom/calls/?${query}`, {
          credentials: "include", cache: "no-store", signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || "Could not load call reports.");
        if (!signal.aborted && currentRequest === requestId.current) {
          setReport(payload);
          setError("");
        }
      } catch (err) {
        if (!signal.aborted && currentRequest === requestId.current) {
          setError(err instanceof Error ? err.message : "Could not load call reports.");
        }
      } finally {
        if (!silent && !signal.aborted && currentRequest === requestId.current) setLoading(false);
      }
  }, [filters]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refresh]);

  useEffect(() => {
    let controller: AbortController | null = null;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || loading) return;
      controller?.abort();
      controller = new AbortController();
      void load(controller.signal, true);
    }, 60000);
    return () => {
      window.clearInterval(timer);
      controller?.abort();
    };
  }, [load, loading]);

  const timestamp = (value: string) => new Intl.DateTimeFormat("en-GB", {
    dateStyle: "short", timeStyle: "short", timeZone: report?.timezone || "Europe/London",
  }).format(new Date(value));
  const selectedAccounts = report?.accounts.filter(account => filters.account === "all" || filters.account === account.key) || [];
  const hasResults = !!report && (report.totals.calls > 0 || selectedAccounts.some(account => account.last_success_at));
  const stat = (value: number | string | undefined) => loading ? "..." : hasResults ? value : "--";

  const statusInfo = (account: Account) => {
    if (!account.configured) return { label: "Pending", cls: "bg-[#FFF8E8] text-[#94610A]" };
    if (account.syncing) return { label: "Syncing…", cls: "bg-[#EEF2FF] text-[#5B47D5]" };
    if (account.error) return { label: "Sync failed", cls: "bg-[#FFF1F3] text-[#B42332]" };
    if (!account.last_success_at) return { label: "Awaiting sync", cls: "bg-[#F5F3FC] text-[#6E6D8A]" };
    return { label: "Connected", cls: "bg-[#ECFAF6] text-[#0F6F57]" };
  };

  const outcomeStyle = (result: string) => {
    if (result === "answered") return "bg-[#ECFAF6] text-[#0F6F57]";
    if (result === "no_answer" || result === "missed") return "bg-[#FFF1F3] text-[#B42332]";
    if (result === "voicemail") return "bg-[#EEF2FF] text-[#5B47D5]";
    if (result === "busy" || result === "rejected") return "bg-[#FFF8E8] text-[#94610A]";
    return "bg-[#F5F3FC] text-[#6E6D8A]";
  };

  return (
    <div className="space-y-5">
      {/* Filters Bar */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[#E2DCF8] bg-white p-4 shadow-[0_2px_8px_rgba(29,16,80,0.05)]">
        <label className="space-y-1.5 text-xs font-bold text-[#6E6D8A]">
          From
          <Input aria-label="From date" type="date" value={filters.from} onChange={event => change("from", event.target.value)}
            className="w-40 max-w-full rounded-lg border-[#E2DCF8] bg-[#FAF9FF] text-[#1D1050] focus-visible:ring-[#5B47D5]" />
        </label>
        <label className="space-y-1.5 text-xs font-bold text-[#6E6D8A]">
          To
          <Input aria-label="To date" type="date" value={filters.to} onChange={event => change("to", event.target.value)}
            className="w-40 max-w-full rounded-lg border-[#E2DCF8] bg-[#FAF9FF] text-[#1D1050] focus-visible:ring-[#5B47D5]" />
        </label>
        <Select value={filters.account} onValueChange={value => change("account", value)}>
          <SelectTrigger aria-label="Zoom account" className="w-40 rounded-lg border-[#E2DCF8] bg-[#FAF9FF] text-[#1D1050] focus:ring-[#5B47D5]"><SelectValue /></SelectTrigger>
          <SelectContent className="rounded-xl border-[#E2DCF8]">
            <SelectItem value="all">Both accounts</SelectItem>
            <SelectItem value="student">Student</SelectItem>
            <SelectItem value="office">Office (Accountant)</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.direction} onValueChange={value => change("direction", value)}>
          <SelectTrigger aria-label="Call direction" className="w-44 rounded-lg border-[#E2DCF8] bg-[#FAF9FF] text-[#1D1050] focus:ring-[#5B47D5]"><SelectValue /></SelectTrigger>
          <SelectContent className="rounded-xl border-[#E2DCF8]">
            <SelectItem value="outbound">Outgoing calls</SelectItem>
            <SelectItem value="inbound">Incoming calls</SelectItem>
            <SelectItem value="all">All directions</SelectItem>
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" disabled={!report || loading} onClick={() => setShowHours(true)}
          className="gap-2 rounded-lg border-[#E2DCF8] text-[#5B47D5] hover:bg-[#EEF2FF]">
          <Clock3 className="h-4 w-4" /> Account hours
        </Button>
        <Button type="button" variant="outline" onClick={() => setShowTranscripts(true)}
          className="gap-2 rounded-lg border-[#E2DCF8] text-[#5B47D5] hover:bg-[#EEF2FF]">
          <FileText className="h-4 w-4" /> All transcripts
        </Button>
        <Button type="button" variant="outline" size="icon" title="Refresh report" aria-label="Refresh report" disabled={loading}
          onClick={() => setRefresh(value => value + 1)}
          className="rounded-lg border-[#E2DCF8] text-[#5B47D5] hover:bg-[#EEF2FF]">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <span className="pb-1 text-xs font-medium text-[#9B94C8]">{report?.timezone || "Europe/London"}</span>
      </div>

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* Account status table */}
      {report && (
        <div className="overflow-hidden rounded-xl border border-[#E2DCF8] bg-white shadow-[0_4px_16px_rgba(29,16,80,0.06)]">
          <div className="border-b border-[#F0EDF9] bg-[#FAF9FF] px-5 py-3">
            <p className="text-xs font-bold uppercase tracking-wider text-[#9B94C8]">Zoom accounts</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[650px] text-sm">
              <thead>
                <tr className="border-b border-[#F0EDF9]">
                  {["Account","Status","Calls","Call hours","Last sync"].map((h, i) => (
                    <th key={h} className={`px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-[#9B94C8] ${i >= 2 && i <= 3 ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selectedAccounts.map(account => {
                  const si = statusInfo(account);
                  return (
                    <tr key={account.key} className="border-b border-[#F5F3FC] transition-colors hover:bg-[#FAF9FF]">
                      <td className="px-4 py-3 font-semibold text-[#1D1050]">{account.label}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${si.cls}`}>{si.label}</span>
                        {account.configured && account.error && <p className="mt-1 max-w-xs break-words text-xs text-red-600">{account.error}</p>}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-[#1D1050] tabular-nums">{account.last_success_at || account.calls ? account.calls : "—"}</td>
                      <td className="px-4 py-3 text-right text-[#6E6D8A] tabular-nums">{account.last_success_at || account.calls ? (account.duration_seconds / 3600).toFixed(2) : "—"}</td>
                      <td className="px-4 py-3 text-xs text-[#6E6D8A]">{account.last_success_at ? timestamp(account.last_success_at) : "Never"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedAccounts.filter(account => account.recordings_error).map(account =>
        <p role="alert" key={account.key} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
          {account.label} recordings: {account.recordings_error}
        </p>
      )}

      {/* Per-account daily call hours */}
      {report && report.daily.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {selectedAccounts.map(account => {
            const days = report.daily
              .filter(d => d.source_account === account.key)
              .sort((a, b) => b.date.localeCompare(a.date));
            const totalHrs = (account.duration_seconds / 3600).toFixed(2);
            return (
              <div key={account.key} className="overflow-hidden rounded-xl border border-[#E2DCF8] bg-white shadow-[0_4px_16px_rgba(29,16,80,0.06)]">
                <div className="flex items-center justify-between border-b border-[#F0EDF9] bg-[#FAF9FF] px-4 py-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-[#9B94C8]">{account.label} — Daily hours</p>
                  <span className="rounded-full bg-[#EEF2FF] px-4 py-1.5 text-2xl font-extrabold text-[#5B47D5]">{totalHrs} hrs total</span>
                </div>
                <div className="max-h-52 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="sticky top-0 border-b border-[#F0EDF9] bg-white">
                        <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-[#9B94C8]">Date</th>
                        <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-[#9B94C8]">Calls</th>
                        <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-[#9B94C8]">Call hours</th>
                        <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-[#9B94C8]">Connected hrs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {days.map(day => (
                        <tr key={day.date} className="border-b border-[#F5F3FC] transition-colors hover:bg-[#FAF9FF]">
                          <td className="px-4 py-3 text-xs font-semibold text-[#1D1050]">{day.date}</td>
                          <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-[#5B47D5]">{day.calls}</td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-xl font-extrabold tabular-nums text-[#7A61D1]">{(day.duration_seconds / 3600).toFixed(2)}</span>
                            <span className="ml-1 text-[10px] font-semibold text-[#9B94C8]">hrs</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-xl font-extrabold tabular-nums text-[#1C9B7A]">{(day.answered_duration_seconds / 3600).toFixed(2)}</span>
                            <span className="ml-1 text-[10px] font-semibold text-[#9B94C8]">hrs</span>
                          </td>
                        </tr>
                      ))}
                      {days.length === 0 && (
                        <tr><td colSpan={4} className="px-4 py-6 text-center text-xs text-[#9B94C8]">No data for this period</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* KPI stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {[
          { name: "Calls", value: report?.totals.calls, iconBg: "#EEF2FF", iconColor: "#5B47D5", accent: "#5B47D5" },
          { name: "Call hours", value: report ? (report.totals.duration_seconds / 3600).toFixed(2) : undefined, iconBg: "#F3F0FF", iconColor: "#7A61D1", accent: "#7A61D1" },
          { name: "Answered hrs", value: report ? (report.totals.answered_duration_seconds / 3600).toFixed(2) : undefined, iconBg: "#ECFAF6", iconColor: "#1C9B7A", accent: "#1C9B7A" },
          { name: "Answered", value: report?.totals.answered, iconBg: "#ECFAF6", iconColor: "#1C9B7A", accent: "#1C9B7A" },
          { name: "Not answered", value: report?.totals.not_answered, iconBg: "#FFF1F3", iconColor: "#E05C68", accent: "#E05C68" },
        ].map(({ name, value, iconBg, iconColor, accent }) => (
          <div key={name} className="rounded-xl border border-[#E2DCF8] bg-white p-4 shadow-[0_4px_16px_rgba(29,16,80,0.06)]">
            <div className="mb-3 h-2 w-8 rounded-full" style={{ backgroundColor: iconBg, borderLeft: `3px solid ${iconColor}` }} />
            <p className="text-2xl font-extrabold tabular-nums" style={{ color: accent }}>
              {stat(value)}
            </p>
            <p className="mt-1 text-[11px] font-semibold text-[#6E6D8A]">{name}</p>
          </div>
        ))}
      </div>

      {!!report?.totals.missing_duration && <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">Duration unavailable for {report.totals.missing_duration} calls; hours are incomplete.</p>}
      {!!report?.totals.other && <p className="text-sm text-[#9B94C8]">Other call outcomes: {report.totals.other}</p>}

      {/* Sub-tabs */}
      <Tabs defaultValue="calls">
        <TabsList className="mb-4 rounded-xl bg-[#EEF2FF] p-1">
          <TabsTrigger value="calls" className="rounded-lg px-5 text-sm font-semibold data-[state=active]:bg-white data-[state=active]:text-[#5B47D5] data-[state=active]:shadow-sm">Call details</TabsTrigger>
          <TabsTrigger value="daily" className="rounded-lg px-5 text-sm font-semibold data-[state=active]:bg-white data-[state=active]:text-[#5B47D5] data-[state=active]:shadow-sm">Daily totals</TabsTrigger>
        </TabsList>

        <TabsContent value="calls">
          <div className="overflow-hidden rounded-xl border border-[#E2DCF8] bg-white shadow-[0_4px_16px_rgba(29,16,80,0.06)]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-[#F0EDF9] bg-[#FAF9FF]">
                    {["Date","Account","Direction","Caller","Recipient","Duration","Outcome","Transcript"].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#9B94C8]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report?.calls.map(call => {
                    const caller = party(call, "caller");
                    const recipient = party(call, "recipient");
                    return <tr key={call.id} className="border-b border-[#F5F3FC] transition-colors hover:bg-[#FAF9FF]">
                      <td className="whitespace-nowrap px-4 py-3 text-xs font-medium text-[#1D1050]">{timestamp(call.started_at)}</td>
                      <td className="px-4 py-3 text-[#6E6D8A]">{label(call.source_account)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${call.direction === "outbound" ? "bg-[#EEF2FF] text-[#5B47D5]" : "bg-[#F3F0FF] text-[#7A61D1]"}`}>
                          {call.direction === "outbound" ? "Outgoing" : "Incoming"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="block max-w-[200px] truncate font-medium text-[#1D1050]">{caller.name || caller.email || "Unknown contact"}</span>
                        {caller.role && <span className="mr-2 inline-flex rounded-full bg-[#EEF2FF] px-2 py-0.5 text-[10px] font-semibold text-[#5B47D5]">{caller.role}</span>}
                        {caller.email && <span className="block max-w-[220px] truncate text-xs text-[#6E6D8A]">{caller.email}</span>}
                        <span className="block font-mono text-xs text-[#9B94C8]">{caller.number || "Unavailable"}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="block max-w-[200px] truncate font-medium text-[#1D1050]">{recipient.name || recipient.email || "Unknown contact"}</span>
                        {recipient.role && <span className="mr-2 inline-flex rounded-full bg-[#ECFAF6] px-2 py-0.5 text-[10px] font-semibold text-[#0F6F57]">{recipient.role}</span>}
                        {recipient.email && <span className="block max-w-[220px] truncate text-xs text-[#6E6D8A]">{recipient.email}</span>}
                        <span className="block font-mono text-xs text-[#9B94C8]">{recipient.number || "Unavailable"}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-[#6E6D8A]">{duration(call.duration_seconds)}</td>
                      <td className="px-4 py-3" title={call.raw_result}>
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${outcomeStyle(call.result)}`}>
                          {resultLabels[call.result] || call.raw_result || "Other"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Button type="button" variant="ghost" size="icon" title="Recordings and transcript"
                          aria-label={`View recordings for call ${call.id}`}
                          onClick={() => setRecordingCall(call.id)}
                          className="h-8 w-8 rounded-lg text-[#9B87D8] hover:bg-[#EEF2FF] hover:text-[#5B47D5]">
                          <FileText className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>;
                  })}
                </tbody>
              </table>
              {!report?.calls.length && (
                <p role="status" className="p-8 text-center text-sm text-[#9B94C8]">
                  {loading ? "Loading calls…" : error ? "Call details unavailable" : !hasResults ? "No calls synced yet" : "No calls in this date range"}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#F0EDF9] bg-[#FAF9FF] px-5 py-3">
              <span className="text-xs font-semibold text-[#9B94C8]">{report ? `${report.total_records} calls` : "—"}</span>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="icon" aria-label="Previous page" title="Previous page"
                  disabled={loading || filters.page === 1}
                  onClick={() => setFilters(current => ({ ...current, page: current.page - 1 }))}
                  className="h-8 w-8 rounded-lg border-[#E2DCF8] text-[#5B47D5] hover:bg-[#EEF2FF]">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs font-semibold text-[#6E6D8A]">Page {filters.page}</span>
                <Button type="button" variant="outline" size="icon" aria-label="Next page" title="Next page"
                  disabled={loading || !report?.has_next}
                  onClick={() => setFilters(current => ({ ...current, page: current.page + 1 }))}
                  className="h-8 w-8 rounded-lg border-[#E2DCF8] text-[#5B47D5] hover:bg-[#EEF2FF]">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="daily">
          <div className="overflow-hidden rounded-xl border border-[#E2DCF8] bg-white shadow-[0_4px_16px_rgba(29,16,80,0.06)]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-[#F0EDF9] bg-[#FAF9FF]">
                    {["Date","Account","Calls","Answered","Not answered","Duration"].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#9B94C8]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report?.daily.map(day => (
                    <tr key={`${day.date}-${day.source_account}`} className="border-b border-[#F5F3FC] transition-colors hover:bg-[#FAF9FF]">
                      <td className="px-4 py-3 font-semibold text-[#1D1050]">{day.date}</td>
                      <td className="px-4 py-3 text-[#6E6D8A]">{label(day.source_account)}</td>
                      <td className="px-4 py-3 font-bold text-[#5B47D5] tabular-nums">{day.calls}</td>
                      <td className="px-4 py-3 font-semibold text-[#1C9B7A] tabular-nums">{day.answered}</td>
                      <td className="px-4 py-3 font-semibold text-[#E05C68] tabular-nums">{day.not_answered}</td>
                      <td className="px-4 py-3 tabular-nums text-[#6E6D8A]">{duration(day.duration_seconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!report?.daily.length && (
                <p className="p-8 text-center text-sm text-[#9B94C8]">
                  {loading ? "Loading daily totals…" : error ? "Daily totals unavailable" : "No daily totals"}
                </p>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <ZoomRecordingDialog callId={recordingCall} onClose={() => setRecordingCall(null)} />
      <ZoomHoursDialog open={showHours} onClose={() => setShowHours(false)} accounts={report?.accounts || []}
        from={filters.from} to={filters.to} direction={filters.direction} />
      <ZoomTranscriptsDialog open={showTranscripts} onClose={() => setShowTranscripts(false)}
        from={filters.from} to={filters.to} account="all" />
    </div>
  );
}
