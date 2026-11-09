import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Headphones,
  Phone,
  Search,
  Target,
  Users,
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
import { Input } from "@/components/ui/input";
import EngagementNav from "./EngagementNav";
import { currentLondonMonth, durationLabel, engagementRequest, monthOptions } from "./api";
import type { AttentionItem, SpecialistPerformance, TeamReport } from "./types";

const attentionClass: Record<AttentionItem["level"], string> = {
  critical: "border-red-200 bg-red-50 text-red-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  review: "border-blue-200 bg-blue-50 text-blue-700",
};

function AttentionBadges({ items }: { items: AttentionItem[] }) {
  if (!items.length) {
    return <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">No current flags</Badge>;
  }
  return (
    <div className="flex max-w-[360px] flex-wrap gap-1.5">
      {items.map((item) => (
        <Badge key={item.key} className={attentionClass[item.level]}>{item.label}</Badge>
      ))}
    </div>
  );
}

function targetTone(agent: SpecialistPerformance) {
  if (!agent.targetSeconds) return "bg-slate-300";
  if (agent.targetAttainment >= 100) return "bg-emerald-500";
  if (agent.targetAttainment >= 70) return "bg-amber-500";
  return "bg-red-500";
}

export default function TeamPerformance() {
  const [month, setMonth] = useState(currentLondonMonth);
  const [data, setData] = useState<TeamReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"attention" | "calls" | "talk" | "resolved">("attention");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    engagementRequest<TeamReport>(`team/?month=${encodeURIComponent(month)}`, controller.signal)
      .then(setData)
      .catch((reason) => {
        if (reason?.name !== "AbortError") setError(reason?.message || "Could not load team performance");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [month]);

  const agents = useMemo(() => {
    const value = search.trim().toLowerCase();
    const rows = (data?.agents || []).filter((agent) =>
      !value || [agent.name, agent.email, agent.phone].some((field) => field.toLowerCase().includes(value)),
    );
    return rows.sort((left, right) => {
      if (sort === "calls") return right.calls - left.calls;
      if (sort === "talk") return right.talkSeconds - left.talkSeconds;
      if (sort === "resolved") return right.resolved - left.resolved;
      return right.attention.length - left.attention.length
        || right.openSlaBreaches - left.openSlaBreaches
        || left.name.localeCompare(right.name);
    });
  }, [data?.agents, search, sort]);

  const summary = data?.summary;
  const answerRate = summary?.calls ? Math.round((summary.answered * 1000) / summary.calls) / 10 : 0;
  const chartData = [...(data?.agents || [])]
    .sort((left, right) => right.calls - left.calls)
    .slice(0, 10)
    .map((agent) => ({ name: agent.name.split(" ")[0], calls: agent.calls, answered: agent.answered }));
  const cards = [
    { label: "Active specialists", value: summary?.specialists || 0, hint: `${summary?.needsAttention || 0} need review`, icon: Users },
    { label: "Outbound calls", value: summary?.calls || 0, hint: `${answerRate}% answered`, icon: Phone },
    { label: "Connected time", value: durationLabel(summary?.talkSeconds), hint: data?.period.label || "Selected period", icon: Headphones },
    { label: "Cases resolved", value: summary?.resolved || 0, hint: `${summary?.openCases || 0} currently open`, icon: CheckCircle2 },
    { label: "Open SLA breaches", value: summary?.openSlaBreaches || 0, hint: `${summary?.overdueFollowups || 0} overdue follow-ups`, icon: AlertTriangle },
  ];

  return (
    <AppLayout>
      <div className="space-y-5 p-4 sm:p-5 lg:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#1E6ACB]">Engagement Centre · Super Admin</p>
            <h1 className="mt-1 text-2xl font-bold text-[#14264A]">Team performance</h1>
            <p className="mt-1 max-w-3xl text-sm text-[#5F7288]">
              Verified Zoom activity, case outcomes, workload and issues requiring management attention for every specialist.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="team-month" className="text-xs font-bold text-[#5F7288]">Period</label>
            <select
              id="team-month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="h-10 rounded-lg border border-[#D7E5F3] bg-white px-3 text-sm font-semibold text-[#14264A]"
            >
              <option value="all">Since 1 Sep 2026</option>
              {monthOptions().map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
        </div>

        <EngagementNav />

        {error ? (
          <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">{error}</Card>
        ) : null}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {cards.map((card) => (
            <Card key={card.label} className="p-4">
              <card.icon className="h-4 w-4 text-[#5F7288]" />
              <p className="mt-3 text-2xl font-bold text-[#14264A]">{loading && !data ? "…" : card.value}</p>
              <p className="mt-1 text-xs font-bold text-[#314A67]">{card.label}</p>
              <p className="mt-0.5 text-[11px] text-[#8293A8]">{card.hint}</p>
            </Card>
          ))}
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-[#14264A]">Calls and answered calls by specialist</h2>
                <p className="text-xs text-[#71849A]">Calls are outbound Call Centre and Event Hub dials; connected time also includes linked inbound calls.</p>
              </div>
              <Badge className="border-blue-200 bg-blue-50 text-blue-700">{data?.period.label || "Loading"}</Badge>
            </div>
            <div className="h-[290px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E3EBF3" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="calls" name="Calls" fill="#24557F" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="answered" name="Answered" fill="#22C55E" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-amber-50 p-2.5 text-amber-700"><Target className="h-5 w-5" /></div>
              <div>
                <h2 className="text-sm font-bold text-[#14264A]">How flags are calculated</h2>
                <p className="mt-1 text-xs leading-5 text-[#5F7288]">
                  SLA breaches, overdue follow-ups and unsaved after-call forms are direct operational exceptions. Talk-time and answer-rate flags are review prompts, not automatic judgments.
                </p>
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-[#DDE7F0] bg-[#F8FBFE] p-3 text-xs leading-5 text-[#52677D]">
              Configured talk targets cover {data?.period.workdays || 0} elapsed weekday(s). Approved leave is not available in this report yet.
            </div>
            <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-800">
              {data?.dataCoverage.notice || "Missing Zoom coverage alone must not be treated as inactivity."}
            </div>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-[#E3EBF3] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-bold text-[#14264A]">Specialist results and exceptions</h2>
              <p className="text-xs text-[#71849A]">Open a person to see their calls, cases and latest activity.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8AA0B6]" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a specialist" className="h-10 w-full pl-9 sm:w-56" />
              </div>
              <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="h-10 rounded-lg border border-[#D7E5F3] bg-white px-3 text-xs font-bold text-[#314A67]">
                <option value="attention">Needs attention first</option>
                <option value="calls">Most calls</option>
                <option value="talk">Most talk time</option>
                <option value="resolved">Most resolved</option>
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[1320px] w-full text-sm">
              <thead className="border-b bg-[#F8FBFE] text-[11px] uppercase tracking-wide text-[#5F7288]">
                <tr>
                  <th className="p-3 text-left">Specialist</th>
                  <th className="p-3 text-right">Calls</th>
                  <th className="p-3 text-right">Answered</th>
                  <th className="p-3 text-left">Talk target</th>
                  <th className="p-3 text-right">Reached</th>
                  <th className="p-3 text-right">Resolved</th>
                  <th className="p-3 text-right">Open</th>
                  <th className="p-3 text-right">SLA</th>
                  <th className="p-3 text-right">Follow-ups</th>
                  <th className="p-3 text-left">Management attention</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.id} className="border-b border-[#EEF3F7] align-top hover:bg-[#FBFDFF]">
                    <td className="p-3">
                      <p className="font-bold text-[#14264A]">{agent.name}</p>
                      <p className="mt-0.5 text-xs text-[#71849A]">{agent.email}</p>
                    </td>
                    <td className="p-3 text-right font-bold text-[#14264A]">{agent.calls}</td>
                    <td className="p-3 text-right"><span className="font-bold text-emerald-700">{agent.answered}</span><small className="block text-[#8293A8]">{agent.answerRate}%</small></td>
                    <td className="p-3">
                      <div className="flex items-center justify-between gap-3 text-xs"><strong className="text-[#314A67]">{durationLabel(agent.talkSeconds)}</strong><span className="text-[#71849A]">{Math.round(agent.targetAttainment)}%</span></div>
                      <div className="mt-1.5 h-1.5 w-36 overflow-hidden rounded-full bg-[#E8EFF5]"><div className={`h-full rounded-full ${targetTone(agent)}`} style={{ width: `${Math.min(100, agent.targetAttainment)}%` }} /></div>
                      <small className="mt-1 block text-[10px] text-[#8293A8]">of {durationLabel(agent.targetSeconds)}</small>
                    </td>
                    <td className="p-3 text-right text-[#52677D]">{agent.learnersReached}</td>
                    <td className="p-3 text-right font-bold text-emerald-700">{agent.resolved}</td>
                    <td className="p-3 text-right text-[#52677D]">{agent.openCases}</td>
                    <td className={`p-3 text-right font-bold ${agent.openSlaBreaches ? "text-red-700" : "text-[#52677D]"}`}>{agent.openSlaBreaches}</td>
                    <td className={`p-3 text-right font-bold ${agent.overdueFollowups ? "text-red-700" : "text-[#52677D]"}`}>{agent.overdueFollowups}</td>
                    <td className="p-3"><AttentionBadges items={agent.attention} /></td>
                    <td className="p-3 text-right"><Link to={`/engagement-centre/specialists/${agent.id}?month=${month}`} className="inline-flex h-9 items-center rounded-lg bg-[#14264A] px-3 text-xs font-bold text-white hover:bg-[#24486D]">View person</Link></td>
                  </tr>
                ))}
                {!loading && !agents.length ? <tr><td colSpan={11} className="p-10 text-center text-sm text-[#8293A8]">No specialists match this search.</td></tr> : null}
              </tbody>
            </table>
          </div>
          {loading ? <div className="flex items-center gap-2 border-t p-4 text-xs text-[#71849A]"><Clock3 className="h-4 w-4 animate-pulse" /> Loading verified team activity…</div> : null}
        </Card>
      </div>
    </AppLayout>
  );
}
