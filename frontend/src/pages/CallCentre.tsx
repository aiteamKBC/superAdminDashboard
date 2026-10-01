import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Headset, Phone, RefreshCw, Search } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TicketDrawer from "@/components/callcenter/TicketDrawer";
import { api, Case, category, Config, issueLabel, stamp, statusLabel, useCallCentre } from "@/components/callcenter/api";

type Queue = {groups: {learner_email: string; learner_name: string; coach: string; learner_phone: string; tickets: Case[]}[]; total: number; page: number; has_next: boolean; coaches: string[]};
type Surveys = {surveys: {id: number; ticket_id: number; manager_email: string; organisation: string; quarter: string; score: number | null; comment: string; ticket__status: string; ticket__escalated: boolean}[]; has_next: boolean; trend: {quarter: string; organisation: string; average: number; responses: number}[]};
const categories = ["attendance", "pr", "mcm", "otj", "epa", "reminder"];
const statuses = ["new", "in_progress", "pending_learner", "pending_verification", "ai_suggested_close", "unreachable", "escalated", "resolved"];
const selectStyle = "h-10 min-w-0 rounded-md border bg-background px-3 text-sm";

export default function CallCentre() {
  const config = useCallCentre<Config>("config/");
  const [accountId, setAccountId] = useState<number | null>(null);
  const [view, setView] = useState("queue");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({q: "", coach: "", source_type: "", status: "", claimed: "", due: ""});
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [fallback, setFallback] = useState<{zoom_url: string; tel_url: string} | null>(null);
  const query = new URLSearchParams({...filters, view, page: String(page)});
  const queue = useCallCentre<Queue>(view !== "satisfaction" ? `queue/?${query}` : null);
  const surveys = useCallCentre<Surveys>(view === "satisfaction" ? `satisfaction/?page=${page}` : null);
  const loading = queue.loading || surveys.loading;
  const selectedAgentId = accountId ?? config.data?.agent_id ?? config.data?.agents[0]?.id ?? null;
  useEffect(() => {
    if (!config.data?.agents.length) return;
    if (!config.data.agents.some(agent => agent.id === selectedAgentId)) setAccountId(config.data.agents[0].id);
  }, [config.data, selectedAgentId]);
  const refresh = () => {queue.refresh(); surveys.refresh(); config.refresh();};
  const change = (key: string, value: string) => {setFilters(f => ({...f, [key]: value})); setPage(1);};
  async function open(ticket: Case, call = false) {
    if (busy) return;
    setError(""); setBusy(ticket.id);
    try {
      const canClaim = selectedAgentId && ticket.status !== "resolved" && !ticket.archived && (!ticket.claimed_agent_id || ticket.claimed_agent_id === selectedAgentId);
      if (canClaim) {
        const result = await api<{zoom_url: string; tel_url: string}>(`tickets/${ticket.id}/${call ? "call" : "claim"}/`, {
          method: "POST", headers: {"Content-Type": "application/json", "X-CSRFToken": config.data!.csrf_token}, body: JSON.stringify({agent_id: selectedAgentId}),
        });
        if (call) {setFallback(result); window.location.href = result.zoom_url;}
      }
      setSelected(ticket.id); queue.refresh();
    } catch (e) {setError(e instanceof Error ? e.message : "Could not open case.");}
    finally {setBusy(null);}
  }
  const problems = config.data?.sources.filter(s => s.details.error) || [];
  return <AppLayout><div className="min-w-0 space-y-5 p-4 sm:p-5 lg:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><Headset className="h-6 w-6 text-emerald-700"/><h1 className="text-2xl font-semibold">Call Centre</h1></div>
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[#EEF2FF] px-2.5 py-1 text-xs font-bold text-[#5B47D5]">Email: {config.data?.email_mode || "--"}</span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${config.data?.ai_enabled ? "bg-[#ECFAF6] text-[#0F6F57]" : "bg-[#FFF1F3] text-[#B42332]"}`}>AI: {config.data?.ai_enabled ? "On" : "Off"}</span>
        <Button size="icon" variant="outline" title="Refresh Call Centre" aria-label="Refresh Call Centre" disabled={loading} onClick={refresh} className="border-[#E2DCF8] text-[#5B47D5] hover:bg-[#EEF2FF]"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}/></Button>
      </div></header>
    <div className="flex flex-wrap items-center justify-between gap-3 border-y border-[#E2DCF8] py-3 text-xs font-semibold text-[#6E6D8A]"><div className="flex items-center gap-2"><span>Zoom account</span><select aria-label="Zoom account" className={selectStyle} value={selectedAgentId || ""} disabled={!config.data?.is_superuser || (config.data?.agents.length || 0) < 2} onChange={event => setAccountId(Number(event.target.value))}>{config.data?.agents.map(agent => <option value={agent.id} key={agent.id}>{agent.zoom_account === "office" ? "Office (Accountant)" : "Student"}</option>)}</select></div><span>Last cycle: {stamp(config.data?.cycle?.last_success_at || null)} / UK time</span></div>
    {(error || queue.error || surveys.error || config.error) && <p role="alert" className="border-l-2 border-red-500 bg-red-50 p-3 text-sm text-red-800">{error || queue.error || surveys.error || config.error}</p>}
    {!!problems.length && <details className="text-sm text-amber-800"><summary className="cursor-pointer">{problems.length} data source warnings</summary>{problems.map(p => <p key={p.name} className="mt-1">{p.details.error}</p>)}</details>}
    {fallback && <div className="flex flex-wrap gap-4 text-sm"><a href={fallback.zoom_url} className="underline">Open Zoom</a><a href={fallback.tel_url} className="underline">Phone fallback</a></div>}
    <Tabs value={view} onValueChange={value => {setView(value); setPage(1); setFilters({q: "", coach: "", source_type: "", status: "", claimed: "", due: ""});}}>
      <div className="overflow-x-auto"><TabsList className="w-max">{[["queue", "Queue"], ["tomorrow", "Tomorrow"], ["due", "Due / Overdue"], ["ai", "AI suggestions"], ["satisfaction", "Satisfaction"], ["history", "History"]].map(([key, label]) => <TabsTrigger value={key} key={key}>{label}</TabsTrigger>)}</TabsList></div>
    </Tabs>
    {view !== "satisfaction" ? <>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-7"><div className="relative col-span-2 xl:col-span-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><Input className="pl-9" aria-label="Search learners" placeholder="Search learners" value={filters.q} onChange={e => change("q", e.target.value)}/></div>
        <select aria-label="Coach" className={selectStyle} value={filters.coach} onChange={e => change("coach", e.target.value)}><option value="">All coaches</option>{queue.data?.coaches.map(coach => <option key={coach}>{coach}</option>)}</select>
        <select aria-label="Category" className={selectStyle} value={filters.source_type} onChange={e => change("source_type", e.target.value)}><option value="">All issues</option>{categories.map(c => <option value={c} key={c}>{category(c)}</option>)}</select>
        <select aria-label="Status" className={selectStyle} value={filters.status} onChange={e => change("status", e.target.value)}><option value="">All statuses</option>{statuses.map(s => <option value={s} key={s}>{statusLabel(s)}</option>)}</select>
        <select aria-label="Claim status" className={selectStyle} value={filters.claimed} onChange={e => change("claimed", e.target.value)}><option value="">All claims</option><option value="no">Unclaimed</option><option value="yes">Claimed</option></select>
        <select aria-label="Due state" className={selectStyle} value={filters.due} onChange={e => change("due", e.target.value)}><option value="">All due states</option><option value="overdue">Overdue</option><option value="within">Within SLA</option></select>
      </div>
      <div className="overflow-x-auto border-y"><table className="w-full min-w-[880px] text-left text-sm"><thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="p-3">Learner / coach</th><th className="p-3">Open issues</th><th className="p-3">Ticket due</th><th className="p-3">Follow-up / owner</th><th className="p-3 text-right">Call</th></tr></thead>
        <tbody>{queue.data?.groups.map(group => {
          const first = group.tickets[0];
          const overdue = group.tickets.filter(t => t.sla_breached);
          const claim = group.tickets.find(t => t.claimed_by);
          const due = [...group.tickets].sort((a, b) => a.due_at.localeCompare(b.due_at))[0];
          const blocked = !!claim && claim.claimed_agent_id !== selectedAgentId;
          return <tr className="border-t align-top hover:bg-muted/20" key={group.learner_email}>
            <td className="max-w-[260px] p-3"><button className="text-left font-medium hover:underline" onClick={() => void open(first)}>{group.learner_name}</button><p className="break-all text-xs text-muted-foreground">{group.learner_email}</p><p className="mt-1 text-xs">{group.coach || "Unassigned coach"}</p></td>
            <td className="max-w-[320px] p-3"><div className="flex flex-col items-start gap-1">{group.tickets.map(ticket => {
              const name = issueLabel(ticket);
              return <button key={ticket.id} title={`${name}. ${ticket.priority_why}`} onClick={() => void open(ticket)} className={`max-w-full whitespace-normal break-words rounded border px-2 py-1 text-left text-xs leading-4 ${ticket.risk === "red" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>{name}</button>;
            })}</div></td>
            <td className={`p-3 text-xs ${overdue.length ? "text-red-700" : "text-muted-foreground"}`}>{stamp(due.due_at)}{overdue.length > 0 && <p className="mt-1 font-medium">Overdue {Math.max(...overdue.map(t => t.sla_days_overdue))} days</p>}{first.booking_at && <p>Session: {stamp(first.booking_at)}</p>}</td>
            <td className="max-w-[240px] p-3 text-xs"><p className={claim ? "font-medium text-amber-800" : "text-muted-foreground"}>{claim ? `In progress: ${claim.claimed_by}` : statusLabel(first.status)}</p><p className="mt-1">{first.attempts} failed attempts</p>{first.next_followup_at && <p>{stamp(first.next_followup_at)}</p>}<p className="mt-1 text-muted-foreground">{first.last_actor} / {stamp(first.last_action_at)}</p></td>
            <td className="p-3 text-right"><Button size="icon" title={blocked ? `Claimed by ${claim?.claimed_by}` : "Call learner in Zoom"} aria-label={`Call ${group.learner_name}`} disabled={!!busy || blocked || !selectedAgentId || !group.learner_phone || first.status === "resolved" || first.attempts >= 3} onClick={() => void open(first, true)}><Phone className="h-4 w-4"/></Button></td>
          </tr>;
        })}</tbody></table>
        {!queue.data?.groups.length && <p className="py-12 text-center text-sm text-muted-foreground">{loading ? "Loading queue..." : "No cases match this view."}</p>}
      </div>
    </> : <>
      <div className="overflow-x-auto border-y"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="p-3">Line manager / employer</th><th className="p-3">Quarter</th><th className="p-3">Score</th><th className="p-3">Feedback</th><th className="p-3">Status</th></tr></thead><tbody>{surveys.data?.surveys.map(s => <tr key={s.id} className="border-t"><td className="p-3"><button className="text-left underline" onClick={() => setSelected(s.ticket_id)}>{s.manager_email}</button><p className="text-xs text-muted-foreground">{s.organisation}</p></td><td className="p-3">{s.quarter}</td><td className={`p-3 font-medium ${s.score && s.score <= 2 ? "text-red-700" : ""}`}>{s.score ? `${s.score}/5` : "Pending"}</td><td className="max-w-xs break-words p-3">{s.comment || "--"}</td><td className="p-3 capitalize">{s.ticket__escalated ? "Escalated" : statusLabel(s.ticket__status)}</td></tr>)}</tbody></table>{!surveys.data?.surveys.length && <p className="py-12 text-center text-sm text-muted-foreground">{loading ? "Loading surveys..." : "No employer surveys."}</p>}</div>
      {!!surveys.data?.trend.length && <section><h2 className="mb-3 text-sm font-semibold">Quarterly results</h2><div className="overflow-x-auto"><table className="w-full min-w-[400px] text-sm"><tbody>{surveys.data.trend.map((t, i) => <tr key={i} className="border-b"><td className="p-2">{t.organisation}</td><td>{t.quarter}</td><td>{t.average.toFixed(1)}/5</td><td>{t.responses} responses</td></tr>)}</tbody></table></div></section>}
    </>}
    <footer className="flex items-center justify-between text-xs text-muted-foreground"><span>{view !== "satisfaction" ? `${queue.data?.total || 0} learners / ` : ""}Page {page}</span><div className="flex gap-2"><Button variant="outline" size="icon" aria-label="Previous page" title="Previous page" disabled={page === 1 || loading} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4"/></Button><Button variant="outline" size="icon" aria-label="Next page" title="Next page" disabled={loading || !(view === "satisfaction" ? surveys.data?.has_next : queue.data?.has_next)} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4"/></Button></div></footer>
    <TicketDrawer id={selected} config={config.data} agentId={selectedAgentId} onClose={() => setSelected(null)} onChanged={refresh} onSelect={setSelected}/>
  </div></AppLayout>;
}
