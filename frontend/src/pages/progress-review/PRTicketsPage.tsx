import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle, Archive, CalendarClock, CheckCircle2, ChevronDown,
  ClipboardCheck, Download, Eye, File as FileIcon, FileText, Filter, Flag,
  Image as ImageIcon, MessageSquare, MoreHorizontal, Paperclip, Plus,
  RefreshCw, Search, Trash2, UploadCloud, X, XCircle, ZoomIn,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ─── Types ────────────────────────────────────────────────────────────

type PRRisk = "red" | "amber" | "green";
type PRStatus = "new" | "open" | "pr_scheduled" | "pr_completed" | "support_plan_active" | "resolved";
type PRAction = "" | "called" | "emailed" | "pr_booked" | "pr_done" | "referred_support" | "no_action";

interface EvidenceFile { id: number; name: string; url: string; mimeType: string; uploadedAt: string; }

interface PRTicket {
  id: number; ticketRef: string; learnerEmail: string; learnerName: string;
  learnerPhone: string; organisation: string; programme: string;
  lastPrDate: string | null; nextPrDate: string | null; overdueCount: number;
  risk: PRRisk; status: PRStatus; assignedOwner: string; action: string;
  notes: string; evidenceCount: number; isArchived: boolean; escalated: boolean;
  createdBy: string; createdAt: string; updatedAt: string;
}

const ACTION_OPTIONS: { value: PRAction; label: string }[] = [
  { value: "", label: "— No action selected —" },
  { value: "called", label: "Called" },
  { value: "emailed", label: "Emailed" },
  { value: "pr_booked", label: "PR Booked" },
  { value: "pr_done", label: "PR Completed" },
  { value: "referred_support", label: "Referred to Support" },
  { value: "no_action", label: "No Action Required" },
];

const EMPTY_FORM = {
  learnerEmail: "", learnerName: "", learnerPhone: "", organisation: "",
  programme: "", lastPrDate: "", nextPrDate: "", overdueCount: 0,
  risk: "green" as PRRisk, status: "new" as PRStatus, assignedOwner: "",
  action: "" as PRAction, notes: "", escalated: false,
};

// ─── Visual helpers ────────────────────────────────────────────────────

