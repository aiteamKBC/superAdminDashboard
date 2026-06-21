import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/lib/auth";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Archive, AlertTriangle, CalendarCheck2, CheckCircle2, Clock, Download, Eye,
  File as FileIcon, FileText, Flag, Image as ImageIcon, MessageSquare,
  Mail, MoreHorizontal, Paperclip, Plus, RefreshCw, Search, Ticket,
  Trash2, UploadCloud, X, XCircle, ZoomIn,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import AppLayout from "@/components/AppLayout";
import BackButton from "@/components/BackButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ─── Types ────────────────────────────────────────────────────────────────────

type MCMRisk = "red" | "amber" | "green";
type MCMStatus = "new" | "open" | "session_booked" | "session_completed" | "resolved";

interface EvidenceFile {
  id: number;
  name: string;
  url: string;
  mimeType: string;
  uploadedAt: string;
}

interface McmHistoryItem {
  date: string;
  status: string;
  completed?: boolean;
  isPast?: boolean;
}

interface MCMTicket {
  id: number;
  ticketRef: string;
  learnerEmail: string;
  learnerName: string;
  learnerPhone: string;
  organisation: string;
  programme: string;
  coachName: string;
  overdueCount: number;
  nextMcmDate: string;
  lastMcmDate: string;
  mcmStatus: string;
  mcmHistory: McmHistoryItem[];
  risk: MCMRisk;
  status: MCMStatus;
  assignedOwner: string;
  action: string;
  notes: string;
  evidenceCount: number;
  isArchived: boolean;
  escalated: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MCM_STATUS_LABELS: Record<string, string> = {
  new: "New", open: "Open", session_booked: "Session Booked",
  session_completed: "Session Completed", resolved: "Resolved",
};

const ACTION_OPTIONS = [
  { value: "", label: "— No action selected —" },
  { value: "called", label: "Called" },
  { value: "emailed", label: "Emailed" },
  { value: "session_booked", label: "Session Booked" },
  { value: "referred_support", label: "Referred to Support" },
  { value: "no_action", label: "No Action Required" },
];

const STATUS_OPTIONS: { value: MCMStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "open", label: "Open" },
  { value: "session_booked", label: "Session Booked" },
  { value: "session_completed", label: "Session Completed" },
  { value: "resolved", label: "Resolved" },
];

const RISK_OPTIONS: { value: MCMRisk; label: string }[] = [
  { value: "red", label: "Red" },
  { value: "amber", label: "Amber" },
  { value: "green", label: "Green" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (s: string) => {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return s; }
};

const isoToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const isCompletedMcmStatus = (value: unknown) =>
  String(value || "").toLowerCase().includes("completed");

const mcmDateValue = (value: string) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
};

const getOverdueMcmItems = (items: McmHistoryItem[] = []) => {
  const today = isoToday();
  return items.filter((item) => {
    const dt = mcmDateValue(item.date);
    return Boolean(dt && dt < today && !item.completed && !isCompletedMcmStatus(item.status));
  });
};

const getCompletedMcmItems = (items: McmHistoryItem[] = []) =>
  items.filter((item) => item.completed || isCompletedMcmStatus(item.status));

const daysOpen = (createdAt: string) => {
  const diff = Date.now() - new Date(createdAt).getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
};

const initials = (name: string) =>
  name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

const riskColor: Record<MCMRisk, string> = {
  red: "bg-red-100 text-red-700",
  amber: "bg-amber-100 text-amber-700",
  green: "bg-green-100 text-green-700",
};

const riskAccent: Record<MCMRisk, string> = {
  red: "#DC2626",
  amber: "#D97706",
  green: "#16A34A",
};

const statusColor: Record<MCMStatus, string> = {
  new: "bg-slate-100 text-slate-600",
  open: "bg-blue-100 text-blue-700",
  session_booked: "bg-teal-100 text-teal-700",
  session_completed: "bg-green-100 text-green-700",
  resolved: "bg-[#E8F0F9] text-[#315D93]",
};

const statusLabel: Record<MCMStatus, string> = {
  new: "New",
  open: "Open",
  session_booked: "Session Booked",
  session_completed: "Session Completed",
  resolved: "Resolved",
};

function OverdueBadge({ ticket }: { ticket: MCMTicket }) {
  const overdueItems = getOverdueMcmItems(Array.isArray(ticket.mcmHistory) ? ticket.mcmHistory : []);
  const tone =
    ticket.overdueCount >= 3
      ? "bg-red-100 text-red-700"
      : ticket.overdueCount >= 1
        ? "bg-amber-100 text-amber-700"
        : "bg-green-100 text-green-700";

  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + window.scrollY + 6, left: r.left + window.scrollX + r.width / 2 });
  };

  return (
    <span className="inline-flex justify-center">
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={show}
        onFocus={show}
        onMouseLeave={() => setPos(null)}
        onBlur={() => setPos(null)}
        className={`rounded-full px-2 py-0.5 text-xs font-bold outline-none ring-offset-2 transition-shadow hover:ring-2 hover:ring-[#BFD5EE] focus-visible:ring-2 focus-visible:ring-[#315D93] ${tone}`}
        aria-label={`${ticket.overdueCount} overdue MCM meetings`}
      >
        {ticket.overdueCount}
      </button>

      {pos && createPortal(
        <div
          className="pointer-events-none fixed z-[9999] w-72 -translate-x-1/2 rounded-xl border border-[#DDE7F0] bg-white p-3 text-left shadow-2xl"
          style={{ top: pos.top, left: pos.left }}
        >
          <span className="mb-2 flex items-center gap-2 text-xs font-bold text-[#14264A]">
            <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
            Overdue MCM meetings
          </span>
          {overdueItems.length ? (
            <div className="max-h-56 space-y-1.5 overflow-y-auto">
              {overdueItems.map((item, index) => (
                <span key={`${item.date}-${item.status}-${index}`} className="block rounded-lg bg-red-50 px-2.5 py-2">
                  <span className="block text-xs font-bold text-red-700">{fmtDate(item.date)}</span>
                  <span className="block text-[11px] text-[#5F7288]">{item.status || "No status"}</span>
                </span>
              ))}
            </div>
          ) : (
            <span className="block rounded-lg bg-[#F8FBFE] px-2.5 py-2 text-xs text-[#5F7288]">
              No overdue meeting details recorded for this ticket.
            </span>
          )}
        </div>,
        document.body
      )}
    </span>
  );
}

const isImage = (mime: string, name: string) =>
  mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name);
const isPdf = (mime: string, name: string) =>
  mime === "application/pdf" || /\.pdf$/i.test(name);
const isHtml = (mime: string, name: string) =>
  mime === "text/html" || /\.html?$/i.test(name);

