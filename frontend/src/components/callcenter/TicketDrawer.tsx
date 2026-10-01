import { useEffect, useState } from "react";
import { Archive, Check, FileText, Phone, RotateCcw, Unlock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import ZoomRecordingDialog from "@/components/ZoomRecordingDialog";
import { api, Case, Config, hours, Issue, issueLabel, stamp, statusLabel, useCallCentre } from "./api";

type Call = {call_id: number; agent: string; manual: boolean; result: string; started_at: string; duration_seconds: number | null; outcome: string};
type Detail = {ticket: Case; issues: Issue[];
  events: {id: number; kind: string; actor: string; data: Record<string, unknown>; call_id: number | null; created_at: string}[];
  calls: Call[]; has_more_events: boolean;
  emails: {id: number; kind: string; status: string; mode: string; subject: string; text: string; error: string; created_at: string}[];
};
type Props = {id: number | null; config: Config | null; agentId: number | null; onClose: () => void; onChanged: () => void; onSelect: (id: number) => void};
const options = ["catch_up_session", "watch_recording", "book_mcm", "book_pr", "other"];

export default function TicketDrawer({id, config, agentId, onClose, onChanged, onSelect}: Props) {
  const [page, setPage] = useState(1);
  const detail = useCallCentre<Detail>(id ? `tickets/${id}/?event_page=${page}` : null);
  const [note, setNote] = useState("");
  const [option, setOption] = useState("other");
  const [outcome, setOutcome] = useState("reached");
  const [callId, setCallId] = useState("");
  const [callback, setCallback] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dial, setDial] = useState<{zoom_url: string; tel_url: string} | null>(null);
  const [recording, setRecording] = useState<number | null>(null);
  useEffect(() => {setPage(1); setNote(""); setError(""); setDial(null); setCallId("");}, [id]);
  const ticket = detail.data?.ticket.id === id ? detail.data.ticket : undefined;
  const ownedElsewhere = !!ticket?.claimed_agent_id && ticket.claimed_agent_id !== agentId;
  const writable = !!config && (!!agentId || config.is_manager) && !ownedElsewhere;
  async function act(command: string, payload: Record<string, unknown> = {}) {
    if (!config || !id || busy) return;
    setBusy(true); setError("");
    try {
      const result = await api<{zoom_url: string; tel_url: string}>(`tickets/${id}/${command}/`, {
        method: "POST", headers: {"Content-Type": "application/json", "X-CSRFToken": config.csrf_token}, body: JSON.stringify({...payload, agent_id: agentId}),
      });
      if (command === "call") {setDial(result); window.location.href = result.zoom_url;}
      setNote(""); detail.refresh(); onChanged();
    } catch (e) {setError(e instanceof Error ? e.message : "Action failed.");}
    finally {setBusy(false);}
  }
  return <>
    <Sheet open={id !== null} onOpenChange={open => {if (!open) onClose();}}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto break-words">
        <SheetHeader><SheetTitle>{ticket?.learner_name || "Case details"}</SheetTitle>
          <SheetDescription>{ticket ? issueLabel(ticket) : "Case details"}</SheetDescription></SheetHeader>
        {(error || detail.error) && <p role="alert" className="my-4 text-sm text-red-700">{error || detail.error}</p>}
        {detail.loading && !ticket && <p className="py-6 text-sm">Loading case...</p>}
        {ticket && <div className="space-y-5 py-5 text-sm">
          <div className="flex flex-wrap gap-2 text-xs"><span className="rounded border px-2 py-1 capitalize">{statusLabel(ticket.status)}</span>
            {ticket.claimed_by && <span className="rounded bg-amber-50 px-2 py-1 text-amber-900">In progress: {ticket.claimed_by}</span>}
            {ticket.escalated && <span className="rounded bg-red-50 px-2 py-1 text-red-700">Escalated</span>}</div>
          <dl className="grid grid-cols-[100px_minmax(0,1fr)] gap-x-3 gap-y-2">
            <dt className="text-muted-foreground">Email</dt><dd className="break-all">{ticket.learner_email}</dd>
            <dt className="text-muted-foreground">Phone</dt><dd>{ticket.learner_phone || "Missing"}</dd>
            <dt className="text-muted-foreground">Coach</dt><dd>{ticket.coach || "Unassigned"}</dd>
            <dt className="text-muted-foreground">Employer</dt><dd>{ticket.organisation || "--"}</dd>
            <dt className="text-muted-foreground">Line manager</dt><dd className="break-all">{ticket.manager_name || "--"}<br/>{ticket.manager_email || "Email missing"}</dd>
            <dt className="text-muted-foreground">Ticket due</dt><dd className={ticket.sla_breached ? "text-red-700" : ""}>{stamp(ticket.due_at)}{ticket.sla_breached && ` / Overdue ${ticket.sla_days_overdue} days`}</dd>
            <dt className="text-muted-foreground">Learner overdue</dt><dd>{ticket.learner_days_overdue} days</dd>
            <dt className="text-muted-foreground">Next contact</dt><dd>{stamp(ticket.next_followup_at)}</dd>
            <dt className="text-muted-foreground">Last action</dt><dd>{ticket.last_actor} / {stamp(ticket.last_action_at)}</dd>
          </dl>
          <div className="flex flex-wrap gap-2">{detail.data?.issues.map(issue => <button key={issue.id} onClick={() => onSelect(issue.id)} className="max-w-full break-words text-left text-primary underline underline-offset-4">{issueLabel(issue)}</button>)}</div>
          {ticket.status !== "resolved" && <div className="flex flex-wrap gap-2 border-y py-3">
            <Button size="sm" disabled={busy || !writable || !agentId || !ticket.learner_phone || ticket.attempts >= 3} onClick={() => void act("call")}><Phone className="mr-2 h-4 w-4"/>Call in Zoom</Button>
            <Button variant="outline" size="sm" disabled={busy || !writable || !agentId} onClick={() => void act(ticket.claimed_agent_id === agentId ? "release" : "claim")}><Unlock className="mr-2 h-4 w-4"/>{ticket.claimed_agent_id === agentId ? "Release" : "Claim"}</Button>
            {dial && <><a className="self-center underline" href={dial.zoom_url}>Open Zoom</a><a className="self-center underline" href={dial.tel_url}>Phone fallback</a></>}
          </div>}
          {ticket.ai_summary && <section className="border-b pb-4"><h3 className="mb-2 font-semibold">AI review</h3><p className="whitespace-pre-wrap">{ticket.ai_summary}</p><p className="mt-1 text-xs text-muted-foreground">Confidence: {Math.round((ticket.ai_confidence || 0) * 100)}%</p>
            {ticket.status === "ai_suggested_close" && <Button className="mt-2" size="sm" variant="outline" disabled={!writable || busy} onClick={() => void act("reject_ai", {note})}><X className="mr-2 h-4 w-4"/>Reject suggestion</Button>}</section>}
          <section><h3 className="mb-2 font-semibold">Zoom calls ({detail.data?.calls.length || 0})</h3>
            {!detail.data?.calls.length && <p className="text-muted-foreground">No confirmed Zoom calls.</p>}
            {detail.data?.calls.map(call => <div className="flex items-start justify-between gap-2 border-b py-3" key={call.call_id}>
              <div><p>{call.agent} / {statusLabel(call.result)} / {call.duration_seconds === null ? "Duration unknown" : hours(call.duration_seconds)}</p>
                <p className="text-xs text-muted-foreground">{stamp(call.started_at)}{call.manual ? " / Manually dialled" : ""}</p>{call.outcome && <p className="text-xs">Outcome: {statusLabel(call.outcome)}</p>}</div>
              <Button variant="ghost" size="icon" title="View recordings and transcript" aria-label="View transcript" onClick={() => setRecording(call.call_id)}><FileText className="h-4 w-4"/></Button>
            </div>)}
          </section>
          {ticket.status !== "resolved" && !!detail.data?.calls.length && <section className="space-y-3"><h3 className="font-semibold">Call outcome</h3>
            <label className="block text-xs">Confirmed call<select className="mt-1 h-10 w-full rounded border bg-background px-2 text-sm" value={callId} onChange={e => setCallId(e.target.value)}><option value="">Select call</option>{detail.data.calls.map(c => <option value={c.call_id} key={c.call_id}>{stamp(c.started_at)} / {c.agent} / {statusLabel(c.result)}</option>)}</select></label>
            <label className="block text-xs">Outcome<select className="mt-1 h-10 w-full rounded border bg-background px-2 text-sm" value={outcome} onChange={e => setOutcome(e.target.value)}>{["reached", "no_answer", "wrong_number", "callback"].map(o => <option key={o} value={o}>{statusLabel(o)}</option>)}</select></label>
            {outcome === "callback" && <label className="block text-xs">Callback (your device timezone)<Input type="datetime-local" value={callback} onChange={e => setCallback(e.target.value)}/></label>}
            <Button size="sm" variant="outline" disabled={busy || !writable || !callId || (outcome === "callback" && !callback)} onClick={() => void act("outcome", {call_id: Number(callId), outcome, option, note, callback_at: callback ? new Date(callback).toISOString() : null})}><Check className="mr-2 h-4 w-4"/>Save outcome</Button>
          </section>}
          <section className="space-y-3 border-y py-4"><h3 className="font-semibold">Decision / notes</h3>
            <label className="block text-xs">Resolution option<select className="mt-1 h-10 w-full rounded border bg-background px-2 text-sm" value={option} onChange={e => setOption(e.target.value)}>{options.map(o => <option value={o} key={o}>{statusLabel(o)}</option>)}</select></label>
            <Textarea aria-label="Decision reason or note" placeholder="Decision reason or note" maxLength={5000} value={note} onChange={e => setNote(e.target.value)}/>
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy || !writable || !note.trim()} onClick={() => void act("note", {note})}>Add note</Button>
              <Button size="sm" disabled={busy || !writable || !note.trim()} onClick={() => void act(ticket.status === "resolved" ? "reopen" : "resolve", {note, option})}>{ticket.status === "resolved" ? <RotateCcw className="mr-2 h-4 w-4"/> : <Check className="mr-2 h-4 w-4"/>}{ticket.status === "resolved" ? "Reopen" : ticket.status === "ai_suggested_close" ? "Approve and resolve" : "Resolve"}</Button>
              {config?.is_manager && ticket.status === "resolved" && !ticket.archived && <Button variant="outline" size="icon" title="Archive case" aria-label="Archive case" disabled={busy} onClick={() => void act("archive")}><Archive className="h-4 w-4"/></Button>}</div>
          </section>
          {!!detail.data?.emails.length && <section><h3 className="mb-2 font-semibold">Emails</h3>{detail.data.emails.map(email => <details key={email.id} className="border-b py-2"><summary className="cursor-pointer">{email.subject} / {statusLabel(email.status)}</summary><p className="mt-2 whitespace-pre-wrap">{email.text}</p>{email.error && <p className="text-red-700">{email.error}</p>}</details>)}</section>}
          <section><h3 className="mb-2 font-semibold">Timeline</h3>{detail.data?.events.map(item => <details className="border-l-2 border-muted py-2 pl-3" key={item.id}><summary className="cursor-pointer"><span className="capitalize">{statusLabel(item.kind)}</span><span className="block text-xs text-muted-foreground">{item.actor} / {stamp(item.created_at)}</span></summary><pre className="mt-2 whitespace-pre-wrap break-words text-xs">{JSON.stringify(item.data, null, 2)}</pre></details>)}
            <div className="mt-3 flex gap-2"><Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Newer</Button><Button size="sm" variant="outline" disabled={!detail.data?.has_more_events} onClick={() => setPage(p => p + 1)}>Older</Button></div>
          </section>
        </div>}
      </SheetContent>
    </Sheet>
    <ZoomRecordingDialog callId={recording} onClose={() => setRecording(null)}/>
  </>;
}