const riskBadge = (risk: PRRisk) => {
  const s: Record<PRRisk, string> = { red: "bg-red-100 text-red-700 border-red-200", amber: "bg-amber-100 text-amber-700 border-amber-200", green: "bg-green-100 text-green-700 border-green-200" };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${s[risk]}`}>{risk}</span>;
};

const statusBadge = (status: PRStatus) => {
  const map: Record<PRStatus, { label: string; cls: string }> = {
    new: { label: "New", cls: "bg-slate-100 text-slate-700 border-slate-200" },
    open: { label: "Open", cls: "bg-blue-100 text-blue-700 border-blue-200" },
    pr_scheduled: { label: "PR Scheduled", cls: "bg-teal-100 text-teal-700 border-teal-200" },
    pr_completed: { label: "PR Completed", cls: "bg-green-100 text-green-700 border-green-200" },
    support_plan_active: { label: "Support Plan Active", cls: "bg-orange-100 text-orange-700 border-orange-200" },
    resolved: { label: "Resolved", cls: "bg-green-100 text-green-700 border-green-200" },
  };
  const { label, cls } = map[status] ?? map.new;
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
};

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return iso; }
};
const daysSince = (iso: string) => { try { return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000); } catch { return 0; } };
const isImage = (mime: string, name: string) => mime.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(name);
const isPdf = (mime: string, name: string) => mime === "application/pdf" || /\.pdf$/i.test(name);
const isText = (mime: string, name: string) => mime.startsWith("text/") || /\.(csv|txt|log)$/i.test(name);
const isCsv = (mime: string, name: string) => mime === "text/csv" || /\.csv$/i.test(name);

// ─── File Preview Modal ────────────────────────────────────────────────

interface PreviewTarget { url: string; name: string; mime: string; size?: number; revoke?: boolean; }

function FilePreviewModal({ target, onClose }: { target: PreviewTarget | null; onClose: () => void }) {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);

  useEffect(() => {
    if (!target) { setTextContent(null); return; }
    if (isText(target.mime, target.name)) {
      setTextLoading(true);
      fetch(target.url).then((r) => r.text()).then((t) => { setTextContent(t); setTextLoading(false); }).catch(() => setTextLoading(false));
    } else { setTextContent(null); }
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => { window.removeEventListener("keydown", h); if (target.revoke) URL.revokeObjectURL(target.url); };
  }, [target, onClose]);

  const csvRows = useMemo(() => {
    if (!target || !isCsv(target.mime, target.name) || !textContent) return null;
    return textContent.trim().split("\n").map((line) => line.split(",").map((c) => c.replace(/^"|"$/g, "").trim()));
  }, [target, textContent]);

  if (!target) return null;
  const img = isImage(target.mime, target.name);
  const pdf = isPdf(target.mime, target.name);
  const csv = isCsv(target.mime, target.name);
  const txt = isText(target.mime, target.name) && !csv;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-[#DDE7F0] px-4 py-3">
          {img ? <ImageIcon className="h-4 w-4 shrink-0 text-[#1E6ACB]" /> : <FileIcon className="h-4 w-4 shrink-0 text-[#1E6ACB]" />}
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#14264A]">{target.name}</span>
          <a href={target.url} download={target.name} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg p-1.5 text-[#1E6ACB] hover:bg-[#EEF7FF]"><Download className="h-4 w-4" /></a>
          <button onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-[#71849A] hover:bg-[#F0F4F8]"><X className="h-4 w-4" /></button>
        </div>
        <div className={`flex-1 overflow-auto bg-[#F4F8FC] ${img ? "flex items-center justify-center p-4" : "p-4"}`}>
          {img && <img src={target.url} alt={target.name} className="max-h-[75vh] max-w-full rounded-lg object-contain shadow-md" />}
          {pdf && <iframe src={target.url} title={target.name} className="h-[72vh] w-full rounded-lg border border-[#DDE7F0]" />}
          {csv && (textLoading ? <div className="flex h-40 items-center justify-center text-sm text-[#71849A]">Loading…</div> : csvRows ? (
            <div className="overflow-auto rounded-xl border border-[#DDE7F0] bg-white">
              <table className="min-w-full text-xs">
                <thead><tr className="border-b border-[#DDE7F0] bg-[#F0F6FF]">{csvRows[0].map((c, i) => <th key={i} className="px-3 py-2 text-left font-semibold text-[#14264A]">{c}</th>)}</tr></thead>
                <tbody>{csvRows.slice(1).map((row, ri) => <tr key={ri} className={ri % 2 === 0 ? "bg-white" : "bg-[#F9FBFD]"}>{row.map((c, ci) => <td key={ci} className="px-3 py-2 text-[#3A506B]">{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          ) : <p className="text-sm text-[#A0B0C0]">Could not load CSV.</p>)}
          {txt && (textLoading ? <div className="flex h-40 items-center justify-center text-sm text-[#71849A]">Loading…</div> : textContent ? <pre className="max-h-[72vh] overflow-auto whitespace-pre-wrap rounded-xl border border-[#DDE7F0] bg-white p-4 font-mono text-xs text-[#14264A]">{textContent}</pre> : <p className="text-sm text-[#A0B0C0]">Could not load file.</p>)}
          {!img && !pdf && !csv && !txt && (
            <div className="flex flex-col items-center gap-4 py-10">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[#EEF7FF]"><FileIcon className="h-10 w-10 text-[#1E6ACB]" /></div>
              <p className="text-xs text-[#A0B0C0]">Preview not available for this file type</p>
              <a href={target.url} download={target.name} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-[#14264A] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1E3A6A]"><Download className="h-4 w-4" />Download file</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Evidence Upload Zone ──────────────────────────────────────────────

interface EvidenceUploadZoneProps { ticketId?: number; existingFiles: EvidenceFile[]; pendingFiles: File[]; onAddPending: (f: File[]) => void; onRemovePending: (i: number) => void; onDeleteExisting: (id: number) => void; uploading?: boolean; }

function EvidenceUploadZone({ ticketId, existingFiles, pendingFiles, onAddPending, onRemovePending, onDeleteExisting, uploading }: EvidenceUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const totalCount = existingFiles.length + pendingFiles.length;

  return (
    <>
      <div className="space-y-3">
        <div onClick={() => inputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); const f = Array.from(e.dataTransfer.files); if (f.length) onAddPending(f); }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 transition-colors ${dragging ? "border-[#1E6ACB] bg-[#EEF7FF]" : "border-[#D7E5F3] bg-[#F8FBFE] hover:border-[#1E6ACB] hover:bg-[#EEF7FF]"}`}>
          <UploadCloud className={`h-8 w-8 ${dragging ? "text-[#1E6ACB]" : "text-[#A0B8D0]"}`} />
          <p className="text-sm font-semibold text-[#14264A]">{uploading ? "Uploading…" : "Click to upload or drag & drop"}</p>
          <input ref={inputRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" onChange={(e) => { const f = Array.from(e.target.files || []); if (f.length) onAddPending(f); e.target.value = ""; }} className="hidden" />
        </div>
        {totalCount > 0 && (
          <div className="space-y-2">
            {existingFiles.map((f) => (
              <div key={f.id} className="group flex items-center gap-3 rounded-lg border border-[#DDE7F0] bg-white p-2.5">
                <button type="button" onClick={() => setPreview({ url: f.url, name: f.name, mime: f.mimeType, revoke: false })} className="relative shrink-0 overflow-hidden rounded-md">
                  {isImage(f.mimeType, f.name) ? <img src={f.url} alt={f.name} className="h-10 w-10 object-cover" /> : <div className="flex h-10 w-10 items-center justify-center bg-[#EEF7FF]"><FileIcon className="h-5 w-5 text-[#1E6ACB]" /></div>}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100"><ZoomIn className="h-4 w-4 text-white" /></div>
                </button>
                <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-[#14264A]">{f.name}</p><p className="text-[11px] text-[#71849A]">{fmtDate(f.uploadedAt)}</p></div>
                <button type="button" onClick={() => setPreview({ url: f.url, name: f.name, mime: f.mimeType, revoke: false })} className="shrink-0 rounded p-1 text-[#1E6ACB] hover:bg-[#EEF7FF]"><Eye className="h-4 w-4" /></button>
                <a href={f.url} target="_blank" rel="noreferrer" className="shrink-0 rounded p-1 text-[#1E6ACB] hover:bg-[#EEF7FF]"><Download className="h-4 w-4" /></a>
                <button type="button" onClick={() => onDeleteExisting(f.id)} className="shrink-0 rounded p-1 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            {pendingFiles.map((f, i) => (
              <div key={`p-${i}`} className="group flex items-center gap-3 rounded-lg border border-dashed border-[#B8D7F2] bg-[#F0F8FF] p-2.5">
                <button type="button" onClick={() => { const url = URL.createObjectURL(f); setPreview({ url, name: f.name, mime: f.type || "", size: f.size, revoke: true }); }} className="relative shrink-0 overflow-hidden rounded-md">
                  {f.type.startsWith("image/") ? <img src={URL.createObjectURL(f)} alt={f.name} className="h-10 w-10 object-cover" /> : <div className="flex h-10 w-10 items-center justify-center bg-[#EEF7FF]"><FileIcon className="h-5 w-5 text-[#1E6ACB]" /></div>}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100"><ZoomIn className="h-4 w-4 text-white" /></div>
                </button>
                <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-[#14264A]">{f.name}</p><p className="text-[11px] text-[#71849A]">{(f.size / 1024).toFixed(0)} KB · Pending upload</p></div>
                <button type="button" onClick={() => onRemovePending(i)} className="shrink-0 rounded p-1 text-red-400 hover:bg-red-50"><X className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      <FilePreviewModal target={preview} onClose={() => setPreview(null)} />
    </>
  );
}

// ─── Ticket Form Modal ─────────────────────────────────────────────────

function PRTicketFormModal({ open, onClose, onSave, initial, ticketId }: { open: boolean; onClose: () => void; onSave: (data: typeof EMPTY_FORM, files: File[]) => Promise<void>; initial?: Partial<typeof EMPTY_FORM>; ticketId?: number; }) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initial });
  const [saving, setSaving] = useState(false);
  const [existingFiles, setExistingFiles] = useState<EvidenceFile[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  useEffect(() => { if (open) { setForm({ ...EMPTY_FORM, ...initial }); setPendingFiles([]); } }, [open]);
  useEffect(() => {
    if (open && ticketId) {
      fetch(`/api/pr-tickets/${ticketId}/files/`).then((r) => r.ok ? r.json() : []).then(setExistingFiles).catch(() => setExistingFiles([]));
    } else { setExistingFiles([]); }
  }, [open, ticketId]);

  const set = (k: keyof typeof EMPTY_FORM, v: string | boolean | number) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-xl border-[#DDE7F0]">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-[#14264A]">{ticketId ? "Edit PR Ticket" : "Create PR Ticket"}</DialogTitle>
        </DialogHeader>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {([["learnerEmail", "Learner Email *", "learner@example.com"], ["learnerName", "Learner Name *", "Full name"], ["learnerPhone", "Phone", "07700 000000"], ["organisation", "Organisation", "Organisation name"], ["programme", "Programme", "e.g. Team Leader"], ["assignedOwner", "Assigned Owner", "Coach or staff name"]] as const).map(([key, label, placeholder]) => (
            <div key={key} className="space-y-1.5">
              <Label className="text-xs font-semibold text-[#24486D]">{label}</Label>
              <Input value={form[key] as string} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} className="h-10 rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm" disabled={key === "learnerEmail" && !!ticketId} />
            </div>
          ))}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-[#24486D]">Last PR Date</Label>
            <Input type="date" value={form.lastPrDate} onChange={(e) => set("lastPrDate", e.target.value)} className="h-10 rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-[#24486D]">Next PR Date</Label>
            <Input type="date" value={form.nextPrDate} onChange={(e) => set("nextPrDate", e.target.value)} className="h-10 rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-[#24486D]">Overdue PRs</Label>
            <Input type="number" min={0} value={form.overdueCount} onChange={(e) => set("overdueCount", Number(e.target.value))} className="h-10 rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-[#24486D]">Risk Level</Label>
            <Select value={form.risk} onValueChange={(v) => set("risk", v as PRRisk)}>
              <SelectTrigger className="h-10 rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="green">Green</SelectItem><SelectItem value="amber">Amber</SelectItem><SelectItem value="red">Red</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-[#24486D]">Status</Label>
            <Select value={form.status} onValueChange={(v) => set("status", v as PRStatus)}>
              <SelectTrigger className="h-10 rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem><SelectItem value="open">Open</SelectItem>
                <SelectItem value="pr_scheduled">PR Scheduled</SelectItem><SelectItem value="pr_completed">PR Completed</SelectItem>
                <SelectItem value="support_plan_active">Support Plan Active</SelectItem><SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs font-semibold text-[#24486D]">Action Taken</Label>
            <Select value={form.action} onValueChange={(v) => set("action", v as PRAction)}>
              <SelectTrigger className="h-10 rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm"><SelectValue placeholder="Select an action…" /></SelectTrigger>
              <SelectContent>{ACTION_OPTIONS.map((o) => <SelectItem key={o.value || "__none__"} value={o.value || "__none__"}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs font-semibold text-[#24486D]">Notes</Label>
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Add any relevant notes…" className="min-h-[80px] rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs font-semibold text-[#24486D]">Evidence <span className="font-normal text-[#71849A]">— images, PDFs, or documents</span></Label>
            <EvidenceUploadZone ticketId={ticketId} existingFiles={existingFiles} pendingFiles={pendingFiles}
              onAddPending={(f) => setPendingFiles((p) => [...p, ...f])} onRemovePending={(i) => setPendingFiles((p) => p.filter((_, idx) => idx !== i))}
              onDeleteExisting={async (id) => { await fetch(`/api/pr-tickets/${ticketId}/files/${id}/`, { method: "DELETE" }); setExistingFiles((p) => p.filter((f) => f.id !== id)); }} />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" id="pr-escalated" checked={form.escalated} onChange={(e) => set("escalated", e.target.checked)} className="h-4 w-4 rounded border-[#D7E5F3] accent-[#14264A]" />
            <label htmlFor="pr-escalated" className="text-sm font-medium text-[#14264A]">Mark as Escalated</label>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-lg border-[#DDE7F0]">Cancel</Button>
          <Button onClick={async () => { if (!form.learnerEmail.trim() || !form.learnerName.trim()) return; setSaving(true); try { await onSave(form, pendingFiles); onClose(); } finally { setSaving(false); } }}
            disabled={saving || !form.learnerEmail.trim() || !form.learnerName.trim()} className="rounded-lg bg-[#14264A] text-white hover:bg-[#184D91]">
            {saving ? "Saving…" : ticketId ? "Save Changes" : "Create Ticket"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── PR Ticket Actions Menu ────────────────────────────────────────────

function PRTicketActionsMenu({ ticket, onAddNote, onQuickAction }: { ticket: PRTicket; onAddNote: () => void; onQuickAction: (id: number, updates: Record<string, unknown>) => Promise<void>; }) {
  const noteCount = ticket.notes.split("\n").filter((l) => l.trim()).length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-lg p-1.5 text-[#71849A] hover:bg-[#F0F4F8] focus:outline-none"><MoreHorizontal className="h-4 w-4" /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 overflow-hidden rounded-xl border-[#DDE7F0] p-0 shadow-xl">
        <div className="border-b border-[#DDE7F0] bg-[#F8FBFE] px-3 py-2">
          <p className="text-[11px] font-bold text-[#14264A]">Ticket Actions</p>
          <p className="truncate text-[10px] text-[#71849A]">{ticket.ticketRef} · {ticket.learnerName}</p>
        </div>
        <div className="space-y-0.5 p-1.5">
          <p className="px-2 pb-0.5 pt-1 text-[10px] font-bold uppercase tracking-wide text-[#A0B0C0]">Notes</p>
          <DropdownMenuItem onClick={onAddNote} className="cursor-pointer gap-2 rounded-lg text-[#14264A] hover:bg-[#F0F4F8]"><FileText className="h-4 w-4 text-[#5F7288]" />Add Note</DropdownMenuItem>
          <DropdownMenuSeparator className="my-1 bg-[#EEF3F8]" />
          <p className="px-2 pb-0.5 pt-1 text-[10px] font-bold uppercase tracking-wide text-[#A0B0C0]">Schedule</p>
          <DropdownMenuItem onClick={() => onQuickAction(ticket.id, { status: "pr_scheduled" })} className="cursor-pointer gap-2 rounded-lg text-[#14264A] hover:bg-[#F0F4F8]"><CalendarClock className="h-4 w-4 text-[#5F7288]" />Schedule PR</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onQuickAction(ticket.id, { status: "pr_completed" })} className="cursor-pointer gap-2 rounded-lg text-[#14264A] hover:bg-[#F0F4F8]"><ClipboardCheck className="h-4 w-4 text-green-600" />Mark PR Completed</DropdownMenuItem>
          <DropdownMenuSeparator className="my-1 bg-[#EEF3F8]" />
          <p className="px-2 pb-0.5 pt-1 text-[10px] font-bold uppercase tracking-wide text-[#A0B0C0]">Status</p>
          <DropdownMenuItem onClick={() => onQuickAction(ticket.id, { escalated: true, risk: "red" })} className="cursor-pointer gap-2 rounded-lg text-[#14264A] hover:bg-[#F0F4F8]"><Flag className="h-4 w-4 text-amber-500" />Flag for Attention</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onQuickAction(ticket.id, { status: "open", escalated: false })} className="cursor-pointer gap-2 rounded-lg text-[#14264A] hover:bg-[#F0F4F8]"><RefreshCw className="h-4 w-4 text-green-600" />Reopen / Set Active</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onQuickAction(ticket.id, { status: "resolved" })} className="cursor-pointer gap-2 rounded-lg text-red-600 hover:bg-red-50 focus:bg-red-50 focus:text-red-600"><XCircle className="h-4 w-4" />Close Ticket</DropdownMenuItem>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-[#DDE7F0] bg-[#F8FBFE] px-3 py-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#E8EFF7] px-2 py-0.5 text-[10px] font-semibold text-[#5F7288]"><MessageSquare className="h-2.5 w-2.5" />{noteCount}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#E8EFF7] px-2 py-0.5 text-[10px] font-semibold text-[#5F7288]"><Paperclip className="h-2.5 w-2.5" />{ticket.evidenceCount}</span>
          <span className="ml-auto">{statusBadge(ticket.status)}</span>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Add Note Modal ────────────────────────────────────────────────────

function AddNoteModal({ ticket, onClose, onSaved }: { ticket: PRTicket; onClose: () => void; onSaved: () => void; }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    if (!text.trim()) return;
    setSaving(true);
    const newNotes = ticket.notes.trim() ? `${ticket.notes.trim()}\n${text.trim()}` : text.trim();
    await fetch(`/api/pr-tickets/${ticket.id}/`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: newNotes }) });
    setSaving(false); onSaved(); onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-xl border-[#DDE7F0]">
        <DialogHeader><DialogTitle className="text-sm font-semibold text-[#14264A]">Add Note · {ticket.learnerName}</DialogTitle></DialogHeader>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your note here…" className="mt-3 min-h-[100px] rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm" autoFocus />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-lg border-[#DDE7F0]">Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !text.trim()} className="rounded-lg bg-[#14264A] text-white hover:bg-[#184D91]">{saving ? "Saving…" : "Add Note"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────

export default function PRTicketsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tickets, setTickets] = useState<PRTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [ragFilter, setRagFilter] = useState<"all" | PRRisk>("all");
  const [cardFilter, setCardFilter] = useState<"all" | "open" | "resolved">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [createPrefill, setCreatePrefill] = useState<Partial<typeof EMPTY_FORM> | undefined>();
  const [editTicket, setEditTicket] = useState<PRTicket | null>(null);
  const [viewTicket, setViewTicket] = useState<PRTicket | null>(null);
  const [viewFiles, setViewFiles] = useState<EvidenceFile[]>([]);
  const [viewPreview, setViewPreview] = useState<PreviewTarget | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<PRTicket | null>(null);
  const [addNoteTicket, setAddNoteTicket] = useState<PRTicket | null>(null);
  const [quickNotesTicket, setQuickNotesTicket] = useState<PRTicket | null>(null);
  const [quickEvidenceTicket, setQuickEvidenceTicket] = useState<PRTicket | null>(null);
  const [quickEvidenceFiles, setQuickEvidenceFiles] = useState<EvidenceFile[]>([]);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pr-tickets/?archived=${showArchived}`);
      if (res.ok) setTickets(await res.json());
    } finally { setLoading(false); }
  }, [showArchived]);

  useEffect(() => { void loadTickets(); }, [loadTickets]);

  useEffect(() => {
    if (!viewTicket) { setViewFiles([]); return; }
    fetch(`/api/pr-tickets/${viewTicket.id}/files/`)
      .then((r) => r.ok ? r.json() : []).then(setViewFiles).catch(() => setViewFiles([]));
  }, [viewTicket]);

  useEffect(() => {
    if (!quickEvidenceTicket) { setQuickEvidenceFiles([]); return; }
    fetch(`/api/pr-tickets/${quickEvidenceTicket.id}/files/`)
      .then((r) => r.ok ? r.json() : []).then(setQuickEvidenceFiles).catch(() => setQuickEvidenceFiles([]));
  }, [quickEvidenceTicket]);

  useEffect(() => {
    const openId = searchParams.get("open");
    const createFlag = searchParams.get("create");
    if (openId && !loading) {
      const t = tickets.find((t) => String(t.id) === openId);
      if (t) { setViewTicket(t); setSearchParams({}, { replace: true }); }
    } else if (createFlag === "1") {
      setCreatePrefill({
        learnerEmail: searchParams.get("email") ?? "",
        learnerName: searchParams.get("name") ?? "",
        learnerPhone: searchParams.get("phone") ?? "",
        organisation: searchParams.get("organisation") ?? "",
        programme: searchParams.get("programme") ?? searchParams.get("caseOwner") ?? "",
        lastPrDate: searchParams.get("lastPrDate") ?? "",
        nextPrDate: searchParams.get("nextPrDate") ?? "",
        overdueCount: Number(searchParams.get("overdue") ?? 0),
      });
      setCreateOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, tickets, loading, setSearchParams]);

  const uploadFiles = async (ticketId: number, files: File[]) => {
    for (const f of files) {
      const fd = new FormData(); fd.append("file", f);
      await fetch(`/api/pr-tickets/${ticketId}/files/`, { method: "POST", body: fd });
    }
  };

  const handleCreate = async (form: typeof EMPTY_FORM, pendingFiles: File[]) => {
    const res = await fetch("/api/pr-tickets/", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        learner_email: form.learnerEmail, learner_name: form.learnerName,
        learner_phone: form.learnerPhone, organisation: form.organisation,
        programme: form.programme, last_pr_date: form.lastPrDate || null,
        next_pr_date: form.nextPrDate || null, overdue_count: form.overdueCount,
        risk: form.risk, status: form.status, assigned_owner: form.assignedOwner,
        action: form.action === "__none__" ? "" : form.action,
        notes: form.notes, escalated: form.escalated,
      }),
    });
    if (res.ok) { const t = await res.json(); if (pendingFiles.length) await uploadFiles(t.id, pendingFiles); await loadTickets(); }
  };

  const handleEdit = async (form: typeof EMPTY_FORM, pendingFiles: File[]) => {
    if (!editTicket) return;
    const res = await fetch(`/api/pr-tickets/${editTicket.id}/`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        learner_name: form.learnerName, learner_phone: form.learnerPhone,
        organisation: form.organisation, programme: form.programme,
        last_pr_date: form.lastPrDate || null, next_pr_date: form.nextPrDate || null,
        overdue_count: form.overdueCount, risk: form.risk, status: form.status,
        assigned_owner: form.assignedOwner, action: form.action === "__none__" ? "" : form.action,
        notes: form.notes, escalated: form.escalated,
      }),
    });
    if (res.ok) { if (pendingFiles.length) await uploadFiles(editTicket.id, pendingFiles); await loadTickets(); }
  };

  const handleQuickAction = useCallback(async (ticketId: number, updates: Record<string, unknown>) => {
    await fetch(`/api/pr-tickets/${ticketId}/`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) });
    await loadTickets();
  }, [loadTickets]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return tickets.filter((t) => {
      if (q && !t.learnerName.toLowerCase().includes(q) && !t.learnerEmail.toLowerCase().includes(q) && !t.ticketRef.toLowerCase().includes(q)) return false;
      if (ragFilter !== "all" && t.risk !== ragFilter) return false;
      if (cardFilter === "open" && t.status === "resolved") return false;
      if (cardFilter === "resolved" && t.status !== "resolved") return false;
      return true;
    });
  }, [tickets, search, ragFilter, cardFilter]);

  const allCount = tickets.length;
  const openCount = tickets.filter((t) => t.status !== "resolved").length;
  const resolvedCount = tickets.filter((t) => t.status === "resolved").length;
  const escalatedCount = tickets.filter((t) => t.escalated).length;

  const exportCsv = () => {
    const cols = ["Ticket", "Learner", "Email", "Organisation", "Programme", "Risk", "Status", "Owner", "Last PR", "Next PR", "Overdue", "Created"];
    const rows = filtered.map((t) => [t.ticketRef, t.learnerName, t.learnerEmail, t.organisation, t.programme, t.risk, t.status, t.assignedOwner, fmtDate(t.lastPrDate), fmtDate(t.nextPrDate), t.overdueCount, fmtDate(t.createdAt)]);
    const csv = [cols, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "pr-tickets.csv"; a.click();
  };

  return (
    <AppLayout>
      <div className="min-h-full bg-[#F4F8FC]">
        <div className="border-b border-[#DDE7F0] bg-white px-4 pb-5 pt-4 sm:px-6">
          <BackButton to="/progress-review" label="Progress Review" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-[#14264A]">PR Ticket System</h1>
              <p className="mt-0.5 text-sm text-[#5F7288]">Manage progress review support tickets</p>
            </div>
            <Button onClick={() => setCreateOpen(true)} className="h-9 gap-1.5 rounded-lg bg-[#14264A] text-white hover:bg-[#184D91]">
              <Plus className="h-4 w-4" /> Create Ticket
            </Button>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          {/* Controls */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative flex-1" style={{ minWidth: 200 }}>
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8AA0B6]" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tickets, learners, email…" className="h-10 rounded-lg border-[#D7E5F3] bg-white pl-9 text-sm" />
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowArchived((v) => !v)} className={`h-10 gap-1.5 rounded-lg border-[#DDE7F0] ${showArchived ? "bg-[#14264A] text-white" : "bg-white text-[#24486D]"}`}>
              <Archive className="h-4 w-4" />{showArchived ? "Back to Active" : "Archived"}
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} className="h-10 gap-1.5 rounded-lg border-[#DDE7F0] bg-white text-[#24486D]">
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </div>

          {/* Summary cards */}
          <div className="mb-5 grid grid-cols-3 gap-3">
            {([
              { key: "all" as const, label: "All Tickets", sub: "Every case", count: allCount, defaultCls: "border-[#DDE7F0] bg-white text-[#14264A]", activeCls: "border-[#14264A] bg-[#14264A] text-white shadow-md" },
              { key: "open" as const, label: "Open Tickets", sub: "Active cases", count: openCount, defaultCls: "border-green-300 bg-green-50 text-green-900", activeCls: "border-green-600 bg-green-600 text-white shadow-md" },
              { key: "resolved" as const, label: "Resolved", sub: "Resolved cases", count: resolvedCount, defaultCls: "border-[#DDE7F0] bg-white text-[#14264A]", activeCls: "border-violet-600 bg-violet-600 text-white shadow-md" },
            ] as const).map(({ key, label, sub, count, defaultCls, activeCls }) => {
              const isActive = cardFilter === key;
              return (
                <button key={key} onClick={() => setCardFilter(isActive ? "all" : key)} className={`w-full rounded-xl border p-3 text-left transition-all duration-150 hover:shadow-sm active:scale-[0.98] ${isActive ? activeCls : defaultCls}`}>
                  <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 opacity-60" /><span className="text-xs font-semibold">{label}</span></div>
                  <p className="mt-1 text-xs opacity-70">{sub}</p>
                  <p className="mt-1 text-2xl font-bold">{count}</p>
                </button>
              );
            })}
          </div>

          {/* RAG filter */}
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-[#5F7288]">RISK FILTER</span>
            {(["all", "red", "amber", "green"] as const).map((r) => {
              const cnt = r === "all" ? openCount : tickets.filter((t) => t.risk === r && t.status !== "resolved").length;
              const active = ragFilter === r;
              const colors: Record<string, string> = { all: "bg-[#14264A] text-white border-[#14264A]", red: "bg-red-600 text-white border-red-600", amber: "bg-amber-500 text-white border-amber-500", green: "bg-green-600 text-white border-green-600" };
              return <button key={r} onClick={() => setRagFilter(r)} className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition-all ${active ? colors[r] : "border-[#DDE7F0] bg-white text-[#5F7288] hover:bg-[#EEF7FF]"}`}>{r === "all" ? `All ${cnt}` : `${r.charAt(0).toUpperCase() + r.slice(1)} ${cnt}`}</button>;
            })}
            {escalatedCount > 0 && <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">{escalatedCount} Escalated</span>}
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-xl border border-[#DDE7F0] bg-white shadow-sm">
            {loading ? (
              <div className="flex h-40 items-center justify-center text-sm text-[#5F7288]">Loading tickets…</div>
            ) : filtered.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-[#5F7288]"><CheckCircle2 className="h-8 w-8 text-[#C5D5E3]" /><p>No tickets found</p></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#DDE7F0] bg-[#F8FBFE]">
                      <th className="px-3 py-3 text-left text-xs font-semibold text-[#5F7288]">Ticket</th>
                      <th className="sticky left-0 z-20 whitespace-nowrap border-r border-[#DDE7F0] bg-[#F8FBFE] px-3 py-3 text-left text-xs font-semibold text-[#5F7288]">Learner</th>
                      {["Risk", "Status", "Owner", "Last PR", "Next PR", "Overdue", "Days Open", "Notes", "Evidence", "Actions", "Edit", "Archive", "View"].map((h) => (
                        <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-[#5F7288]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t) => (
                      <tr key={t.id} className="group border-b border-[#F0F4F8] transition-colors hover:bg-[#F8FBFE]">
                        <td className="px-3 py-3"><span className="font-mono text-xs font-semibold text-[#1E6ACB]">{t.ticketRef}</span></td>
                        <td className="sticky left-0 z-10 border-r border-[#DDE7F0] bg-white px-3 py-3 group-hover:bg-[#F8FBFE]"><p className="font-semibold text-[#14264A]">{t.learnerName}</p><p className="text-xs text-[#71849A]">{t.learnerEmail}</p></td>
                        <td className="px-3 py-3">{riskBadge(t.risk)}</td>
                        <td className="px-3 py-3">{statusBadge(t.status)}</td>
                        <td className="px-3 py-3 text-xs text-[#5F7288]">{t.assignedOwner || <span className="italic text-[#A0B0C0]">Unassigned</span>}</td>
                        <td className="px-3 py-3 text-xs text-[#5F7288]">{fmtDate(t.lastPrDate)}</td>
                        <td className="px-3 py-3 text-xs font-semibold text-[#14264A]">{fmtDate(t.nextPrDate)}</td>
                        <td className="px-3 py-3">
                          {t.overdueCount > 0 ? <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700"><AlertTriangle className="h-3 w-3" />{t.overdueCount}</span> : <span className="text-xs text-[#A0B0C0]">0</span>}
                        </td>
                        <td className="px-3 py-3 text-xs font-semibold text-[#14264A]">{daysSince(t.createdAt)}</td>
                        <td className="px-3 py-3">
                          {(() => { const count = t.notes.split("\n").filter((l) => l.trim()).length; return count > 0 ? <button onClick={() => setQuickNotesTicket(t)} className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700 hover:bg-green-100"><MessageSquare className="h-3 w-3" />{count}</button> : <span className="text-xs text-[#A0B0C0]">—</span>; })()}
                        </td>
                        <td className="px-3 py-3">
                          {t.evidenceCount > 0 ? <button onClick={() => setQuickEvidenceTicket(t)} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"><Paperclip className="h-3 w-3" />{t.evidenceCount} {t.evidenceCount === 1 ? "file" : "files"}</button> : <span className="text-xs text-[#A0B0C0]">—</span>}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1">
                            {t.escalated && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">Escalated</span>}
                            <PRTicketActionsMenu ticket={t} onAddNote={() => setAddNoteTicket(t)} onQuickAction={handleQuickAction} />
                          </div>
                        </td>
                        <td className="px-3 py-3"><button onClick={() => setEditTicket(t)} className="rounded px-2 py-1 text-xs font-semibold text-[#1E6ACB] hover:bg-[#EEF7FF]">Edit</button></td>
                        <td className="px-3 py-3">
                          <button onClick={async () => { await fetch(`/api/pr-tickets/${t.id}/archive/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archive: !t.isArchived }) }); await loadTickets(); }}
                            className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold ${t.isArchived ? "text-green-700 hover:bg-green-50" : "text-[#5F7288] hover:bg-[#F0F4F8]"}`}>
                            <Archive className="h-3.5 w-3.5" />{t.isArchived ? "Restore" : "Archive"}
                          </button>
                          {t.isArchived && <button onClick={() => setDeleteConfirm(t)} className="mt-1 flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" />Delete</button>}
                        </td>
                        <td className="px-3 py-3"><button onClick={() => setViewTicket(t)} className="rounded px-2 py-1 text-xs font-semibold text-[#1E6ACB] hover:bg-[#EEF7FF]">View</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <PRTicketFormModal open={createOpen} onClose={() => { setCreateOpen(false); setCreatePrefill(undefined); }} onSave={handleCreate} initial={createPrefill} />
      <PRTicketFormModal open={Boolean(editTicket)} onClose={() => setEditTicket(null)} onSave={handleEdit} ticketId={editTicket?.id}
        initial={editTicket ? { learnerEmail: editTicket.learnerEmail, learnerName: editTicket.learnerName, learnerPhone: editTicket.learnerPhone, organisation: editTicket.organisation, programme: editTicket.programme, lastPrDate: editTicket.lastPrDate ?? "", nextPrDate: editTicket.nextPrDate ?? "", overdueCount: editTicket.overdueCount, risk: editTicket.risk, status: editTicket.status, assignedOwner: editTicket.assignedOwner, action: (editTicket.action || "") as PRAction, notes: editTicket.notes, escalated: editTicket.escalated } : undefined} />

      {/* View Modal */}
      <Dialog open={Boolean(viewTicket)} onOpenChange={(o) => !o && setViewTicket(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-xl border-[#DDE7F0]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold text-[#14264A]">
              <span className="font-mono text-[#1E6ACB]">{viewTicket?.ticketRef}</span>
              {viewTicket && riskBadge(viewTicket.risk)}
            </DialogTitle>
          </DialogHeader>
          {viewTicket && (
            <div className="mt-3 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                {[["Learner", viewTicket.learnerName], ["Email", viewTicket.learnerEmail], ["Phone", viewTicket.learnerPhone || "—"], ["Organisation", viewTicket.organisation || "—"], ["Programme", viewTicket.programme || "—"], ["Last PR", fmtDate(viewTicket.lastPrDate)], ["Next PR Due", fmtDate(viewTicket.nextPrDate)], ["Overdue PRs", String(viewTicket.overdueCount)], ["Assigned Owner", viewTicket.assignedOwner || "Unassigned"], ["Action Taken", ACTION_OPTIONS.find((o) => o.value === viewTicket.action)?.label || "—"], ["Created By", `${viewTicket.createdBy} · ${fmtDate(viewTicket.createdAt)}`]].map(([k, v]) => (
                  <div key={k}><p className="text-xs font-semibold text-[#71849A]">{k}</p><p className="mt-0.5 text-sm text-[#14264A]">{v}</p></div>
                ))}
              </div>
              <div className="flex items-center gap-2">{statusBadge(viewTicket.status)}{viewTicket.escalated && <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-700">Escalated</span>}</div>
              {viewTicket.notes && <div><p className="mb-1 text-xs font-semibold text-[#71849A]">Notes</p><p className="whitespace-pre-wrap rounded-lg bg-[#F8FBFE] p-3 text-xs text-[#14264A]">{viewTicket.notes}</p></div>}
              {viewFiles.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold text-[#71849A]">Evidence Files ({viewFiles.length})</p>
                  <div className="space-y-2">
                    {viewFiles.map((f) => (
                      <div key={f.id} className="flex items-center gap-3 rounded-lg border border-[#DDE7F0] bg-white p-2.5">
                        <button type="button" onClick={() => setViewPreview({ url: f.url, name: f.name, mime: f.mimeType })} className="relative shrink-0 overflow-hidden rounded-md">
                          {isImage(f.mimeType, f.name)
                            ? <img src={f.url} alt={f.name} className="h-10 w-10 object-cover" />
                            : <div className="flex h-10 w-10 items-center justify-center bg-[#EEF7FF]"><FileIcon className="h-5 w-5 text-[#1E6ACB]" /></div>}
                        </button>
                        <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-[#14264A]">{f.name}</p><p className="text-[11px] text-[#71849A]">{fmtDate(f.uploadedAt)}</p></div>
                        <button type="button" onClick={() => setViewPreview({ url: f.url, name: f.name, mime: f.mimeType })} className="shrink-0 rounded p-1 text-[#1E6ACB] hover:bg-[#EEF7FF]"><Eye className="h-4 w-4" /></button>
                        <a href={f.url} target="_blank" rel="noreferrer" className="shrink-0 rounded p-1 text-[#1E6ACB] hover:bg-[#EEF7FF]"><Download className="h-4 w-4" /></a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <FilePreviewModal target={viewPreview} onClose={() => setViewPreview(null)} />

      {addNoteTicket && <AddNoteModal ticket={addNoteTicket} onClose={() => setAddNoteTicket(null)} onSaved={loadTickets} />}

      {/* Quick Notes Modal */}
      <Dialog open={Boolean(quickNotesTicket)} onOpenChange={(o) => !o && setQuickNotesTicket(null)}>
        <DialogContent className="max-w-md rounded-xl border-[#DDE7F0]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-[#14264A]">
              <MessageSquare className="h-4 w-4 text-green-600" />
              Notes · {quickNotesTicket?.learnerName}
              <span className="ml-1 font-mono text-xs text-[#71849A]">{quickNotesTicket?.ticketRef}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2 max-h-[60vh] overflow-y-auto">
            {quickNotesTicket?.notes
              ? <p className="whitespace-pre-wrap rounded-lg bg-[#F8FBFE] p-3 text-xs text-[#14264A]">{quickNotesTicket.notes}</p>
              : <p className="text-xs text-[#A0B0C0]">No notes yet.</p>}
          </div>
        </DialogContent>
      </Dialog>

      {/* Quick Evidence Modal */}
      <Dialog open={Boolean(quickEvidenceTicket)} onOpenChange={(o) => !o && setQuickEvidenceTicket(null)}>
        <DialogContent className="max-w-lg rounded-xl border-[#DDE7F0]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-[#14264A]">
              <Paperclip className="h-4 w-4 text-[#1E6ACB]" />
              Evidence · {quickEvidenceTicket?.learnerName}
              <span className="ml-1 font-mono text-xs text-[#71849A]">{quickEvidenceTicket?.ticketRef}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2 max-h-[60vh] space-y-2 overflow-y-auto">
            {quickEvidenceFiles.length === 0
              ? <p className="text-xs text-[#A0B0C0]">No files uploaded.</p>
              : quickEvidenceFiles.map((f) => (
                <div key={f.id} className="flex items-center gap-3 rounded-lg border border-[#DDE7F0] bg-white p-2.5">
                  <div className="shrink-0">
                    {isImage(f.mimeType, f.name)
                      ? <img src={f.url} alt={f.name} className="h-10 w-10 rounded-md object-cover" />
                      : <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#EEF7FF]"><FileIcon className="h-5 w-5 text-[#1E6ACB]" /></div>}
                  </div>
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-[#14264A]">{f.name}</p><p className="text-[11px] text-[#71849A]">{fmtDate(f.uploadedAt)}</p></div>
                  <a href={f.url} target="_blank" rel="noreferrer" className="shrink-0 rounded p-1 text-[#1E6ACB] hover:bg-[#EEF7FF]"><Eye className="h-4 w-4" /></a>
                  <a href={f.url} download={f.name} className="shrink-0 rounded p-1 text-[#1E6ACB] hover:bg-[#EEF7FF]"><Download className="h-4 w-4" /></a>
                </div>
              ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteConfirm)} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm rounded-xl border-[#DDE7F0]">
          <DialogHeader><DialogTitle className="text-base font-semibold text-[#14264A]">Permanently Delete Ticket?</DialogTitle></DialogHeader>
          <p className="mt-2 text-sm text-[#5F7288]">This will permanently delete <strong>{deleteConfirm?.ticketRef}</strong> and all attached files.</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)} className="rounded-lg">Cancel</Button>
            <Button onClick={async () => { if (!deleteConfirm) return; await fetch(`/api/pr-tickets/${deleteConfirm.id}/`, { method: "DELETE" }); setDeleteConfirm(null); await loadTickets(); }} className="rounded-lg bg-red-600 text-white hover:bg-red-700">
              <Trash2 className="mr-1.5 h-4 w-4" />Delete Permanently
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
