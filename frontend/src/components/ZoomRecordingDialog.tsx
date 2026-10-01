import { useEffect, useState } from "react";
import { Download, FileText, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Recording = {
  id: number; recording_type: string; owner_name: string; duration_seconds: number | null;
  transcript_status: string; transcript_error: string;
};
type Transcript = { status: string; text: string; error: string };
type Props = { callId: number | null; onClose: () => void };
const statusLabels: Record<string, string> = {
  ready: "Ready", pending: "Processing", disabled: "Transcription disabled",
  unavailable: "Transcript unavailable", error: "Sync failed",
};

export default function ZoomRecordingDialog({ callId, onClose }: Props) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [loading, setLoading] = useState(false);
  const [textLoading, setTextLoading] = useState(false);
  const [error, setError] = useState("");
  const [textError, setTextError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    setRecordings([]);
    setSelected(null);
    setTranscript(null);
    setError("");
    if (callId === null) return;
    const controller = new AbortController();
    setLoading(true);
    async function load() {
      try {
        const response = await fetch(`/api/zoom/calls/${callId}/recordings/`, {
          credentials: "include", cache: "no-store", signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || "Could not load recordings.");
        if (!controller.signal.aborted) {
          setRecordings(data.recordings);
          setSelected(data.recordings.find((row: Recording) => row.transcript_status === "ready")?.id ?? null);
        }
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not load recordings.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [callId, refresh]);

  useEffect(() => {
    setTranscript(null);
    setTextError("");
    setTextLoading(false);
    if (selected === null || callId === null) return;
    const controller = new AbortController();
    setTextLoading(true);
    async function load() {
      try {
        const response = await fetch(`/api/zoom/recordings/${selected}/transcript/`, {
          credentials: "include", cache: "no-store", signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || "Could not load transcript.");
        if (!controller.signal.aborted) setTranscript(data);
      } catch (err) {
        if (!controller.signal.aborted) setTextError(err instanceof Error ? err.message : "Could not load transcript.");
      } finally {
        if (!controller.signal.aborted) setTextLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [selected, callId, refresh]);

  function download() {
    if (!transcript?.text) return;
    const url = URL.createObjectURL(new Blob([transcript.text], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `zoom-transcript-${selected}.txt`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <Dialog open={callId !== null} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="pr-5 tracking-normal">Recordings and transcript</DialogTitle>
        <DialogDescription>Call #{callId}</DialogDescription>
      </DialogHeader>
      <div className="flex justify-end">
        <Button variant="outline" size="icon" title="Refresh recordings" aria-label="Refresh recordings" disabled={loading} onClick={() => setRefresh(value => value + 1)}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {loading ? <p role="status" className="text-sm text-muted-foreground">Loading recordings...</p>
        : !error && !recordings.length ? <p role="status" className="text-sm text-muted-foreground">No recordings synced for this call.</p>
          : <div className="divide-y border-y">{recordings.map(recording => <div key={recording.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0 text-sm">
              <p className="break-words font-medium">{recording.owner_name || "Recording"}</p>
              <p className="text-xs text-muted-foreground">{recording.recording_type || "Call recording"} | {recording.duration_seconds === null ? "Duration unavailable" : `${recording.duration_seconds}s`}</p>
              <p className={`mt-1 text-xs ${recording.transcript_status === "ready" ? "text-emerald-700" : "text-amber-700"}`}>{statusLabels[recording.transcript_status] || recording.transcript_status}</p>
              {recording.transcript_error && <p className="mt-1 break-words text-xs text-red-700">{recording.transcript_error}</p>}
            </div>
            <Button size="icon" variant={selected === recording.id ? "secondary" : "ghost"} className="shrink-0" title="View transcript" aria-label={`View transcript for recording ${recording.id}`} disabled={recording.transcript_status !== "ready"} onClick={() => setSelected(recording.id)}>
              <FileText className="h-4 w-4" />
            </Button>
          </div>)}</div>}
      {textLoading && <p role="status" className="text-sm text-muted-foreground">Loading transcript...</p>}
      {textError && <p role="alert" className="text-sm text-red-700">{textError}</p>}
      {transcript && <section className="min-w-0 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Transcript</h3>
          <Button variant="outline" size="icon" title="Download transcript" aria-label="Download transcript" disabled={!transcript.text} onClick={download}><Download className="h-4 w-4" /></Button>
        </div>
        {transcript.status === "ready" ? <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{transcript.text}</pre>
          : <p className="text-sm text-muted-foreground">{statusLabels[transcript.status] || transcript.status}</p>}
        {transcript.error && <p role="alert" className="text-sm text-red-700">{transcript.error}</p>}
      </section>}
    </DialogContent>
  </Dialog>;
}
