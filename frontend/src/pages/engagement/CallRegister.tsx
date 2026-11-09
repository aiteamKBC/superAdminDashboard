import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileWarning,
  FileText,
  Headphones,
  Loader2,
  Phone,
  Search,
} from "lucide-react";

import AppLayout from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import EngagementNav from "./EngagementNav";
import {
  currentLondonMonth,
  dateTimeLabel,
  durationLabel,
  engagementRequest,
  monthOptions,
  titleCase,
} from "./api";
import type { CallTranscript, CallsReport, EngagementCall } from "./types";

function resultClass(result: string) {
  if (result === "answered") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (result === "voicemail") return "border-violet-200 bg-violet-50 text-violet-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export default function CallRegister() {
  const [urlParams] = useSearchParams();
  const [month, setMonth] = useState(() => urlParams.get("month") || currentLondonMonth());
  const [agentId, setAgentId] = useState(() => urlParams.get("agent_id") || "all");
  const [result, setResult] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CallsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcriptCall, setTranscriptCall] = useState<EngagementCall | null>(null);
  const [transcript, setTranscript] = useState<CallTranscript | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState("");
  const transcriptController = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ month, page: String(page), page_size: "50", result });
    if (agentId !== "all") params.set("agent_id", agentId);
    if (search) params.set("search", search);
    setLoading(true);
    setError("");
    engagementRequest<CallsReport>(`calls/?${params.toString()}`, controller.signal)
      .then((payload) => {
        setData(payload);
        if (payload.pagination.page !== page) setPage(payload.pagination.page);
      })
      .catch((reason) => {
        if (reason?.name !== "AbortError") setError(reason?.message || "Could not load calls");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [month, agentId, result, search, page]);

  useEffect(() => () => transcriptController.current?.abort(), []);

  const openTranscript = async (call: EngagementCall) => {
    if (!call.recordingId) return;
    transcriptController.current?.abort();
    const controller = new AbortController();
    transcriptController.current = controller;
    setTranscriptCall(call);
    setTranscript(null);
    setTranscriptError("");
    setTranscriptLoading(true);
    setTranscriptOpen(true);
    try {
      const payload = await engagementRequest<CallTranscript>(
        `calls/recordings/${call.recordingId}/transcript/`,
        controller.signal
      );
      if (!controller.signal.aborted) setTranscript(payload);
    } catch (reason) {
      if (!controller.signal.aborted) {
        setTranscriptError(reason instanceof Error ? reason.message : "Could not load transcript");
      }
    } finally {
      if (!controller.signal.aborted) setTranscriptLoading(false);
    }
  };

  const changeTranscriptOpen = (open: boolean) => {
    setTranscriptOpen(open);
    if (!open) {
      transcriptController.current?.abort();
      transcriptController.current = null;
      setTranscriptLoading(false);
    }
  };

  const summary = data?.summary;
  const answerRate = summary?.calls ? Math.round((summary.answered * 1000) / summary.calls) / 10 : 0;
  const start = data?.pagination.total ? (data.pagination.page - 1) * data.pagination.pageSize + 1 : 0;
  const end = data?.pagination.total ? Math.min(data.pagination.page * data.pagination.pageSize, data.pagination.total) : 0;
  const cards = useMemo(() => [
    { label: "Calls", value: summary?.calls || 0, hint: `${answerRate}% answered`, icon: Phone },
    { label: "Answered", value: summary?.answered || 0, hint: "Human answered, voicemail excluded", icon: Headphones },
    { label: "Connected time", value: durationLabel(summary?.talkSeconds), hint: "Zoom answered duration", icon: Headphones },
    { label: "Unsaved call forms", value: summary?.missingOutcomes || 0, hint: "After-call form not saved", icon: FileWarning },
    { label: "Missing recordings", value: summary?.missingRecordings || 0, hint: "Answered calls to review", icon: AlertTriangle },
  ], [summary, answerRate]);

  return (
    <AppLayout>
      <div className="space-y-5 p-4 sm:p-5 lg:p-6">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#1E6ACB]">Engagement Centre · Super Admin</p>
          <h1 className="text-2xl font-bold text-[#14264A]">Call register</h1>
          <p className="max-w-4xl text-sm text-[#5F7288]">Every Call Centre attempt and Event Hub call, including inbound and unmatched attempts, with its saved form, recording coverage and AI quality rating.</p>
        </div>
        <EngagementNav />
        {error ? <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">{error}</Card> : null}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {cards.map((card) => <Card key={card.label} className="p-4"><card.icon className="h-4 w-4 text-[#5F7288]" /><p className="mt-3 text-2xl font-bold text-[#14264A]">{loading && !data ? "…" : card.value}</p><p className="mt-1 text-xs font-bold text-[#314A67]">{card.label}</p><p className="mt-0.5 text-[11px] text-[#8293A8]">{card.hint}</p></Card>)}
        </div>

        <Card className="overflow-hidden">
          <div className="border-b border-[#E3EBF3] p-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[180px_220px_190px_minmax(240px,1fr)]">
              <select value={month} onChange={(event) => { setMonth(event.target.value); setPage(1); }} className="h-10 rounded-lg border border-[#D7E5F3] bg-white px-3 text-xs font-bold text-[#314A67]"><option value="all">Since 1 Sep 2026</option>{monthOptions().map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
              <select value={agentId} onChange={(event) => { setAgentId(event.target.value); setPage(1); }} className="h-10 rounded-lg border border-[#D7E5F3] bg-white px-3 text-xs font-bold text-[#314A67]"><option value="all">All specialists</option>{(data?.agents || []).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>
              <select value={result} onChange={(event) => { setResult(event.target.value); setPage(1); }} className="h-10 rounded-lg border border-[#D7E5F3] bg-white px-3 text-xs font-bold text-[#314A67]"><option value="all">All results</option><option value="answered">Answered</option><option value="not_answered">Not answered</option><option value="missing_outcome">Unsaved call form</option><option value="voicemail">Voicemail</option><option value="busy">Busy</option><option value="no_answer">No answer</option><option value="not_matched">Not matched</option><option value="waiting">Waiting for Zoom</option></select>
              <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8AA0B6]" /><Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search name, email, phone or case" className="h-10 pl-9" /></div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[1500px] w-full text-sm">
              <thead className="border-b bg-[#F8FBFE] text-[11px] uppercase tracking-wide text-[#5F7288]"><tr><th className="p-3 text-left">When</th><th className="p-3 text-left">Specialist</th><th className="p-3 text-left">Contact</th><th className="p-3 text-left">Result</th><th className="p-3 text-right">Duration</th><th className="p-3 text-left">Cases</th><th className="p-3 text-left">Outcome / form</th><th className="p-3 text-left">Recording</th><th className="p-3 text-left">Transcript</th><th className="p-3 text-left">AI quality</th></tr></thead>
              <tbody>
                {(data?.calls || []).map((call) => {
                  const linkedCases = Array.isArray(call.cases) ? call.cases : [];
                  return <tr key={call.id} className="border-b border-[#EEF3F7] align-top hover:bg-[#FBFDFF]">
                    <td className="p-3"><p className="font-semibold text-[#314A67]">{dateTimeLabel(call.startedAt)}</p><p className="text-[11px] text-[#8293A8]">{call.matched ? `Call #${call.id}` : `Attempt #${call.intentId}`} · {call.direction === "inbound" ? "Inbound" : call.eventCall ? "Event Hub" : "Outbound"}</p></td>
                    <td className="p-3"><Link to={`/engagement-centre/specialists/${call.agentId}?month=${month}`} className="font-bold text-[#1E6ACB] hover:underline">{call.agentName}</Link></td>
                    <td className="p-3"><p className="font-bold text-[#14264A]">{call.calleeName || linkedCases[0]?.learnerName || call.learnerEmail || call.calleeNumber || "Unknown"}</p><p className="text-xs text-[#71849A]">{call.learnerEmail || call.calleeNumber}</p></td>
                    <td className="p-3"><Badge className={resultClass(call.result)}>{titleCase(call.result)}</Badge></td>
                    <td className="p-3 text-right font-semibold text-[#52677D]">{durationLabel(call.durationSeconds)}</td>
                    <td className="p-3"><div className="flex max-w-[300px] flex-wrap gap-1">{linkedCases.map((item) => <Badge key={item.id} title={`${item.learnerName} · ${titleCase(item.status)}`} className="border-slate-200 bg-slate-50 text-slate-700">{item.reference} · {titleCase(item.sourceType)}</Badge>)}{!linkedCases.length ? <span className="text-xs text-[#8293A8]">{call.eventCall ? "Event call" : "No linked case"}</span> : null}</div></td>
                    <td className="p-3"><span className={`text-xs font-semibold ${call.outcome ? "text-[#314A67]" : call.eventCall ? "text-[#8293A8]" : call.formSaved ? "text-emerald-700" : "text-amber-700"}`}>{call.outcome ? titleCase(call.outcome) : call.eventCall ? "Not required" : call.formSaved ? "Form saved" : "Not saved"}</span></td>
                    <td className="p-3"><Badge className={call.recordingId ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-700"}>{call.recordingId ? titleCase(call.transcriptStatus || "recorded") : "Not found"}</Badge></td>
                    <td className="p-3">{call.recordingId && call.transcriptStatus === "ready" ? <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => void openTranscript(call)} aria-label={`View transcript for ${call.calleeName || linkedCases[0]?.learnerName || call.learnerEmail || `call ${call.id}`}`}><FileText className="h-3.5 w-3.5" /> View</Button> : <span className="text-xs text-[#8293A8]">{call.recordingId ? titleCase(call.transcriptStatus || "Pending") : "No transcript"}</span>}</td>
                    <td className="p-3"><Badge className={call.rating === "bad" ? "border-red-200 bg-red-50 text-red-700" : call.rating ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-700"}>{call.rating ? titleCase(call.rating) : "Not rated"}</Badge></td>
                  </tr>;
                })}
                {!loading && !(data?.calls.length) ? <tr><td colSpan={10} className="p-10 text-center text-sm text-[#8293A8]">No call records match these filters.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-[#E3EBF3] p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-[#71849A]">Showing {start}–{end} of {data?.pagination.total || 0} calls · London time</p>
            <div className="flex items-center gap-2"><button type="button" disabled={!data || data.pagination.page <= 1 || loading} onClick={() => setPage((value) => value - 1)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-[#D7E5F3] bg-white px-3 text-xs font-bold text-[#314A67] disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> Previous</button><span className="px-2 text-xs font-bold text-[#52677D]">Page {data?.pagination.page || 1} of {data?.pagination.pages || 1}</span><button type="button" disabled={!data || data.pagination.page >= data.pagination.pages || loading} onClick={() => setPage((value) => value + 1)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-[#D7E5F3] bg-white px-3 text-xs font-bold text-[#314A67] disabled:opacity-40">Next <ChevronRight className="h-4 w-4" /></button></div>
          </div>
        </Card>
        <Dialog open={transcriptOpen} onOpenChange={changeTranscriptOpen}>
          <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden p-0">
            <DialogHeader className="border-b border-[#E3EBF3] bg-[#F8FBFE] px-6 py-5 pr-12">
              <DialogTitle className="flex items-center gap-2 text-[#14264A]"><FileText className="h-5 w-5 text-[#1E6ACB]" /> Call transcript</DialogTitle>
              <DialogDescription>
                {transcriptCall ? `${dateTimeLabel(transcriptCall.startedAt)} · ${transcriptCall.agentName} · ${transcriptCall.calleeName || transcriptCall.learnerEmail || transcriptCall.calleeNumber || `Call #${transcriptCall.id}`}` : "Engagement Centre call"}
              </DialogDescription>
            </DialogHeader>
            <div className="px-6 pb-6">
              <div className="flex flex-wrap items-center gap-2 py-4">
                <Badge className={transcript?.status === "ready" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}>{titleCase(transcript?.status || transcriptCall?.transcriptStatus || "Loading")}</Badge>
                {transcriptCall ? <Badge className="border-slate-200 bg-slate-50 text-slate-700">{durationLabel(transcriptCall.durationSeconds)}</Badge> : null}
                {transcriptCall?.rating ? <Badge className="border-blue-200 bg-blue-50 text-blue-700">AI: {titleCase(transcriptCall.rating)}</Badge> : null}
              </div>
              {transcriptLoading ? <div className="flex h-64 items-center justify-center gap-2 text-sm text-[#5F7288]"><Loader2 className="h-5 w-5 animate-spin" /> Loading transcript…</div> : null}
              {transcriptError ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">{transcriptError}</div> : null}
              {!transcriptLoading && !transcriptError && transcript?.text ? <ScrollArea className="h-[58vh] rounded-xl border border-[#D7E5F3] bg-white"><pre className="whitespace-pre-wrap break-words p-5 font-sans text-sm leading-6 text-[#263B55]" dir="auto">{transcript.text}</pre></ScrollArea> : null}
              {!transcriptLoading && !transcriptError && transcript && !transcript.text ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{transcript.error || `Transcript text is not available (${titleCase(transcript.status)}).`}</div> : null}
              <p className="mt-3 text-[11px] text-[#8293A8]">Transcript content contains learner information and is loaded only while this dialog is open.</p>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