// ─── Notes helpers ────────────────────────────────────────────────────────────

function parseNoteEntry(line: string): { text: string; meta: string } {
  const match = line.match(/^\[([^\]]+)\]\s*(.*)/s);
  if (match) return { meta: match[1].trim(), text: match[2].trim() || line };
  return { text: line, meta: "" };
}

function noteLines(notes: string) {
  return notes ? notes.trim().split("\n").filter((l) => l.trim()) : [];
}

// ─── NotesCell ───────────────────────────────────────────────────────────────

function NotesCell({ ticket, onOpen, onAddNote }: { ticket: MCMTicket; onOpen: () => void; onAddNote: () => void }) {
  const count = noteLines(ticket.notes).length;
  if (count === 0) {
    return (
      <button
        onClick={onAddNote}
        className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-[#C5D5E3] hover:bg-[#EEF3FB] hover:text-[#315D93]"
        title="Add note"
      >
        <MessageSquare className="h-3.5 w-3.5" />
      </button>
    );
  }
  return (
    <button
      onClick={onOpen}
      className="flex items-center gap-1 rounded-full bg-[#EEF3FB] px-2 py-0.5 text-[11px] font-semibold text-[#315D93] hover:bg-[#DCE9FB]"
    >
      <MessageSquare className="h-3 w-3" />
      {count}
    </button>
  );
}

// ─── NotesModal ───────────────────────────────────────────────────────────────

function NotesModal({
  ticket, onClose, onAddNote,
}: {
  ticket: MCMTicket;
  onClose: () => void;
  onAddNote: () => void;
}) {
  const lines = noteLines(ticket.notes);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 bg-[#14264A] px-4 py-3.5">
          <MessageSquare className="h-4 w-4 text-white/70" />
          <span className="flex-1 truncate text-sm font-semibold text-white">
            Case Notes · {ticket.learnerName}
          </span>
          <button
            onClick={() => { onClose(); onAddNote(); }}
            className="rounded px-2 py-0.5 text-[11px] font-semibold text-white/70 hover:text-white"
          >
            + Add
          </button>
          <button onClick={onClose} className="rounded p-1 text-white/70 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Notes list */}
        <div className="max-h-72 space-y-2.5 overflow-y-auto bg-white p-4">
          {lines.length > 0 ? (
            lines.map((line, i) => {
              const { text, meta } = parseNoteEntry(line);
              return (
                <div key={i} className="rounded-xl border border-[#DDE7F0] bg-[#F8FBFE] p-3">
                  <p className="text-sm text-[#14264A]">{text}</p>
                  {meta && <p className="mt-1.5 text-[11px] text-[#71849A]">{meta}</p>}
                </div>
              );
            })
          ) : (
            <p className="py-4 text-center text-sm text-[#A0B0C0]">No notes added yet</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center gap-2 border-t border-[#DDE7F0] bg-[#F8FBFE] px-4 py-2.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#E8EFF7] px-2.5 py-1 text-xs font-semibold text-[#5F7288]">
            <MessageSquare className="h-3 w-3" />
            {lines.length} {lines.length === 1 ? "note" : "notes"}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#E8EFF7] px-2.5 py-1 text-xs font-semibold text-[#5F7288]">
            <Paperclip className="h-3 w-3" />
            {ticket.evidenceCount} {ticket.evidenceCount === 1 ? "file" : "files"}
          </span>
          <span className="ml-auto">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusColor[ticket.status]}`}>
              {statusLabel[ticket.status]}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── EvidenceCell ─────────────────────────────────────────────────────────────

function EvidenceCell({
  ticket, files, onLoad, onPreview,
}: {
  ticket: MCMTicket;
  files: EvidenceFile[] | undefined;
  onLoad: () => void;
  onPreview: (f: EvidenceFile) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleOpen = async (val: boolean) => {
    setOpen(val);
    if (val && !files) {
      setLoading(true);
      onLoad();
      setLoading(false);
    }
  };

  const downloadFile = async (f: EvidenceFile) => {
    try {
      const res = await fetch(f.url.replace(/^https?:\/\/[^/]+/, ""));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = f.name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch { /* fallback: open in new tab */ window.open(f.url, "_blank"); }
  };

  if (ticket.evidenceCount === 0) {
    return <span className="text-xs text-[#C5D5E3]">—</span>;
  }

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 rounded-full bg-[#EEF3FB] px-2 py-0.5 text-[11px] font-semibold text-[#315D93] hover:bg-[#DCE9FB]">
          <Paperclip className="h-3 w-3" />
          {ticket.evidenceCount}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start" side="bottom">
        <div className="border-b border-[#DDE7F0] px-3 py-2">
          <p className="text-xs font-bold text-[#315D93]">Evidence ({ticket.evidenceCount})</p>
        </div>
        <div className="max-h-52 overflow-y-auto p-2">
          {loading || !files ? (
            <p className="py-3 text-center text-xs text-[#8AA0B6]">Loading…</p>
          ) : files.length === 0 ? (
            <p className="py-3 text-center text-xs text-[#8AA0B6]">No files found</p>
          ) : (
            files.map((f) => (
              <div key={f.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[#F4F8FC]">
                <Paperclip className="h-3 w-3 shrink-0 text-[#8AA0B6]" />
                <span className="flex-1 truncate text-xs text-[#14264A]" title={f.name}>{f.name}</span>
                <button onClick={() => onPreview(f)} className="rounded p-0.5 text-[#8AA0B6] hover:text-[#315D93]" title="Preview">
                  <Eye className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => void downloadFile(f)} className="rounded p-0.5 text-[#8AA0B6] hover:text-[#315D93]" title="Download">
                  <Download className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── EvidenceUploadZone ───────────────────────────────────────────────────────

function EvidenceUploadZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handle = (files: FileList | null) => {
    if (!files) return;
    onFiles(Array.from(files));
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handle(e.dataTransfer.files); }}
      onClick={() => inputRef.current?.click()}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 transition-colors ${dragging ? "border-[#315D93] bg-[#F1F5FA]" : "border-[#C5D5E3] hover:border-[#315D93]"}`}
    >
      <UploadCloud className="h-8 w-8 text-[#8AA0B6]" />
      <p className="text-center text-sm text-[#5F7288]">
        <span className="font-semibold text-[#315D93]">Click to upload</span> or drag & drop
      </p>
      <p className="text-xs text-[#8AA0B6]">Images, PDFs, Word, Excel, HTML</p>
      <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => handle(e.target.files)} />
    </div>
  );
}

// ─── FilePreviewModal ─────────────────────────────────────────────────────────

function FilePreviewModal({ target, onClose }: { target: EvidenceFile | null; onClose: () => void }) {
  if (!target) return null;
  const img = isImage(target.mimeType, target.name);
  const pdf = isPdf(target.mimeType, target.name);
  const html = isHtml(target.mimeType, target.name);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-[#14264A]">
            <FileIcon className="h-4 w-4 text-[#315D93]" />{target.name}
          </DialogTitle>
        </DialogHeader>
        <div className="mt-2">
          {img && <img src={target.url} alt={target.name} className="max-h-[70vh] w-full rounded-lg object-contain" />}
          {pdf && <iframe src={target.url} title={target.name} className="h-[72vh] w-full rounded-lg border border-[#DDE7F0]" />}
          {html && <iframe src={target.url} title={target.name} className="h-[72vh] w-full rounded-lg border border-[#DDE7F0] bg-white" sandbox="allow-same-origin" />}
          {!img && !pdf && !html && (
            <div className="flex flex-col items-center gap-3 py-10 text-[#5F7288]">
              <FileIcon className="h-12 w-12 text-[#C5D5E3]" />
              <p className="text-sm">Preview not available.</p>
              <a href={target.url} download target="_blank" rel="noreferrer" className="text-sm font-semibold text-[#315D93] underline">Download file</a>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── AddNoteModal ─────────────────────────────────────────────────────────────

function AddNoteModal({
  ticket, open, onClose, onSaved,
}: {
  ticket: MCMTicket; open: boolean; onClose: () => void; onSaved: (t: MCMTicket) => void;
}) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!text.trim()) return;
    setSaving(true);
    const dateStr = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const byLine = user?.name || user?.email || "";
    const entry = `[${dateStr}${byLine ? ` · ${byLine}` : ""}] ${text.trim()}`;
    const newNotes = ticket.notes ? `${ticket.notes}\n${entry}` : entry;
    const res = await fetch(`/api/mcm-tickets/${ticket.id}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: newNotes }),
    });
    setSaving(false);
    if (res.ok) { onSaved(await res.json()); onClose(); setText(""); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add Note</DialogTitle></DialogHeader>
        <div className="mt-2 space-y-3">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Write your note here…" rows={5} className="text-sm" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={saving || !text.trim()}>
              {saving ? "Saving…" : "Add Note"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── AddEvidenceModal ─────────────────────────────────────────────────────────

function AddEvidenceModal({
  ticket, open, onClose, onSaved,
}: {
  ticket: MCMTicket; open: boolean; onClose: () => void; onSaved: (t: MCMTicket) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  const upload = async () => {
    if (!files.length) return;
    setUploading(true);
    for (const f of files) {
      const fd = new FormData();
      fd.append("file", f);
      await fetch(`/api/mcm-tickets/${ticket.id}/files/`, { method: "POST", body: fd });
    }
    const res = await fetch(`/api/mcm-tickets/${ticket.id}/`);
    setUploading(false);
    if (res.ok) { onSaved(await res.json()); onClose(); setFiles([]); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add Evidence</DialogTitle></DialogHeader>
        <div className="mt-2 space-y-3">
          <EvidenceUploadZone onFiles={(f) => setFiles((p) => [...p, ...f])} />
          {files.length > 0 && (
            <ul className="space-y-1">
              {files.map((f, i) => (
                <li key={i} className="flex items-center justify-between rounded-lg border border-[#DDE7F0] px-3 py-2 text-xs">
                  <span className="truncate text-[#14264A]">{f.name}</span>
                  <button onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5 text-[#8AA0B6]" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={upload} disabled={uploading || !files.length}>
              {uploading ? "Uploading…" : `Upload ${files.length ? `(${files.length})` : ""}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── CreateTicketModal ────────────────────────────────────────────────────────

function CreateTicketModal({
  open, onClose, onCreate, initialEmail = "", initialName = "",
}: {
  open: boolean; onClose: () => void; onCreate: (t: MCMTicket) => void; initialEmail?: string; initialName?: string;
}) {
  const { user } = useAuth();
  const empty = {
    learnerEmail: initialEmail, learnerName: initialName, learnerPhone: "", organisation: "",
    programme: "", coachName: "", overdueCount: 1, nextMcmDate: "", lastMcmDate: "",
    mcmStatus: "", risk: "amber" as MCMRisk, status: "new" as MCMStatus,
    assignedOwner: "", notes: "", mcmHistory: [] as McmHistoryItem[],
  };
  const [form, setForm] = useState(empty);

  useEffect(() => {
    if (open) setForm((p) => ({ ...p, learnerEmail: initialEmail, learnerName: initialName }));
  }, [open, initialEmail, initialName]);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof empty, v: string | number) => setForm((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!form.learnerEmail || !form.learnerName) return;
    setSaving(true);
    const res = await fetch("/api/mcm-tickets/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        learner_email: form.learnerEmail,
        learner_name: form.learnerName,
        learner_phone: form.learnerPhone,
        organisation: form.organisation,
        programme: form.programme,
        coach_name: form.coachName,
        overdue_count: form.overdueCount,
        next_mcm_date: form.nextMcmDate,
        last_mcm_date: form.lastMcmDate,
        mcm_status: form.mcmStatus,
        mcm_history: form.mcmHistory,
        risk: form.risk,
        status: form.status,
        notes: form.notes,
        assigned_owner: form.assignedOwner || user?.name || user?.email || "",
        created_by: user?.name || user?.email || "System",
      }),
    });
    setSaving(false);
    if (res.ok) { onCreate(await res.json()); onClose(); setForm(empty); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Create MCM Ticket</DialogTitle></DialogHeader>
        <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
          <div className="col-span-2">
            <Label>Learner Name *</Label>
            <Input value={form.learnerName} onChange={(e) => set("learnerName", e.target.value)} className="mt-1" />
          </div>
          <div className="col-span-2">
            <Label>Learner Email *</Label>
            <Input value={form.learnerEmail} onChange={(e) => set("learnerEmail", e.target.value)} className="mt-1" type="email" />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={form.learnerPhone} onChange={(e) => set("learnerPhone", e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Organisation</Label>
            <Input value={form.organisation} onChange={(e) => set("organisation", e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Programme</Label>
            <Input value={form.programme} onChange={(e) => set("programme", e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Coach Name</Label>
            <Input value={form.coachName} onChange={(e) => set("coachName", e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Overdue Count</Label>
            <Input value={form.overdueCount} onChange={(e) => set("overdueCount", Number(e.target.value))} className="mt-1" type="number" min={0} />
          </div>
          <div>
            <Label>Risk</Label>
            <Select value={form.risk} onValueChange={(v) => set("risk", v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{RISK_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Next MCM Date</Label>
            <Input value={form.nextMcmDate} onChange={(e) => set("nextMcmDate", e.target.value)} className="mt-1" type="date" />
          </div>
          <div>
            <Label>Last MCM Date</Label>
            <Input value={form.lastMcmDate} onChange={(e) => set("lastMcmDate", e.target.value)} className="mt-1" type="date" />
          </div>
          <div>
            <Label>Assigned Owner</Label>
            <Input value={form.assignedOwner} onChange={(e) => set("assignedOwner", e.target.value)} className="mt-1" placeholder={user?.name || ""} />
          </div>
          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} className="mt-1" rows={3} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !form.learnerEmail || !form.learnerName}>
            {saving ? "Creating…" : "Create Ticket"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── EditTicketModal ──────────────────────────────────────────────────────────

function EditTicketModal({
  ticket, open, onClose, onSaved,
}: {
  ticket: MCMTicket | null; open: boolean; onClose: () => void; onSaved: (t: MCMTicket) => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState<Partial<MCMTicket>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (ticket) setForm({ ...ticket }); }, [ticket]);

  const set = (k: keyof MCMTicket, v: string | number | boolean) => setForm((p) => ({ ...p, [k]: v }));

  const save = async () => {
    if (!ticket) return;
    setSaving(true);
    const res = await fetch(`/api/mcm-tickets/${ticket.id}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (res.ok) { onSaved(await res.json()); onClose(); }
  };

  if (!ticket) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Edit Ticket — {ticket.ticketRef}</DialogTitle></DialogHeader>
        <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
          <div className="col-span-2">
            <Label>Learner Name</Label>
            <Input value={form.learnerName ?? ""} onChange={(e) => set("learnerName", e.target.value)} className="mt-1" />
          </div>
          <div className="col-span-2">
            <Label>Learner Email</Label>
            <Input value={form.learnerEmail ?? ""} onChange={(e) => set("learnerEmail", e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={form.learnerPhone ?? ""} onChange={(e) => set("learnerPhone", e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Organisation</Label>
            <Input value={form.organisation ?? ""} onChange={(e) => set("organisation", e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Programme</Label>
            <Input value={form.programme ?? ""} onChange={(e) => set("programme", e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Coach Name</Label>
            <Input value={form.coachName ?? ""} onChange={(e) => set("coachName", e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Risk</Label>
            <Select value={form.risk ?? "amber"} onValueChange={(v) => set("risk", v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{RISK_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status ?? "new"} onValueChange={(v) => set("status", v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Overdue Count</Label>
            <Input value={form.overdueCount ?? 0} onChange={(e) => set("overdueCount", Number(e.target.value))} className="mt-1" type="number" min={0} />
          </div>
          <div>
            <Label>Assigned Owner</Label>
            <Input value={form.assignedOwner ?? ""} onChange={(e) => set("assignedOwner", e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Next MCM Date</Label>
            <Input value={form.nextMcmDate ?? ""} onChange={(e) => set("nextMcmDate", e.target.value)} className="mt-1" type="date" />
          </div>
          <div>
            <Label>Last MCM Date</Label>
            <Input value={form.lastMcmDate ?? ""} onChange={(e) => set("lastMcmDate", e.target.value)} className="mt-1" type="date" />
          </div>
          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} className="mt-1" rows={3} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── ViewModal ────────────────────────────────────────────────────────────────

function ViewModal({
  ticket, open, onClose,
}: {
  ticket: MCMTicket | null; open: boolean; onClose: () => void;
}) {
  const [files, setFiles] = useState<EvidenceFile[]>([]);
  const [preview, setPreview] = useState<EvidenceFile | null>(null);

  useEffect(() => {
    if (!ticket || !open) return;
    void fetch(`/api/mcm-tickets/${ticket.id}/files/`)
      .then((r) => r.json())
      .then(setFiles)
      .catch(() => {});
  }, [ticket, open]);

  if (!ticket) return null;
  const accent = riskAccent[ticket.risk];
  const history = Array.isArray(ticket.mcmHistory) ? ticket.mcmHistory : [];
  const overdueItems = getOverdueMcmItems(history);
  const completedItems = getCompletedMcmItems(history);
  const upcomingItems = history.filter((item) => {
    const dt = mcmDateValue(item.date);
    return Boolean(dt && dt >= isoToday() && !item.completed && !isCompletedMcmStatus(item.status));
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-hidden p-0">
          {/* Accent strip */}
          <div className="h-1.5 w-full" style={{ background: accent }} />
          <div className="max-h-[88vh] overflow-y-auto p-6">
            {/* Header */}
            <div className="flex items-start gap-4">
              <div
                className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white shadow"
                style={{ background: accent }}
              >
                {initials(ticket.learnerName)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-[#14264A]">{ticket.learnerName}</h2>
                  <span className="rounded-full bg-[#EEF3FB] px-2 py-0.5 text-[11px] font-bold text-[#315D93]">{ticket.ticketRef}</span>
                </div>
                <p className="mt-0.5 text-sm text-[#5F7288]">{ticket.learnerEmail}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${riskColor[ticket.risk]}`}>{ticket.risk} Risk</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusColor[ticket.status]}`}>{statusLabel[ticket.status]}</span>
                  {ticket.escalated && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Escalated</span>}
                </div>
              </div>
            </div>

            {/* Info grid */}
            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-[#DDE7F0] p-3">
                <p className="text-xs font-semibold text-[#8AA0B6]">Organisation</p>
                <p className="mt-0.5 font-semibold text-[#14264A]">{ticket.organisation || "—"}</p>
              </div>
              <div className="rounded-xl border border-[#DDE7F0] p-3">
                <p className="text-xs font-semibold text-[#8AA0B6]">Programme</p>
                <p className="mt-0.5 font-semibold text-[#14264A]">{ticket.programme || "—"}</p>
              </div>
              <div className="rounded-xl border border-[#DDE7F0] p-3">
                <p className="text-xs font-semibold text-[#8AA0B6]">Coach</p>
                <p className="mt-0.5 font-semibold text-[#14264A]">{ticket.coachName || "—"}</p>
              </div>
              <div className="rounded-xl border border-[#DDE7F0] p-3">
                <p className="text-xs font-semibold text-[#8AA0B6]">Assigned Owner</p>
                <p className="mt-0.5 font-semibold text-[#14264A]">{ticket.assignedOwner || "—"}</p>
              </div>
            </div>

            {/* MCM metrics */}
            <div className="mt-4 grid grid-cols-4 gap-3">
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-center">
                <p className="text-xl font-bold text-red-600">{ticket.overdueCount}</p>
                <p className="text-xs text-[#5F7288]">Overdue</p>
              </div>
              <div className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-center">
                <p className="text-sm font-bold text-[#14264A]">{fmtDate(ticket.nextMcmDate)}</p>
                <p className="text-xs text-[#5F7288]">Next MCM</p>
              </div>
              <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-center">
                <p className="text-sm font-bold text-[#14264A]">{fmtDate(ticket.lastMcmDate)}</p>
                <p className="text-xs text-[#5F7288]">Last MCM</p>
              </div>
              <div className="rounded-xl border border-[#DDE7F0] bg-[#F8FBFE] p-3 text-center">
                <p className="text-xl font-bold text-[#14264A]">{daysOpen(ticket.createdAt)}</p>
                <p className="text-xs text-[#5F7288]">Days Open</p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-[#DDE7F0] bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-[#14264A]">Monthly Coaching Meeting History</p>
                  <p className="text-xs text-[#71849A]">Completed, overdue, and upcoming MCM records for this learner.</p>
                </div>
                <span className="rounded-full bg-[#EEF3FB] px-2.5 py-1 text-xs font-bold text-[#315D93]">
                  {history.length} records
                </span>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase text-red-700">
                    <AlertTriangle className="h-3.5 w-3.5" /> Overdue ({overdueItems.length})
                  </div>
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {overdueItems.length ? overdueItems.map((item) => (
                      <div key={`${item.date}-${item.status}`} className="rounded-lg bg-white/80 px-2 py-1.5 text-xs">
                        <p className="font-bold text-red-700">{fmtDate(item.date)}</p>
                        <p className="text-[#5F7288]">{item.status || "No status"}</p>
                      </div>
                    )) : <p className="text-xs text-[#8AA0B6]">No overdue meetings.</p>}
                  </div>
                </div>

                <div className="rounded-xl border border-green-200 bg-green-50 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase text-green-700">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Completed ({completedItems.length})
                  </div>
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {completedItems.length ? completedItems.map((item) => (
                      <div key={`${item.date}-${item.status}`} className="rounded-lg bg-white/80 px-2 py-1.5 text-xs">
                        <p className="font-bold text-green-700">{fmtDate(item.date)}</p>
                        <p className="text-[#5F7288]">{item.status || "Completed"}</p>
                      </div>
                    )) : <p className="text-xs text-[#8AA0B6]">No completed meetings recorded.</p>}
                  </div>
                </div>

                <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase text-blue-700">
                    <CalendarCheck2 className="h-3.5 w-3.5" /> Upcoming ({upcomingItems.length})
                  </div>
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {upcomingItems.length ? upcomingItems.map((item) => (
                      <div key={`${item.date}-${item.status}`} className="rounded-lg bg-white/80 px-2 py-1.5 text-xs">
                        <p className="font-bold text-blue-700">{fmtDate(item.date)}</p>
                        <p className="text-[#5F7288]">{item.status || "Planned"}</p>
                      </div>
                    )) : <p className="text-xs text-[#8AA0B6]">No upcoming meetings.</p>}
                  </div>
                </div>
              </div>
            </div>

            {/* Notes */}
            {ticket.notes && (
              <div className="mt-4 rounded-xl border border-[#DDE7F0] bg-[#FAFCFF] p-4">
                <p className="mb-2 text-xs font-semibold uppercase text-[#8AA0B6]">Notes</p>
                <pre className="whitespace-pre-wrap text-sm text-[#14264A]">{ticket.notes}</pre>
              </div>
            )}

            {/* Evidence */}
            {files.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold uppercase text-[#8AA0B6]">Evidence ({files.length})</p>
                <div className="flex flex-wrap gap-2">
                  {files.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setPreview(f)}
                      className="flex items-center gap-1.5 rounded-lg border border-[#DDE7F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#315D93] hover:bg-[#F0F6FF]"
                    >
                      {isImage(f.mimeType, f.name) ? <ImageIcon className="h-3.5 w-3.5" /> : <FileIcon className="h-3.5 w-3.5" />}
                      <span className="max-w-[120px] truncate">{f.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="mt-5 flex items-center justify-between border-t border-[#F0F4F8] pt-4 text-xs text-[#8AA0B6]">
              <span>Created by {ticket.createdBy} · {fmtDate(ticket.createdAt)}</span>
              <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {preview && <FilePreviewModal target={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

// ─── ActionsMenu ──────────────────────────────────────────────────────────────

function MCMTicketActionsMenu({
  ticket, onQuickPatch, onAddNote, onAddEvidence, onEmail,
}: {
  ticket: MCMTicket;
  onQuickPatch: (id: number, data: Partial<MCMTicket>) => void;
  onAddNote: () => void;
  onAddEvidence: () => void;
  onEmail: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-[#EEF3FB]">
          <MoreHorizontal className="h-4 w-4 text-[#5F7288]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-52 overflow-hidden rounded-xl border border-[#DDE7F0] bg-white p-0 shadow-lg"
        style={{ maxHeight: "min(80vh, 480px)" }}
      >
        {/* Fixed header label */}
        <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#8AA0B6]">Notes</div>
        <div
          className="overflow-y-auto"
          style={{ maxHeight: "calc(min(80vh, 480px) - 88px)" }}
        >
          <DropdownMenuItem onClick={onAddNote} className="gap-2 px-3 text-sm">
            <MessageSquare className="h-3.5 w-3.5 text-[#5F7288]" /> Add Note
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onAddEvidence} className="gap-2 px-3 text-sm">
            <Paperclip className="h-3.5 w-3.5 text-[#5F7288]" /> Add Evidence
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8AA0B6]">Status</div>
          <DropdownMenuItem
            onClick={() => onQuickPatch(ticket.id, { escalated: !ticket.escalated })}
            className="gap-2 px-3 text-sm"
          >
            <Flag className="h-3.5 w-3.5 text-amber-500" />
            {ticket.escalated ? "Remove Flag" : "Flag for Attention"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onQuickPatch(ticket.id, { status: "open" })} className="gap-2 px-3 text-sm">
            <RefreshCw className="h-3.5 w-3.5 text-blue-500" /> Reopen
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onQuickPatch(ticket.id, { status: "session_booked" })} className="gap-2 px-3 text-sm">
            <CalendarCheck2 className="h-3.5 w-3.5 text-teal-500" /> Session Booked
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onQuickPatch(ticket.id, { status: "session_completed" })} className="gap-2 px-3 text-sm">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> Session Completed
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onQuickPatch(ticket.id, { status: "resolved" })} className="gap-2 px-3 text-sm">
            <XCircle className="h-3.5 w-3.5 text-[#315D93]" /> Close Ticket
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8AA0B6]">Risk Level</div>
          <DropdownMenuItem onClick={() => onQuickPatch(ticket.id, { risk: "red" })} className="gap-2 px-3 text-sm">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 ${ticket.risk === "red" ? "ring-2 ring-red-300" : ""}`} />
            Red {ticket.risk === "red" && <span className="ml-auto text-[10px] text-[#A0B0C0]">current</span>}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onQuickPatch(ticket.id, { risk: "amber" })} className="gap-2 px-3 text-sm">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400 ${ticket.risk === "amber" ? "ring-2 ring-amber-200" : ""}`} />
            Amber {ticket.risk === "amber" && <span className="ml-auto text-[10px] text-[#A0B0C0]">current</span>}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onQuickPatch(ticket.id, { risk: "green" })} className="gap-2 px-3 text-sm">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full bg-green-500 ${ticket.risk === "green" ? "ring-2 ring-green-200" : ""}`} />
            Green {ticket.risk === "green" && <span className="ml-auto text-[10px] text-[#A0B0C0]">current</span>}
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8AA0B6]">Action Taken</div>
          {ACTION_OPTIONS.filter((a) => a.value).map((a) => (
            <DropdownMenuItem
              key={a.value}
              onClick={() => a.value === "emailed" ? onEmail() : onQuickPatch(ticket.id, { action: a.value })}
              className="gap-2 px-3 text-sm"
            >
              {a.value === "emailed" ? (
                <Mail className="h-3.5 w-3.5 text-[#315D93]" />
              ) : (
                <span className={`h-2 w-2 rounded-full ${ticket.action === a.value ? "bg-[#315D93]" : "bg-[#C5D5E3]"}`} />
              )}
              {a.label}
              {a.value === "emailed" && <span className="ml-auto text-[10px] text-[#A0B0C0]">Email Centre</span>}
            </DropdownMenuItem>
          ))}
        </div>
        {/* Fixed footer spacer */}
        <div className="h-1" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MCMTicketsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tickets, setTickets] = useState<MCMTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [ragFilter, setRagFilter] = useState<"all" | MCMRisk>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | MCMStatus>("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialEmail, setCreateInitialEmail] = useState("");
  const [createInitialName, setCreateInitialName] = useState("");
  const [editTicket, setEditTicket] = useState<MCMTicket | null>(null);
  const [viewTicket, setViewTicket] = useState<MCMTicket | null>(null);
  const [noteTicket, setNoteTicket] = useState<MCMTicket | null>(null);
  const [notesViewTicket, setNotesViewTicket] = useState<MCMTicket | null>(null);
  const [evidenceTicket, setEvidenceTicket] = useState<MCMTicket | null>(null);

  const [evidenceFiles, setEvidenceFiles] = useState<Record<number, EvidenceFile[]>>({});
  const [previewFile, setPreviewFile] = useState<EvidenceFile | null>(null);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const autoSyncedRef = useRef(false);
  const ticketsRef = useRef<MCMTicket[]>([]);
  useEffect(() => { ticketsRef.current = tickets; }, [tickets]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/mcm-tickets/?archived=${showArchived}`);
      if (res.ok) setTickets(await res.json());
    } finally { if (!silent) setLoading(false); }
  }, [showArchived]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const learner = searchParams.get("learner");
    if (learner) setSearch(learner);
    const newFor = searchParams.get("newFor");
    const newName = searchParams.get("newName");
    if (newFor) {
      setCreateInitialEmail(newFor);
      setCreateInitialName(newName || "");
      setCreateOpen(true);
    }
  }, [searchParams]);

  const autoCreateOverdueTickets = useCallback(async () => {
    if (showArchived) return;
    setAutoSyncing(true);
    try {
      const summaryRes = await fetch("/api/mcr-summary/");
      if (!summaryRes.ok) return;
      const rows = await summaryRes.json();
      if (!Array.isArray(rows)) return;

      const syncRes = await fetch("/api/mcm-tickets/auto-create/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      if (!syncRes.ok) return;
      const result = await syncRes.json();
      if ((result.createdCount || 0) > 0 || (result.updatedCount || 0) > 0) void load(true);
    } finally {
      setAutoSyncing(false);
    }
  }, [load, showArchived]);

  useEffect(() => {
    if (loading || showArchived || autoSyncedRef.current) return;
    autoSyncedRef.current = true;
    void autoCreateOverdueTickets();
  }, [autoCreateOverdueTickets, loading, showArchived]);

  const loadFiles = useCallback(async (id: number) => {
    const res = await fetch(`/api/mcm-tickets/${id}/files/`);
    if (res.ok) {
      const data = await res.json();
      setEvidenceFiles((p) => ({ ...p, [id]: data }));
    }
  }, []);

  const patchTicket = useCallback(async (id: number, data: Partial<MCMTicket>) => {
    const currentTicket = ticketsRef.current.find((t) => t.id === id);
    let finalData = { ...data };

    // Auto-append status-change note (only for explicit status-only patches)
    if (data.status && currentTicket && data.status !== currentTicket.status && data.notes === undefined) {
      const dateStr = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      const byLine = user?.fullName || user?.name || user?.email || "";
      const note = `[${dateStr}${byLine ? ` · ${byLine}` : ""}] Status changed from "${MCM_STATUS_LABELS[currentTicket.status] || currentTicket.status}" to "${MCM_STATUS_LABELS[data.status] || data.status}"`;
      const existing = currentTicket.notes?.trim() || "";
      finalData.notes = existing ? `${existing}\n${note}` : note;
    }

    const res = await fetch(`/api/mcm-tickets/${id}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(finalData),
    });
    if (res.ok) {
      const updated: MCMTicket = await res.json();
      setTickets((p) => p.map((t) => (t.id === id ? updated : t)));
      setNotesViewTicket((prev) => (prev?.id === id ? updated : prev));
    }
  }, [user]);

  useEffect(() => {
    const emailedId = searchParams.get("emailed_ticket");
    if (!emailedId || loading) return;
    const ticketId = Number(emailedId);
    const ticket = tickets.find((item) => item.id === ticketId);
    const dateLabel = new Date().toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    const sentBy = user?.fullName || user?.name || user?.email || "";
    const noteEntry = `Email sent on ${dateLabel}${sentBy ? ` by ${sentBy}` : ""}`;
    const currentNotes = ticket?.notes?.trim() || "";
    const notes = currentNotes ? `${currentNotes}\n${noteEntry}` : noteEntry;
    void patchTicket(ticketId, {
      action: "emailed",
      notes,
      assignedOwner: ticket?.assignedOwner || sentBy,
    } as Partial<MCMTicket>);
    setSearchParams({}, { replace: true });
  }, [loading, patchTicket, searchParams, setSearchParams, tickets, user]);

  const handleEmailTicket = useCallback((ticket: MCMTicket) => {
    navigate("/email-centre", {
      state: {
        selectedRecipient: {
          learnerName: ticket.learnerName,
          learnerEmail: ticket.learnerEmail,
          programme: ticket.programme || "",
          coachName: ticket.coachName || "",
          coachEmail: "",
          dueDate: ticket.nextMcmDate || "",
          periodDate: ticket.nextMcmDate || "",
          bookingLink: "",
          status: "Active",
          riskCategories: ["coaching-due"],
        },
        source: "mcm-ticket",
        ticketId: ticket.id,
      },
    });
  }, [navigate]);

  const archiveToggle = useCallback(async (ticket: MCMTicket) => {
    await fetch(`/api/mcm-tickets/${ticket.id}/archive/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archive: !ticket.isArchived }),
    });
    void load();
  }, [load]);

  const deleteTicket = useCallback(async (ticket: MCMTicket) => {
    if (!ticket.isArchived) return;
    if (!confirm(`Delete ${ticket.ticketRef}? This cannot be undone.`)) return;
    await fetch(`/api/mcm-tickets/${ticket.id}/`, { method: "DELETE" });
    setTickets((p) => p.filter((t) => t.id !== ticket.id));
  }, []);

  const deleteFile = useCallback(async (ticketId: number, fileId: number) => {
    await fetch(`/api/mcm-tickets/${ticketId}/files/${fileId}/`, { method: "DELETE" });
    void loadFiles(ticketId);
  }, [loadFiles]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return tickets.filter((t) => {
      if (q && !t.learnerName.toLowerCase().includes(q) && !t.learnerEmail.toLowerCase().includes(q) && !t.ticketRef.toLowerCase().includes(q)) return false;
      if (ragFilter !== "all" && t.risk !== ragFilter) return false;
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      return true;
    });
  }, [tickets, search, ragFilter, statusFilter]);

  const totals = useMemo(() => ({
    all: tickets.length,
    open: tickets.filter((t) => ["new", "open", "session_booked"].includes(t.status)).length,
    resolved: tickets.filter((t) => t.status === "resolved").length,
  }), [tickets]);

  const exportCsv = () => {
    const cols = ["Ticket Ref", "Learner", "Email", "Risk", "Status", "Coach", "Overdue", "Next MCM", "Last MCM", "Days Open", "Owner"];
    const rows = filtered.map((t) => [t.ticketRef, t.learnerName, t.learnerEmail, t.risk, t.status, t.coachName, t.overdueCount, t.nextMcmDate, t.lastMcmDate, daysOpen(t.createdAt), t.assignedOwner]);
    const csv = [cols, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "mcm-tickets.csv"; a.click();
  };

  return (
    <AppLayout>
      <div className="min-h-full bg-[#F4F8FC]">
        {/* Header */}
        <div className="border-b border-[#DDE7F0] bg-white px-4 pb-5 pt-4 sm:px-6">
          <BackButton to="/coaching-meetings" label="Monthly Coaching Meetings" />
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E8F0F9]">
                <Ticket className="h-5 w-5 text-[#315D93]" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-[#14264A]">MCM Ticket System</h1>
                <p className="mt-0.5 text-sm text-[#5F7288]">
                  Track and manage monthly coaching meeting tickets
                  {autoSyncing && <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">Auto-syncing overdue MCMs...</span>}
                </p>
              </div>
            </div>
            <Button onClick={() => setCreateOpen(true)} className="flex items-center gap-1.5 bg-[#315D93] text-white hover:bg-[#274D7A]">
              <Plus className="h-4 w-4" /> New Ticket
            </Button>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          {/* Summary cards */}
          <div className="mb-5 grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-[#DDE7F0] bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold text-[#5F7288]">All Tickets</p>
              <p className="mt-1 text-2xl font-bold text-[#14264A]">{totals.all}</p>
            </div>
            <div className="rounded-xl border border-[#DDE7F0] bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold text-[#5F7288]">Open Tickets</p>
              <p className="mt-1 text-2xl font-bold text-[#315D93]">{totals.open}</p>
            </div>
            <div className="rounded-xl border border-[#DDE7F0] bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold text-[#5F7288]">Resolved</p>
              <p className="mt-1 text-2xl font-bold text-[#315D93]">{totals.resolved}</p>
            </div>
          </div>

          {/* Filters */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative flex-1" style={{ minWidth: 200 }}>
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8AA0B6]" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tickets…" className="h-10 rounded-lg border-[#D7E5F3] bg-white pl-9 text-sm" />
            </div>

            {/* RAG filter */}
            <div className="flex gap-1 rounded-lg border border-[#DDE7F0] bg-white p-1">
              {(["all", "red", "amber", "green"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRagFilter(r)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${ragFilter === r ? "bg-[#315D93] text-white" : "text-[#5F7288] hover:bg-[#F0F6FF]"}`}
                >
                  {r === "all" ? "All" : r.charAt(0).toUpperCase() + r.slice(1)}
                </button>
              ))}
            </div>

            {/* Status filter */}
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="h-10 w-auto min-w-[150px] rounded-lg border-[#D7E5F3] bg-white text-sm font-medium text-[#14264A]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-[#DDE7F0] shadow-xl">
                <SelectItem value="all">All Statuses</SelectItem>
                {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>

            <button
              onClick={() => setShowArchived((p) => !p)}
              className={`flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition-colors ${showArchived ? "border-amber-300 bg-amber-50 text-amber-700" : "border-[#DDE7F0] bg-white text-[#24486D] hover:bg-[#F0F6FF]"}`}
            >
              <Archive className="h-4 w-4" /> {showArchived ? "Archived" : "Archive"}
            </button>

            <button onClick={exportCsv} className="flex h-10 items-center gap-1.5 rounded-lg border border-[#DDE7F0] bg-white px-3 text-sm font-semibold text-[#24486D] hover:bg-[#F0F6FF]">
              <Download className="h-4 w-4" /> Export
            </button>
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-xl border border-[#DDE7F0] bg-white shadow-sm">
            {loading ? (
              <div className="flex h-40 items-center justify-center text-sm text-[#5F7288]">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-[#5F7288]">
                <Ticket className="h-8 w-8 text-[#C5D5E3]" /><p>No tickets found</p>
              </div>
            ) : (
              <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 380px)" }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#DDE7F0] bg-[#F8FBFE]">
                      <th className="sticky top-0 z-10 whitespace-nowrap bg-[#F8FBFE] px-3 py-3 text-left text-xs font-semibold text-[#5F7288]">Ticket</th>
                      <th className="sticky left-0 top-0 z-30 whitespace-nowrap border-r border-[#DDE7F0] bg-[#F8FBFE] px-3 py-3 text-left text-xs font-semibold text-[#5F7288]">Learner</th>
                      {["Risk", "Status", "Owner", "Coach", "Overdue", "Next MCM", "Days Open", "Notes", "Evidence", "Actions"].map((h) => (
                        <th key={h} className="sticky top-0 z-10 whitespace-nowrap bg-[#F8FBFE] px-3 py-3 text-left text-xs font-semibold text-[#5F7288]">{h}</th>
                      ))}
                      <th className="sticky top-0 z-10 bg-[#F8FBFE] px-3 py-3 text-xs font-semibold text-[#5F7288]">Edit</th>
                      <th className="sticky top-0 z-10 bg-[#F8FBFE] px-3 py-3 text-xs font-semibold text-[#5F7288]">Archive</th>
                      <th className="sticky top-0 z-10 bg-[#F8FBFE] px-3 py-3 text-xs font-semibold text-[#5F7288]">View</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t) => (
                      <tr key={t.id} className="group border-b border-[#F0F4F8] hover:bg-[#F8FBFE]">
                        {/* Ticket ref */}
                        <td className="whitespace-nowrap px-3 py-3">
                          <span className="rounded-full bg-[#EEF3FB] px-2 py-0.5 text-[11px] font-bold text-[#315D93]">{t.ticketRef}</span>
                          {t.escalated && <Flag className="ml-1 inline h-3 w-3 text-amber-500" />}
                        </td>
                        {/* Learner */}
                        <td className="sticky left-0 z-10 border-r border-[#DDE7F0] bg-white px-3 py-3 group-hover:bg-[#F8FBFE]">
                          <p className="font-semibold text-[#14264A]">{t.learnerName}</p>
                          <p className="text-[11px] text-[#71849A]">{t.learnerEmail}</p>
                        </td>
                        {/* Risk */}
                        <td className="px-3 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${riskColor[t.risk]}`}>{t.risk}</span>
                        </td>
                        {/* Status */}
                        <td className="px-3 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusColor[t.status]}`}>{statusLabel[t.status]}</span>
                        </td>
                        {/* Owner */}
                        <td className="px-3 py-3 text-xs text-[#5F7288]">{t.assignedOwner || "—"}</td>
                        {/* Coach */}
                        <td className="px-3 py-3 text-xs text-[#5F7288]">{t.coachName || "—"}</td>
                        {/* Overdue */}
                        <td className="px-3 py-3 text-center">
                          <OverdueBadge ticket={t} />
                        </td>
                        {/* Next MCM */}
                        <td className="whitespace-nowrap px-3 py-3 text-xs text-[#5F7288]">{fmtDate(t.nextMcmDate)}</td>
                        {/* Days open */}
                        <td className="px-3 py-3 text-center">
                          <span className="flex items-center gap-1 text-xs text-[#5F7288]">
                            <Clock className="h-3 w-3" />{daysOpen(t.createdAt)}d
                          </span>
                        </td>
                        {/* Notes */}
                        <td className="px-3 py-3">
                          <NotesCell
                            ticket={t}
                            onOpen={() => setNotesViewTicket(t)}
                            onAddNote={() => setNoteTicket(t)}
                          />
                        </td>
                        {/* Evidence */}
                        <td className="px-3 py-3">
                          <EvidenceCell
                            ticket={t}
                            files={evidenceFiles[t.id]}
                            onLoad={() => void loadFiles(t.id)}
                            onPreview={(f) => setPreviewFile(f)}
                          />
                        </td>
                        {/* Actions dropdown */}
                        <td className="px-3 py-3">
                          <MCMTicketActionsMenu
                            ticket={t}
                            onQuickPatch={(id, data) => void patchTicket(id, data)}
                            onAddNote={() => setNoteTicket(t)}
                            onAddEvidence={() => setEvidenceTicket(t)}
                            onEmail={() => handleEmailTicket(t)}
                          />
                          {t.action === "emailed" && (
                            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                              <Mail className="h-3 w-3" /> Emailed
                            </span>
                          )}
                        </td>
                        {/* Edit */}
                        <td className="px-3 py-3">
                          <button
                            onClick={() => setEditTicket(t)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-[#5F7288] hover:bg-[#EEF3FB] hover:text-[#315D93]"
                          >
                            <FileText className="h-4 w-4" />
                          </button>
                        </td>
                        {/* Archive / Delete */}
                        <td className="px-3 py-3">
                          {t.isArchived ? (
                            <button
                              onClick={() => void deleteTicket(t)}
                              className="flex h-7 w-7 items-center justify-center rounded-lg text-red-400 hover:bg-red-50"
                              title="Delete permanently"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          ) : (
                            <button
                              onClick={() => void archiveToggle(t)}
                              className="flex h-7 w-7 items-center justify-center rounded-lg text-[#5F7288] hover:bg-amber-50 hover:text-amber-600"
                              title="Archive"
                            >
                              <Archive className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                        {/* View */}
                        <td className="px-3 py-3">
                          <button
                            onClick={() => setViewTicket(t)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-[#5F7288] hover:bg-[#EEF3FB] hover:text-[#315D93]"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      <CreateTicketModal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setCreateInitialEmail(""); setCreateInitialName(""); }}
        onCreate={(t) => { setTickets((p) => [t, ...p]); }}
        initialEmail={createInitialEmail}
        initialName={createInitialName}
      />

      <EditTicketModal
        ticket={editTicket}
        open={!!editTicket}
        onClose={() => setEditTicket(null)}
        onSaved={(t) => setTickets((p) => p.map((x) => (x.id === t.id ? t : x)))}
      />

      <ViewModal
        ticket={viewTicket}
        open={!!viewTicket}
        onClose={() => setViewTicket(null)}
      />

      {noteTicket && (
        <AddNoteModal
          ticket={noteTicket}
          open={!!noteTicket}
          onClose={() => setNoteTicket(null)}
          onSaved={(t) => {
            setTickets((p) => p.map((x) => (x.id === t.id ? t : x)));
            setNotesViewTicket((prev) => (prev?.id === t.id ? t : prev));
          }}
        />
      )}

      {evidenceTicket && (
        <AddEvidenceModal
          ticket={evidenceTicket}
          open={!!evidenceTicket}
          onClose={() => setEvidenceTicket(null)}
          onSaved={(t) => setTickets((p) => p.map((x) => (x.id === t.id ? t : x)))}
        />
      )}

      {previewFile && <FilePreviewModal target={previewFile} onClose={() => setPreviewFile(null)} />}

      {notesViewTicket && (
        <NotesModal
          ticket={notesViewTicket}
          onClose={() => setNotesViewTicket(null)}
          onAddNote={() => { setNotesViewTicket(null); setNoteTicket(notesViewTicket); }}
        />
      )}
    </AppLayout>
  );
}
