import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  FileWarning,
  Headphones,
  Phone,
  Target,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import AppLayout from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import EngagementNav from "./EngagementNav";
import {
  currentLondonMonth,
  dateTimeLabel,
  durationLabel,
  engagementRequest,
  monthOptions,
  titleCase,
} from "./api";
import type { EngagementCall, SpecialistDetail as SpecialistDetailData } from "./types";

function resultBadge(result: string) {
  const answered = result === "answered";
  return <Badge className={answered ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}>{titleCase(result)}</Badge>;
}

function CallRows({ calls }: { calls: EngagementCall[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[900px] w-full text-sm">
        <thead className="border-b bg-[#F8FBFE] text-xs text-[#5F7288]"><tr><th className="p-3 text-left">When</th><th className="p-3 text-left">Contact</th><th className="p-3 text-left">Result</th><th className="p-3 text-right">Duration</th><th className="p-3 text-left">Cases & outcome</th><th className="p-3 text-left">Quality</th></tr></thead>
        <tbody>
          {calls.map((call) => {
            const linkedCases = Array.isArray(call.cases) ? call.cases : [];
            return <tr key={call.id} className="border-b border-[#EEF3F7] align-top">
              <td className="p-3 font-medium text-[#314A67]">{dateTimeLabel(call.startedAt)}{call.eventCall ? <Badge className="ml-2 border-violet-200 bg-violet-50 text-violet-700">Event</Badge> : null}</td>
              <td className="p-3"><p className="font-bold text-[#14264A]">{call.calleeName || call.learnerEmail || call.calleeNumber || "Unknown contact"}</p><p className="text-xs text-[#71849A]">{call.learnerEmail || call.calleeNumber}</p></td>
              <td className="p-3">{resultBadge(call.result)}</td>
              <td className="p-3 text-right text-[#52677D]">{durationLabel(call.durationSeconds)}</td>
              <td className="p-3"><div className="flex flex-wrap gap-1">{linkedCases.map((item) => <Badge key={item.id} className="border-slate-200 bg-slate-50 text-slate-700">{item.reference} · {titleCase(item.sourceType)}</Badge>)}</div><p className={`mt-1 text-xs ${call.outcome || call.formSaved ? "text-[#52677D]" : "font-bold text-amber-700"}`}>{call.outcome ? titleCase(call.outcome) : call.eventCall ? "Event call" : call.formSaved ? "Form saved" : "Form not saved"}</p></td>
              <td className="p-3"><p className="text-xs font-semibold text-[#314A67]">{call.rating ? titleCase(call.rating) : "Not rated"}</p><p className="text-[11px] text-[#8293A8]">{call.transcriptStatus ? `Transcript: ${titleCase(call.transcriptStatus)}` : "No recording found"}</p></td>
            </tr>;
          })}
          {!calls.length ? <tr><td colSpan={6} className="p-8 text-center text-sm text-[#8293A8]">No call records in this period.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

export default function SpecialistDetail() {
  const { agentId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const month = searchParams.get("month") || currentLondonMonth();
  const [data, setData] = useState<SpecialistDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    engagementRequest<SpecialistDetailData>(`team/${agentId}/?month=${encodeURIComponent(month)}`, controller.signal)
      .then(setData)
      .catch((reason) => {
        if (reason?.name !== "AbortError") setError(reason?.message || "Could not load specialist detail");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [agentId, month]);

  const agent = data?.agent;
  const daily = useMemo(() => (agent?.daily || []).map((item) => ({
    ...item,
    label: new Date(`${item.date}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    talkMinutes: Math.round(item.talkSeconds / 60),
  })), [agent?.daily]);
  const overdueCases = (data?.openCases || []).filter((item) => item.slaBreached || (item.nextFollowupAt && new Date(item.nextFollowupAt) < new Date()));
  const cards = [
    { label: "Outbound calls", value: agent?.calls || 0, hint: `${agent?.answered || 0} answered (${agent?.answerRate || 0}%)`, icon: Phone },
    { label: "Connected time", value: durationLabel(agent?.talkSeconds), hint: `${Math.round(agent?.targetAttainment || 0)}% of configured target`, icon: Headphones },
    { label: "Cases resolved", value: agent?.resolved || 0, hint: `${agent?.openCases || 0} currently owned`, icon: CheckCircle2 },
    { label: "SLA & follow-ups", value: (agent?.openSlaBreaches || 0) + (agent?.overdueFollowups || 0), hint: `${agent?.openSlaBreaches || 0} SLA · ${agent?.overdueFollowups || 0} follow-up`, icon: AlertTriangle },
    { label: "Incomplete call data", value: (agent?.missingOutcomes || 0) + (agent?.missingRecordings || 0), hint: `${agent?.missingOutcomes || 0} unsaved form · ${agent?.missingRecordings || 0} recording`, icon: FileWarning },
    { label: "Calls rated bad", value: agent?.badCalls || 0, hint: `${agent?.ratedCalls || 0} calls rated by AI`, icon: AlertTriangle },
  ];

  return (
    <AppLayout>
      <div className="space-y-5 p-4 sm:p-5 lg:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <Link to={`/engagement-centre/team?month=${month}`} className="inline-flex items-center gap-1 text-xs font-bold text-[#1E6ACB]"><ArrowLeft className="h-3.5 w-3.5" /> Back to team</Link>
            <h1 className="mt-2 text-2xl font-bold text-[#14264A]">{agent?.name || (loading ? "Loading specialist…" : "Specialist")}</h1>
            <p className="mt-1 text-sm text-[#5F7288]">{agent?.email || "Calls, cases, outcomes and operational exceptions"}{agent?.phone ? ` · ${agent.phone}` : ""}</p>
          </div>
          <select value={month} onChange={(event) => setSearchParams({ month: event.target.value })} className="h-10 rounded-lg border border-[#D7E5F3] bg-white px-3 text-sm font-semibold text-[#14264A]">
            <option value="all">Since 1 Sep 2026</option>
            {monthOptions().map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>

        <EngagementNav />
        {error ? <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">{error}</Card> : null}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          {cards.map((card) => <Card key={card.label} className="p-4"><card.icon className="h-4 w-4 text-[#5F7288]" /><p className="mt-3 text-2xl font-bold text-[#14264A]">{loading && !data ? "…" : card.value}</p><p className="mt-1 text-xs font-bold text-[#314A67]">{card.label}</p><p className="mt-0.5 text-[11px] text-[#8293A8]">{card.hint}</p></Card>)}
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
          <Card className="p-5">
            <h2 className="text-sm font-bold text-[#14264A]">Daily activity</h2>
            <p className="mb-4 text-xs text-[#71849A]">Calls, answered calls and connected minutes in London time.</p>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%"><BarChart data={daily}><CartesianGrid strokeDasharray="3 3" stroke="#E3EBF3" /><XAxis dataKey="label" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="calls" name="Calls" fill="#24557F" radius={[4, 4, 0, 0]} /><Bar dataKey="answered" name="Answered" fill="#22C55E" radius={[4, 4, 0, 0]} /><Bar dataKey="talkMinutes" name="Talk minutes" fill="#8B5CF6" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-2"><Target className="h-5 w-5 text-[#1E6ACB]" /><h2 className="text-sm font-bold text-[#14264A]">Management attention</h2></div>
            <div className="mt-4 space-y-2">
              {agent?.attention.map((item) => <div key={item.key} className={`rounded-xl border p-3 text-xs font-semibold ${item.level === "critical" ? "border-red-200 bg-red-50 text-red-700" : item.level === "warning" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-blue-200 bg-blue-50 text-blue-700"}`}>{item.label}</div>)}
              {agent && !agent.attention.length ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700">No current operational flags.</div> : null}
            </div>
            <p className="mt-4 text-xs leading-5 text-[#71849A]">Talk target: {durationLabel(agent?.targetSeconds)} across {agent?.workdays || 0} elapsed weekdays. Treat the target as a review guide because approved leave is not included.</p>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b p-4"><div><h2 className="text-sm font-bold text-[#14264A]">Open cases worked or owned</h2><p className="text-xs text-[#71849A]">Showing the highest-priority {data?.openCases.length || 0} of {data?.linkedCasesTotal || 0} active cases connected to this specialist.</p></div><Badge className={overdueCases.length ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}>{overdueCases.length} shown overdue / breached</Badge></div>
          <div className="overflow-x-auto"><table className="min-w-[1050px] w-full text-sm"><thead className="border-b bg-[#F8FBFE] text-xs text-[#5F7288]"><tr><th className="p-3 text-left">Case</th><th className="p-3 text-left">Learner</th><th className="p-3 text-left">Type</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">Due / follow-up</th><th className="p-3 text-right">Attempts</th><th className="p-3 text-left">Relationship</th></tr></thead><tbody>
            {(data?.openCases || []).map((item) => <tr key={item.id} className="border-b border-[#EEF3F7]"><td className="p-3 font-mono text-xs font-bold text-[#1E6ACB]">{item.reference}</td><td className="p-3"><p className="font-bold text-[#14264A]">{item.learnerName}</p><p className="text-xs text-[#71849A]">{item.learnerEmail}</p></td><td className="p-3 text-[#52677D]">{titleCase(item.sourceType)}</td><td className="p-3"><Badge className={item.slaBreached ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-slate-50 text-slate-700"}>{titleCase(item.status)}{item.slaBreached ? " · SLA" : ""}</Badge></td><td className="p-3 text-xs text-[#52677D]"><p>Due {dateTimeLabel(item.dueAt)}</p><p>Follow-up {dateTimeLabel(item.nextFollowupAt)}</p></td><td className="p-3 text-right font-bold text-[#314A67]">{item.attempts}</td><td className="p-3"><Badge className={item.owned ? "border-blue-200 bg-blue-50 text-blue-700" : "border-violet-200 bg-violet-50 text-violet-700"}>{item.owned ? "Owned" : "Worked"}</Badge></td></tr>)}
            {!loading && !(data?.openCases.length) ? <tr><td colSpan={7} className="p-8 text-center text-[#8293A8]">No active cases are linked to this specialist.</td></tr> : null}
          </tbody></table></div>
        </Card>

        <Card className="overflow-hidden"><div className="flex items-center justify-between border-b p-4"><div><h2 className="text-sm font-bold text-[#14264A]">Recent call records</h2><p className="text-xs text-[#71849A]">The latest 20 outbound, inbound or unmatched attempts in the selected period.</p></div><Link to={`/engagement-centre/calls?agent_id=${agentId}&month=${month}`} className="rounded-lg bg-[#14264A] px-3 py-2 text-xs font-bold text-white">Open full call register</Link></div><CallRows calls={data?.recentCalls || []} /></Card>

        <Card className="overflow-hidden"><div className="border-b p-4"><h2 className="text-sm font-bold text-[#14264A]">Latest case activity</h2><p className="text-xs text-[#71849A]">The latest 50 ticket events attributed to this specialist.</p></div><div className="divide-y divide-[#EEF3F7]">{(data?.activity || []).map((event) => <div key={event.id} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between"><div><span className="font-bold text-[#14264A]">{titleCase(event.kind)}</span><span className="ml-2 text-sm text-[#52677D]">{event.learnerName}</span><Badge className="ml-2 border-slate-200 bg-slate-50 text-slate-700">CC-{String(event.caseId).padStart(6, "0")}</Badge></div><span className="text-xs text-[#8293A8]">{dateTimeLabel(event.createdAt)} · {event.actor}</span></div>)}{!loading && !(data?.activity.length) ? <p className="p-8 text-center text-sm text-[#8293A8]">No attributed case events in the current data.</p> : null}</div></Card>
        {loading ? <div className="flex items-center gap-2 text-xs text-[#71849A]"><Clock3 className="h-4 w-4 animate-pulse" /> Loading specialist audit trail…</div> : null}
      </div>
    </AppLayout>
  );
}
