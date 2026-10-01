import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hours, londonDay, stamp, useCallCentre } from "./api";

type Day = {date: string; calls: number; answered: number; not_answered: number; seconds: number; missing_duration: number;
  first_call: string | null; last_call: string | null; gaps_unknown: boolean; gaps: {from: string; to: string; minutes: number}[]};
type Agent = {id: number; name: string; account: string; zoom_phone_number: string; daily_target_minutes: number; daily: Day[]; calls: number; answered: number;
  not_answered: number; seconds: number; missing_duration: number; answered_missing_duration?: number; unique_learners: number; resolved: number; pending: number;
  sla_breaches: number; emails: number; reminders: number; sync: {last_success_at: string | null; error: string; recordings_error: string}};
type Report = {agents: Agent[]; resolutions: {agent: number; ai: number; system: number}; unclaimed_breaches: number};
const zoomMetrics = new Set(['Answered call time', 'Calls', 'Answered', 'Not answered', 'Unknown duration', 'Unique learners reached']);

function answeredTime(agent: Agent) {
  if (agent.answered > 0 && agent.answered_missing_duration === agent.answered) return "Unknown";
  return hours(agent.seconds) + (agent.answered_missing_duration ? " + unknown" : "");
}

export default function AgentPerformance() {
  const [period, setPeriod] = useState("today");
  const [from, setFrom] = useState(londonDay);
  const [to, setTo] = useState(londonDay);
  const report = useCallCentre<Report>(`performance/?${new URLSearchParams({from, to})}`);
  function setRange(value: string) {
    setPeriod(value);
    const today = londonDay();
    setTo(today);
    if (value === "today") setFrom(today);
    if (value === "month") setFrom(`${today.slice(0, 7)}-01`);
    if (value === "week") {
      const dt = new Date(`${today}T12:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() - (dt.getUTCDay() + 6) % 7);
      setFrom(dt.toISOString().slice(0, 10));
    }
  }
  const agents = report.data?.agents || [];
  return <div className="space-y-5 pt-3">
    <div className="flex flex-wrap items-end gap-3"><Tabs value={period} onValueChange={setRange}><TabsList>{[["today", "Today"], ["week", "Week"], ["month", "Month"], ["custom", "Custom"]].map(([value, text]) => <TabsTrigger key={value} value={value}>{text}</TabsTrigger>)}</TabsList></Tabs>
      <label className="text-xs">From<Input type="date" value={from} max={to} onChange={e => {setPeriod("custom"); setFrom(e.target.value);}}/></label>
      <label className="text-xs">To<Input type="date" value={to} max={londonDay()} onChange={e => {setPeriod("custom"); setTo(e.target.value);}}/></label>
      <Button variant="outline" size="icon" title="Refresh performance" aria-label="Refresh performance" disabled={report.loading} onClick={report.refresh}><RefreshCw className={`h-4 w-4 ${report.loading ? "animate-spin" : ""}`}/></Button>
      <span className="pb-2 text-xs text-muted-foreground">Europe/London</span>
    </div>
    {report.error && <p role="alert" className="text-sm text-red-700">{report.error}</p>}
    {!agents.length && <p className="border-y py-12 text-center text-sm text-muted-foreground">{report.loading ? "Loading performance..." : "No active agent profiles."}</p>}
    {!!agents.length && <>
      <div className="overflow-x-auto border-y"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-muted/40"><tr><th className="p-3">Metric</th>{agents.map(a => <th key={a.id} className="p-3"><span className="text-base">{a.name}</span><span className="block text-xs font-normal capitalize text-muted-foreground">{a.account}</span><span className="block text-xs font-normal tabular-nums text-muted-foreground">{a.zoom_phone_number || "Number unavailable"}</span></th>)}</tr></thead><tbody>
        {([['Answered call time', answeredTime], ['Daily target', (a: Agent) => `${a.daily_target_minutes} minutes`], ['Calls', (a: Agent) => a.calls], ['Answered', (a: Agent) => a.answered], ['Not answered', (a: Agent) => a.not_answered], ['Unknown duration', (a: Agent) => a.missing_duration], ['Unique learners reached', (a: Agent) => a.unique_learners], ['Resolved by agent', (a: Agent) => a.resolved], ['Pending (worked cases)', (a: Agent) => a.pending], ['SLA breaches', (a: Agent) => a.sla_breaches], ['Emails accepted (worked cases)', (a: Agent) => a.emails], ['Reminders accepted (worked cases)', (a: Agent) => a.reminders]] as [string, (a: Agent) => string | number][]).map(([label, value]) => <tr className="border-t" key={label}><th className="p-3 text-xs font-medium text-muted-foreground">{label}</th>{agents.map(a => <td className={`p-3 tabular-nums ${label === 'SLA breaches' && a.sla_breaches ? 'text-red-700' : ''}`} key={a.id}>{zoomMetrics.has(label) && !a.sync.last_success_at && a.calls === 0 ? "--" : value(a)}</td>)}</tr>)}
        <tr className="border-t"><th className="p-3 text-xs font-medium text-muted-foreground">Zoom sync</th>{agents.map(a => <td key={a.id} className="max-w-xs p-3 text-xs"><p>{stamp(a.sync.last_success_at)}</p>{a.sync.error && <p className="mt-1 text-amber-800">{a.sync.error}</p>}{a.sync.recordings_error && <p className="mt-1 text-amber-800">{a.sync.recordings_error}</p>}</td>)}</tr>
      </tbody></table></div>
      <div className="flex flex-wrap gap-6 border-b pb-4 text-sm"><span>System resolutions: <strong>{report.data?.resolutions.system}</strong></span><span>AI resolutions: <strong>{report.data?.resolutions.ai}</strong></span><span>Unclaimed SLA breaches: <strong>{report.data?.unclaimed_breaches}</strong></span></div>
      <section className="min-w-0"><h3 className="mb-4 text-sm font-semibold">Call results</h3><div className="h-64 w-full min-w-0"><ResponsiveContainer width="100%" height="100%"><BarChart data={agents}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="name"/><YAxis allowDecimals={false}/><Tooltip/><Legend/><Bar dataKey="answered" name="Answered" fill="#14866d"/><Bar dataKey="not_answered" name="Not answered" fill="#c75b62"/></BarChart></ResponsiveContainer></div></section>
      {agents.map(agent => <section key={agent.id} className="border-t pt-5"><h3 className="mb-3 text-sm font-semibold">{agent.name} / Daily activity</h3><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead className="text-muted-foreground"><tr><th className="p-2">Day</th><th className="p-2">Answered time / target</th><th className="p-2">First / last call</th><th className="p-2">No-call intervals over 30 minutes (09:00-17:00)</th></tr></thead><tbody>{agent.daily.map(day => <tr key={day.date} className="border-t"><td className="p-2">{day.date}</td><td className="p-2"><p>{hours(day.seconds)}{day.missing_duration ? ` + ${day.missing_duration} unknown` : ""}</p><progress className="mt-2 h-2 w-32 accent-emerald-600" value={day.seconds} max={Math.max(1, agent.daily_target_minutes * 60)} aria-label={`${agent.name} target on ${day.date}`}/></td><td className="p-2">{stamp(day.first_call)}<br/>{stamp(day.last_call)}</td><td className="max-w-md p-2">{!agent.sync.last_success_at || agent.sync.error ? "Sync incomplete; intervals unavailable" : day.gaps_unknown ? "Incomplete call times" : day.gaps.length ? <details><summary className="cursor-pointer text-amber-800">{day.gaps.length} intervals</summary>{day.gaps.map((g, i) => <p className="py-1" key={i}>{stamp(g.from)} to {stamp(g.to)} ({g.minutes}m)</p>)}</details> : "None"}</td></tr>)}</tbody></table></div></section>)}
    </>}
  </div>;
}
