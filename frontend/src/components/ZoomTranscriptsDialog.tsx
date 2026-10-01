import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Summary = { total: number; ready: number; pending: number; disabled: number; unavailable: number; error: number };
type TranscriptRecord = {
  id: number;
  source_account: string;
  recording_type: string;
  owner_name: string;
  started_at: string;
  duration_seconds: number | null;
  transcript_status: string;
  transcript_error: string;
  preview: string;
};
type Report = {
  timezone: string;
  summary: Summary;
  accounts: (Summary & { key: string; label: string })[];
  records: TranscriptRecord[];
  page: number;
  total_records: number;
  has_next: boolean;
};
type Transcript = { id: number; status: string; text: string; error: string };
type Props = { open: boolean; onClose: () => void; from: string; to: string; account: string };

const statusLabels: Record<string, string> = {
  ready: "Ready",
  pending: "Processing",
  disabled: "Disabled in Zoom",
  unavailable: "Unavailable",
  error: "Sync failed",
};
const accountLabel = (key: string) => key === "student" ? "Student" : "Office (Accountant)";

export default function ZoomTranscriptsDialog({ open, onClose, from, to, account }: Props) {
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<Report | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [loading, setLoading] = useState(false);
  const [textLoading, setTextLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setPage(1);
    setSelected(null);
    setTranscript(null);
  }, [from, to, account, status, open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ from, to, account, status, page: String(page), page_size: "25" });
    async function load() {
      try {
        const response = await fetch(`/api/zoom/transcripts/?${query}`, {
          credentials: "include", cache: "no-store", signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || "Could not load transcripts.");
        if (!controller.signal.aborted) setReport(payload);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load transcripts.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [open, from, to, account, status, page]);

  useEffect(() => {
    setTranscript(null);
    if (!open || selected === null) return;
    const controller = new AbortController();
    setTextLoading(true);
    async function load() {
      try {
        const response = await fetch(`/api/zoom/recordings/${selected}/transcript/`, {
          credentials: "include", cache: "no-store", signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || "Could not load transcript.");
        if (!controller.signal.aborted) setTranscript(payload);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load transcript.");
      } finally {
        if (!controller.signal.aborted) setTextLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [open, selected]);

  function download() {
    if (!transcript?.text) return;
    const url = URL.createObjectURL(new Blob([transcript.text], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `zoom-transcript-${transcript.id}.txt`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const timestamp = (value: string) => new Intl.DateTimeFormat("en-GB", {
    dateStyle: "short", timeStyle: "short", timeZone: report?.timezone || "Europe/London",
  }).format(new Date(value));

  return <Dialog open={open} onOpenChange={next => { if (!next) onClose(); }}>
    <DialogContent className="max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-5xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 pr-6 tracking-normal"><FileText className="h-5 w-5 text-[#5B47D5]" /> All transcripts</DialogTitle>
        <DialogDescription>{from} to {to}, {account === "all" ? "both Zoom accounts" : `${accountLabel(account)} account`}</DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap items-end justify-between gap-3 border-y border-[#F0EDF9] py-3">
        <div className="space-y-2 text-xs">
          <div className="flex flex-wrap gap-4">
            <span><strong className="text-[#1D1050]">{report?.summary.total ?? 0}</strong> recordings</span>
            <span><strong className="text-[#1C9B7A]">{report?.summary.ready ?? 0}</strong> ready</span>
            <span><strong className="text-[#94610A]">{report?.summary.pending ?? 0}</strong> processing</span>
            <span><strong className="text-[#B42332]">{report?.summary.disabled ?? 0}</strong> disabled</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {report?.accounts.map(item => <span key={item.key} className="rounded-full bg-[#F5F3FC] px-2.5 py-1 text-[#6E6D8A]">
              <strong className="text-[#1D1050]">{item.label}</strong>: {item.total} recordings, {item.ready} ready
            </span>)}
          </div>
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Transcript status" className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="ready">Ready</SelectItem>
            <SelectItem value="pending">Processing</SelectItem>
            <SelectItem value="disabled">Disabled in Zoom</SelectItem>
            <SelectItem value="unavailable">Unavailable</SelectItem>
            <SelectItem value="error">Sync failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="grid min-h-72 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="divide-y overflow-hidden rounded-lg border border-[#E2DCF8]">
          {report?.records.map(record => <button key={record.id} type="button" onClick={() => setSelected(record.id)} disabled={record.transcript_status !== "ready"}
            className="flex w-full items-start justify-between gap-3 p-3 text-left transition-colors enabled:hover:bg-[#FAF9FF] disabled:cursor-default">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-[#1D1050]">{record.owner_name || "Zoom recording"}</span>
              <span className="mt-1 block text-xs text-[#6E6D8A]">{accountLabel(record.source_account)} | {timestamp(record.started_at)}</span>
              {record.preview && <span className="mt-1 block truncate text-xs text-[#9B94C8]">{record.preview}</span>}
            </span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${record.transcript_status === "ready" ? "bg-[#ECFAF6] text-[#0F6F57]" : "bg-[#FFF8E8] text-[#94610A]"}`}>
              {statusLabels[record.transcript_status] || record.transcript_status}
            </span>
          </button>)}
          {!loading && !report?.records.length && <p className="p-8 text-center text-sm text-[#9B94C8]">No transcripts match these filters.</p>}
          {loading && <p role="status" className="p-8 text-center text-sm text-[#9B94C8]">Loading transcripts...</p>}
        </div>

        <section className="min-w-0 rounded-lg border border-[#E2DCF8] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="font-semibold text-[#1D1050]">Transcript</h3>
            <Button variant="outline" size="icon" title="Download transcript" aria-label="Download transcript" disabled={!transcript?.text} onClick={download}>
              <Download className="h-4 w-4" />
            </Button>
          </div>
          {textLoading ? <p className="text-sm text-[#9B94C8]">Loading transcript...</p>
            : transcript?.text ? <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-[#1D1050]">{transcript.text}</pre>
              : <p className="text-sm text-[#9B94C8]">Select a ready transcript to read it.</p>}
        </section>
      </div>

      <div className="flex items-center justify-between border-t border-[#F0EDF9] pt-3">
        <span className="text-xs text-[#9B94C8]">{report?.total_records ?? 0} results</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" title="Previous page" aria-label="Previous transcript page" disabled={loading || page === 1} onClick={() => setPage(current => current - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-xs font-semibold text-[#6E6D8A]">Page {page}</span>
          <Button variant="outline" size="icon" title="Next page" aria-label="Next transcript page" disabled={loading || !report?.has_next} onClick={() => setPage(current => current + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
