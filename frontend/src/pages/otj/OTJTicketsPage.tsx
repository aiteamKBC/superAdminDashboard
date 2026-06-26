import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, Archive, BriefcaseBusiness, CheckCircle2,
  Clock, Download, Eye, File as FileIcon, FileText, Flag,
  Image as ImageIcon, Info, Mail, MessageSquare, MoreHorizontal, Paperclip, Plus,
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// ─── Types ────────────────────────────────────────────────────────────

type OTJRisk = "red" | "amber" | "green";
type OTJStatus = "new" | "open" | "hours_logged" | "support_plan_active" | "resolved";
type OTJAction = "" | "called" | "emailed" | "hours_submitted" | "extra_hours_planned" | "referred_support" | "no_action";

interface EvidenceFile { id: number; name: string; url: string; mimeType: string; uploadedAt: string; }

interface OTJTicket {
  id: number; ticketRef: string; learnerEmail: string; learnerName: string;
  learnerPhone: string; organisation: string; programme: string;
  otjMinimum: number; otjCompleted: number; otjExpected: number; otjStatus: string;
  risk: OTJRisk; status: OTJStatus; assignedOwner: string; action: string;
  notes: string; evidenceCount: number; isArchived: boolean; escalated: boolean;
  createdBy: string; createdAt: string; updatedAt: string;
}

const ACTION_OPTIONS: { value: OTJAction; label: string }[] = [
  { value: "", label: "— No action selected —" },
  { value: "called", label: "Called" },
  { value: "emailed", label: "Emailed" },
  { value: "hours_submitted", label: "Hours Submitted" },
  { value: "extra_hours_planned", label: "Extra Hours Planned" },
  { value: "referred_support", label: "Referred to Support" },
  { value: "no_action", label: "No Action Required" },
];

const EMPTY_FORM = {
  learnerEmail: "", learnerName: "", learnerPhone: "", organisation: "",
  programme: "", otjMinimum: 0, otjCompleted: 0, otjExpected: 0, otjStatus: "",
  risk: "amber" as OTJRisk, status: "new" as OTJStatus, assignedOwner: "",
  action: "" as OTJAction, notes: "", escalated: false,
};

const DaysCreatedHeader = ({ label = "Days Open" }: { label?: string }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="inline-flex cursor-help items-center gap-1">
        {label}
        <Info className="h-3.5 w-3.5 text-[#8A4DFF]" />
      </span>
    </TooltipTrigger>
    <TooltipContent side="top" align="center" sideOffset={12} className="w-64 whitespace-normal rounded-lg border border-[#1F2937] bg-[#111827] px-3 py-2 text-left text-xs font-semibold leading-relaxed text-white shadow-none">
      Number of days this ticket has been open since it was created.
    </TooltipContent>
  </Tooltip>
);

// ─── Visual helpers ────────────────────────────────────────────────────

const riskBadge = (risk: OTJRisk) => {
  const s: Record<OTJRisk, string> = { red: "bg-red-100 text-red-700 border-red-200", amber: "bg-amber-100 text-amber-700 border-amber-200", green: "bg-green-100 text-green-700 border-green-200" };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${s[risk]}`}>{risk}</span>;
};

const statusBadge = (status: OTJStatus) => {
  const map: Record<OTJStatus, { label: string; cls: string }> = {
    new: { label: "New", cls: "bg-slate-100 text-slate-700 border-slate-200" },
    open: { label: "Open", cls: "bg-blue-100 text-blue-700 border-blue-200" },
    hours_logged: { label: "Hours Logged", cls: "bg-teal-100 text-teal-700 border-teal-200" },
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
const fmtHours = (h: number | null) => (h != null ? `${h.toFixed(1)}h` : "—");
const fmtHoursMin = (h: number | null) => {
  if (h == null || h <= 0) return "—";
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return `${hrs}h ${mins}m`;
};
const reqToSubmitHours = (expected: number, completed: number) => Math.max(0, expected - completed);
const ticketRefNumber = (ref: string) => {
  const match = String(ref || "").match(/(\d+)$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
};
const isImage = (mime: string, name: string) => mime.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(name);
const isPdf = (mime: string, name: string) => mime === "application/pdf" || /\.pdf$/i.test(name);
const isHtml = (mime: string, name: string) => mime === "text/html" || /\.html?$/i.test(name);
const isText = (mime: string, name: string) => (mime.startsWith("text/") && !isHtml(mime, name)) || /\.(csv|txt|log)$/i.test(name);
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
  const html = isHtml(target.mime, target.name);
  const csv = isCsv(target.mime, target.name);
  const txt = isText(target.mime, target.name) && !csv;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-[#DDE7F0] px-4 py-3">
          {img ? <ImageIcon className="h-4 w-4 shrink-0 text-[#24557F]" /> : <FileIcon className="h-4 w-4 shrink-0 text-[#24557F]" />}
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#14264A]">{target.name}</span>
          <a href={target.url} download={target.name} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg p-1.5 text-[#24557F] hover:bg-[#EEF7FF]"><Download className="h-4 w-4" /></a>
          <button onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-[#71849A] hover:bg-[#F0F4F8]"><X className="h-4 w-4" /></button>
        </div>
        <div className={`flex-1 overflow-auto bg-[#F4F8FC] ${img ? "flex items-center justify-center p-4" : "p-4"}`}>
          {img && <img src={target.url} alt={target.name} className="max-h-[75vh] max-w-full rounded-lg object-contain shadow-md" />}
          {pdf && <iframe src={target.url} title={target.name} className="h-[72vh] w-full rounded-lg border border-[#DDE7F0]" />}
          {html && <iframe src={target.url} title={target.name} className="h-[72vh] w-full rounded-lg border border-[#DDE7F0] bg-white" sandbox="allow-same-origin" />}
          {csv && (textLoading ? <div className="flex h-40 items-center justify-center text-sm text-[#71849A]">Loading…</div> : csvRows ? (
            <div className="overflow-auto rounded-xl border border-[#DDE7F0] bg-white">
              <table className="min-w-full text-xs">
                <thead><tr className="border-b border-[#DDE7F0] bg-[#F0F6FF]">{csvRows[0].map((c, i) => <th key={i} className="px-3 py-2 text-left font-semibold text-[#14264A]">{c}</th>)}</tr></thead>
                <tbody>{csvRows.slice(1).map((row, ri) => <tr key={ri} className={ri % 2 === 0 ? "bg-white" : "bg-[#F9FBFD]"}>{row.map((c, ci) => <td key={ci} className="px-3 py-2 text-[#3A506B]">{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          ) : <p className="text-sm text-[#A0B0C0]">Could not load CSV.</p>)}
          {txt && (textLoading ? <div className="flex h-40 items-center justify-center text-sm text-[#71849A]">Loading…</div> : textContent ? <pre className="max-h-[72vh] overflow-auto whitespace-pre-wrap rounded-xl border border-[#DDE7F0] bg-white p-4 font-mono text-xs text-[#14264A]">{textContent}</pre> : <p className="text-sm text-[#A0B0C0]">Could not load file.</p>)}
          {!img && !pdf && !html && !csv && !txt && (
            <div className="flex flex-col items-center gap-4 py-10">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[#EEF7FF]"><FileIcon className="h-10 w-10 text-[#24557F]" /></div>
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
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 transition-colors ${dragging ? "border-[#24557F] bg-[#EEF7FF]" : "border-[#D7E5F3] bg-[#F8FBFE] hover:border-[#24557F] hover:bg-[#EEF7FF]"}`}>
          <UploadCloud className={`h-8 w-8 ${dragging ? "text-[#24557F]" : "text-[#A0B8D0]"}`} />
          <p className="text-sm font-semibold text-[#14264A]">{uploading ? "Uploading…" : "Click to upload or drag & drop"}</p>
          <input ref={inputRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" onChange={(e) => { const f = Array.from(e.target.files || []); if (f.length) onAddPending(f); e.target.value = ""; }} className="hidden" />
        </div>
        {totalCount > 0 && (
          <div className="space-y-2">
            {existingFiles.map((f) => (
              <div key={f.id} className="group flex items-center gap-3 rounded-lg border border-[#DDE7F0] bg-white p-2.5">
                <button type="button" onClick={() => setPreview({ url: f.url, name: f.name, mime: f.mimeType, revoke: false })} className="relative shrink-0 overflow-hidden rounded-md">
                  {isImage(f.mimeType, f.name) ? <img src={f.url} alt={f.name} className="h-10 w-10 object-cover" /> : <div className="flex h-10 w-10 items-center justify-center bg-[#EEF7FF]"><FileIcon className="h-5 w-5 text-[#24557F]" /></div>}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100"><ZoomIn className="h-4 w-4 text-white" /></div>
                </button>
                <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-[#14264A]">{f.name}</p><p className="text-[11px] text-[#71849A]">{fmtDate(f.uploadedAt)}</p></div>
                <button type="button" onClick={() => setPreview({ url: f.url, name: f.name, mime: f.mimeType, revoke: false })} className="shrink-0 rounded p-1 text-[#24557F] hover:bg-[#EEF7FF]"><Eye className="h-4 w-4" /></button>
                <a href={f.url} target="_blank" rel="noreferrer" className="shrink-0 rounded p-1 text-[#24557F] hover:bg-[#EEF7FF]"><Download className="h-4 w-4" /></a>
                <button type="button" onClick={() => onDeleteExisting(f.id)} className="shrink-0 rounded p-1 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            {pendingFiles.map((f, i) => (
              <div key={`p-${i}`} className="group flex items-center gap-3 rounded-lg border border-dashed border-[#B8D7F2] bg-[#F0F8FF] p-2.5">
                <button type="button" onClick={() => { const url = URL.createObjectURL(f); setPreview({ url, name: f.name, mime: f.type || "", size: f.size, revoke: true }); }} className="relative shrink-0 overflow-hidden rounded-md">
                  {f.type.startsWith("image/") ? <img src={URL.createObjectURL(f)} alt={f.name} className="h-10 w-10 object-cover" /> : <div className="flex h-10 w-10 items-center justify-center bg-[#EEF7FF]"><FileIcon className="h-5 w-5 text-[#24557F]" /></div>}
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

function OTJTicketFormModal({ open, onClose, onSave, initial, ticketId }: { open: boolean; onClose: () => void; onSave: (data: typeof EMPTY_FORM, files: File[]) => Promise<void>; initial?: Partial<typeof EMPTY_FORM>; ticketId?: number; }) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initial });
  const [saving, setSaving] = useState(false);
  const [existingFiles, setExistingFiles] = useState<EvidenceFile[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  useEffect(() => { if (open) { setForm({ ...EMPTY_FORM, ...initial }); setPendingFiles([]); } }, [open]);
  useEffect(() => {
    if (open && ticketId) {
      fetch(`/api/otj-tickets/${ticketId}/files/`).then((r) => r.ok ? r.json() : []).then(setExistingFiles).catch(() => setExistingFiles([]));
    } else { setExistingFiles([]); }
  }, [open, ticketId]);

  const set = (k: keyof typeof EMPTY_FORM, v: string | boolean | number) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-xl border-[#DDE7F0]">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-[#14264A]">{ticketId ? "Edit OTJH Ticket" : "Create OTJH Ticket"}</DialogTitle>
        </DialogHeader>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {([["learnerEmail", "Learner Email *", "learner@example.com"], ["learnerName", "Learner Name *", "Full name"], ["learnerPhone", "Phone", "07700 000000"], ["organisation", "Organisation", "Organisation name"], ["programme", "Programme", "e.g. Team Leader"], ["assignedOwner", "Assigned Owner", "Coach or staff name"]] as const).map(([key, label, placeholder]) => (
            <div key={key} className="space-y-1.5">
              <Label className="text-xs font-semibold text-[#24486D]">{label}</Label>
              <Input value={form[key] as string} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} className="h-10 rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm" disabled={key === "learnerEmail" && !!ticketId} />
            </div>
          ))}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-[#24486D]">Completed Hours</Label>
            <Input type="number" min={0} step={0.5} value={form.otjCompleted} onChange={(e) => set("otjCompleted", Number(e.target.value))} className="h-10 rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-[#24486D]">Target Now</Label>
            <Input type="number" min={0} step={0.5} value={form.otjExpected} onChange={(e) => set("otjExpected", Number(e.target.value))} className="h-10 rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-[#24486D]">OTJH Status</Label>
            <Input value={form.otjStatus} onChange={(e) => set("otjStatus", e.target.value)} placeholder="e.g. at risk, on track" className="h-10 rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-[#24486D]">Risk Level</Label>
            <Select value={form.risk} onValueChange={(v) => set("risk", v as OTJRisk)}>
              <SelectTrigger className="h-10 rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="green">Green</SelectItem><SelectItem value="amber">Amber</SelectItem><SelectItem value="red">Red</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-[#24486D]">Status</Label>
            <Select value={form.status} onValueChange={(v) => set("status", v as OTJStatus)}>
              <SelectTrigger className="h-10 rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="hours_logged">Hours Logged</SelectItem>
                <SelectItem value="support_plan_active">Support Plan Active</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs font-semibold text-[#24486D]">Action Taken</Label>
            <Select value={form.action} onValueChange={(v) => set("action", v as OTJAction)}>
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
              onDeleteExisting={async (id) => { await fetch(`/api/otj-tickets/${ticketId}/files/${id}/`, { method: "DELETE" }); setExistingFiles((p) => p.filter((f) => f.id !== id)); }} />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" id="otj-escalated" checked={form.escalated} onChange={(e) => set("escalated", e.target.checked)} className="h-4 w-4 rounded border-[#D7E5F3] accent-[#14264A]" />
            <label htmlFor="otj-escalated" className="text-sm font-medium text-[#14264A]">Mark as Escalated</label>
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

// ─── Actions Menu ──────────────────────────────────────────────────────

function OTJTicketActionsMenu({ ticket, onAddNote, onAddEvidence, onEmail, onQuickAction }: { ticket: OTJTicket; onAddNote: () => void; onAddEvidence: () => void; onEmail: () => void; onQuickAction: (id: number, updates: Record<string, unknown>) => Promise<void>; }) {
  const noteCount = ticket.notes.split("\n").filter((l) => l.trim()).length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-lg p-1.5 text-[#71849A] hover:bg-[#F0F4F8] focus:outline-none"><MoreHorizontal className="h-4 w-4" /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 overflow-hidden rounded-xl border-[#DDE7F0] p-0 shadow-xl" style={{ maxHeight: "min(80vh, 480px)" }}>
        <div className="border-b border-[#DDE7F0] bg-[#F8FBFE] px-3 py-2">
          <p className="text-[11px] font-bold text-[#14264A]">Ticket Actions</p>
          <p className="truncate text-[10px] text-[#71849A]">{ticket.ticketRef} · {ticket.learnerName}</p>
        </div>
        <div className="overflow-y-auto" style={{ maxHeight: "calc(min(80vh, 480px) - 88px)" }}>
          <div className="space-y-0.5 p-1.5">
            <p className="px-2 pb-0.5 pt-1 text-[10px] font-bold uppercase tracking-wide text-[#A0B0C0]">Notes</p>
            <DropdownMenuItem onClick={onAddNote} className="cursor-pointer gap-2 rounded-lg text-[#14264A] hover:bg-[#F0F4F8]"><FileText className="h-4 w-4 text-[#5F7288]" />Add Note</DropdownMenuItem>
            <DropdownMenuItem onClick={onAddEvidence} className="cursor-pointer gap-2 rounded-lg text-[#14264A] hover:bg-[#F0F4F8]"><Paperclip className="h-4 w-4 text-[#24557F]" />Add Evidence</DropdownMenuItem>
            <DropdownMenuSeparator className="my-1 bg-[#EEF3F8]" />
            <p className="px-2 pb-0.5 pt-1 text-[10px] font-bold uppercase tracking-wide text-[#A0B0C0]">Hours</p>
            <DropdownMenuItem onClick={() => onQuickAction(ticket.id, { status: "hours_logged" })} className="cursor-pointer gap-2 rounded-lg text-[#14264A] hover:bg-[#F0F4F8]"><Clock className="h-4 w-4 text-teal-600" />Mark Hours Logged</DropdownMenuItem>
            <DropdownMenuSeparator className="my-1 bg-[#EEF3F8]" />
            <p className="px-2 pb-0.5 pt-1 text-[10px] font-bold uppercase tracking-wide text-[#A0B0C0]">Status</p>
            <DropdownMenuItem onClick={() => onQuickAction(ticket.id, { escalated: true, risk: "red" })} className="cursor-pointer gap-2 rounded-lg text-[#14264A] hover:bg-[#F0F4F8]"><Flag className="h-4 w-4 text-amber-500" />Flag for Attention</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onQuickAction(ticket.id, { status: "open", escalated: false })} className="cursor-pointer gap-2 rounded-lg text-[#14264A] hover:bg-[#F0F4F8]"><RefreshCw className="h-4 w-4 text-green-600" />Reopen / Set Active</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onQuickAction(ticket.id, { status: "resolved" })} className="cursor-pointer gap-2 rounded-lg text-red-600 hover:bg-red-50 focus:bg-red-50 focus:text-red-600"><XCircle className="h-4 w-4" />Close Ticket</DropdownMenuItem>
            <DropdownMenuSeparator className="my-1 bg-[#EEF3F8]" />
            <p className="px-2 pb-0.5 pt-1 text-[10px] font-bold uppercase tracking-wide text-[#A0B0C0]">Action Taken</p>
            {ACTION_OPTIONS.filter((o) => o.value !== "").map((o) => {
              const isEmailed = o.value === "emailed";
              const isActive = ticket.action === o.value;
              return (
                <DropdownMenuItem key={o.value}
                  onClick={() => isEmailed ? onEmail() : onQuickAction(ticket.id, { action: o.value })}
                  className={`cursor-pointer gap-2 rounded-lg hover:bg-[#F0F4F8] ${isActive ? "bg-[#EEF7FF] font-semibold text-[#24557F]" : "text-[#14264A]"}`}>
                  {isEmailed
                    ? <Mail className={`h-4 w-4 shrink-0 ${isActive ? "text-[#24557F]" : "text-[#5F7288]"}`} />
                    : <CheckCircle2 className={`h-4 w-4 shrink-0 ${isActive ? "text-[#24557F]" : "text-[#C5D5E3]"}`} />}
                  {o.label}
                  {isEmailed && <span className="ml-auto text-[10px] text-[#A0B0C0]">→ Email Centre</span>}
                </DropdownMenuItem>
              );
            })}
          </div>
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

function AddNoteModal({ ticket, onClose, onSaved }: { ticket: OTJTicket; onClose: () => void; onSaved: () => void; }) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    if (!text.trim()) return;
    setSaving(true);
    const newNotes = ticket.notes.trim() ? `${ticket.notes.trim()}\n${text.trim()}` : text.trim();
    const assignedOwner = user?.fullName || user?.email || ticket.assignedOwner;
    await fetch(`/api/otj-tickets/${ticket.id}/`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: newNotes, assigned_owner: assignedOwner }) });
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

// ─── Add Evidence Modal ────────────────────────────────────────────────

function AddEvidenceModal({ ticket, onClose, onSaved }: { ticket: OTJTicket; onClose: () => void; onSaved: () => void; }) {
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [existingFiles, setExistingFiles] = useState<EvidenceFile[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetch(`/api/otj-tickets/${ticket.id}/files/`)
      .then((r) => (r.ok ? r.json() : [])).then(setExistingFiles).catch(() => setExistingFiles([]));
  }, [ticket.id]);

  const handleUpload = async () => {
    if (pendingFiles.length === 0) { onClose(); return; }
    setUploading(true);
    for (const f of pendingFiles) {
      const fd = new FormData(); fd.append("file", f);
      await fetch(`/api/otj-tickets/${ticket.id}/files/`, { method: "POST", body: fd });
    }
    setUploading(false);
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-xl border-[#DDE7F0]">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-[#14264A]">Add Evidence · {ticket.learnerName}</DialogTitle>
        </DialogHeader>
        <div className="mt-3">
          <EvidenceUploadZone
            ticketId={ticket.id}
            existingFiles={existingFiles}
            pendingFiles={pendingFiles}
            onAddPending={(f) => setPendingFiles((p) => [...p, ...f])}
            onRemovePending={(i) => setPendingFiles((p) => p.filter((_, idx) => idx !== i))}
            onDeleteExisting={async (id) => {
              await fetch(`/api/otj-tickets/${ticket.id}/files/${id}/`, { method: "DELETE" });
              setExistingFiles((p) => p.filter((f) => f.id !== id));
            }}
            uploading={uploading}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-lg border-[#DDE7F0]">Cancel</Button>
          <Button onClick={handleUpload} disabled={uploading || pendingFiles.length === 0}
            className="rounded-lg bg-[#14264A] text-white hover:bg-[#184D91]">
            {uploading ? "Uploading…" : pendingFiles.length > 0 ? `Upload (${pendingFiles.length})` : "Upload"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────

export default function OTJTicketsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tickets, setTickets] = useState<OTJTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [ragFilter, setRagFilter] = useState<"all" | OTJRisk>("all");
  const [cardFilter, setCardFilter] = useState<"all" | "open" | "resolved">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [createPrefill, setCreatePrefill] = useState<Partial<typeof EMPTY_FORM> | undefined>();
  const [editTicket, setEditTicket] = useState<OTJTicket | null>(null);
  const [viewTicket, setViewTicket] = useState<OTJTicket | null>(null);
  const [viewFiles, setViewFiles] = useState<EvidenceFile[]>([]);
  const [viewPreview, setViewPreview] = useState<PreviewTarget | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<OTJTicket | null>(null);
  const [addNoteTicket, setAddNoteTicket] = useState<OTJTicket | null>(null);
  const [addEvidenceTicket, setAddEvidenceTicket] = useState<OTJTicket | null>(null);
  const [pendingEvidenceId, setPendingEvidenceId] = useState<number | null>(null);
  const [quickNotesTicket, setQuickNotesTicket] = useState<OTJTicket | null>(null);
  const [quickEvidenceTicket, setQuickEvidenceTicket] = useState<OTJTicket | null>(null);
  const [quickEvidenceFiles, setQuickEvidenceFiles] = useState<EvidenceFile[]>([]);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/otj-tickets/?archived=${showArchived}`);
      if (res.ok) setTickets(await res.json());
    } finally { setLoading(false); }
  }, [showArchived]);

  useEffect(() => { void loadTickets(); }, [loadTickets]);

  useEffect(() => {
    if (!viewTicket) { setViewFiles([]); return; }
    fetch(`/api/otj-tickets/${viewTicket.id}/files/`)
      .then((r) => r.ok ? r.json() : []).then(setViewFiles).catch(() => setViewFiles([]));
  }, [viewTicket]);

  useEffect(() => {
    if (!quickEvidenceTicket) { setQuickEvidenceFiles([]); return; }
    fetch(`/api/otj-tickets/${quickEvidenceTicket.id}/files/`)
      .then((r) => r.ok ? r.json() : []).then(setQuickEvidenceFiles).catch(() => setQuickEvidenceFiles([]));
  }, [quickEvidenceTicket]);

  useEffect(() => {
    const openId = searchParams.get("ticket") || searchParams.get("open");
    const createFlag = searchParams.get("create");
    if (openId && !loading) {
      const t = tickets.find((t) => String(t.id) === openId);
      if (t) {
        setSearch(t.learnerEmail);
        setSearchParams({}, { replace: true });
      }
    } else if (createFlag === "1") {
      setCreatePrefill({
        learnerEmail: searchParams.get("email") ?? "",
        learnerName: searchParams.get("name") ?? "",
        learnerPhone: searchParams.get("phone") ?? "",
        organisation: searchParams.get("organisation") ?? "",
        programme: searchParams.get("programme") ?? "",
        otjMinimum: Number(searchParams.get("otj_minimum") ?? 0),
        otjCompleted: Number(searchParams.get("otj_completed") ?? 0),
        otjExpected: Number(searchParams.get("otj_expected") ?? 0),
        otjStatus: searchParams.get("otj_status") ?? "",
        assignedOwner: searchParams.get("assigned_owner") ?? "",
      });
      setCreateOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, tickets, loading, setSearchParams]);

  useEffect(() => {
    const emailedId = searchParams.get("emailed_ticket");
    if (emailedId && !loading) {
      const ticketId = Number(emailedId);
      const ticket = tickets.find((t) => t.id === ticketId);
      const dateStr = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      const byLine = user?.fullName || user?.email || "";
      const noteEntry = `Email sent on ${dateStr}${byLine ? ` by ${byLine}` : ""}`;
      const existingNotes = ticket?.notes?.trim() || "";
      const newNotes = existingNotes ? `${existingNotes}\n${noteEntry}` : noteEntry;
      fetch(`/api/otj-tickets/${ticketId}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "emailed", notes: newNotes }),
      }).then(() => loadTickets());
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, loading, tickets, user]);

  const handleEmailTicket = useCallback((ticket: OTJTicket) => {
    navigate("/email-centre", {
      state: {
        selectedRecipient: {
          learnerName: ticket.learnerName,
          learnerEmail: ticket.learnerEmail,
          programme: ticket.programme || "",
          coachName: ticket.assignedOwner || "",
          coachEmail: "",
          status: "Active",
          riskCategories: ["otj-behind"],
          expectedHours: String(Math.round(ticket.otjExpected ?? 0)),
          actualHours: String(Math.round(ticket.otjCompleted ?? 0)),
        },
        source: "otj-ticket",
        ticketId: ticket.id,
      },
    });
  }, [navigate]);

  const uploadFiles = async (ticketId: number, files: File[]) => {
    for (const f of files) {
      const fd = new FormData(); fd.append("file", f);
      await fetch(`/api/otj-tickets/${ticketId}/files/`, { method: "POST", body: fd });
    }
  };

  const handleCreate = async (form: typeof EMPTY_FORM, pendingFiles: File[]) => {
    const res = await fetch("/api/otj-tickets/", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        learner_email: form.learnerEmail, learner_name: form.learnerName,
        learner_phone: form.learnerPhone, organisation: form.organisation,
        programme: form.programme, otj_minimum: form.otjMinimum,
        otj_completed: form.otjCompleted, otj_expected: form.otjExpected,
        otj_status: form.otjStatus, risk: form.risk, status: form.status,
        assigned_owner: form.assignedOwner,
        action: form.action === "__none__" ? "" : form.action,
        notes: form.notes, escalated: form.escalated,
      }),
    });
    if (res.ok) { const t = await res.json(); if (pendingFiles.length) await uploadFiles(t.id, pendingFiles); await loadTickets(); }
  };

  const handleEdit = async (form: typeof EMPTY_FORM, pendingFiles: File[]) => {
    if (!editTicket) return;
    const res = await fetch(`/api/otj-tickets/${editTicket.id}/`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        learner_name: form.learnerName, learner_phone: form.learnerPhone,
        organisation: form.organisation, programme: form.programme,
        otj_minimum: form.otjMinimum, otj_completed: form.otjCompleted,
        otj_expected: form.otjExpected, otj_status: form.otjStatus,
        risk: form.risk, status: form.status,
        assigned_owner: user?.fullName || user?.email || form.assignedOwner,
        action: form.action === "__none__" ? "" : form.action,
        notes: form.notes, escalated: form.escalated,
      }),
    });
    if (res.ok) { if (pendingFiles.length) await uploadFiles(editTicket.id, pendingFiles); await loadTickets(); }
  };

  const handleQuickAction = useCallback(async (ticketId: number, updates: Record<string, unknown>) => {
    await fetch(`/api/otj-tickets/${ticketId}/`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) });
    await loadTickets();
  }, [loadTickets]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return tickets
      .filter((t) => {
        if (q && !t.learnerName.toLowerCase().includes(q) && !t.learnerEmail.toLowerCase().includes(q) && !t.ticketRef.toLowerCase().includes(q)) return false;
        if (ragFilter !== "all" && t.risk !== ragFilter) return false;
        if (cardFilter === "open" && t.status === "resolved") return false;
        if (cardFilter === "resolved" && t.status !== "resolved") return false;
        return true;
      })
      .sort((a, b) => ticketRefNumber(b.ticketRef) - ticketRefNumber(a.ticketRef));
  }, [tickets, search, ragFilter, cardFilter]);

  const allCount = tickets.length;
  const openCount = tickets.filter((t) => t.status !== "resolved").length;
  const resolvedCount = tickets.filter((t) => t.status === "resolved").length;
  const escalatedCount = tickets.filter((t) => t.escalated).length;

  const exportCsv = () => {
    const cols = ["Ticket", "Learner", "Email", "Organisation", "Programme", "Risk", "Status", "Owner", "Completed", "Target Now", "Req. to Submit", "Created"];
    const rows = filtered.map((t) => [t.ticketRef, t.learnerName, t.learnerEmail, t.organisation, t.programme, t.risk, t.status, t.assignedOwner, fmtHoursMin(t.otjCompleted), fmtHoursMin(t.otjExpected), fmtHoursMin(reqToSubmitHours(t.otjExpected, t.otjCompleted)), fmtDate(t.createdAt)]);
    const csv = [cols, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "otjh-tickets.csv"; a.click();
  };

  return (
    <AppLayout>
      <div className="min-h-full bg-[#F4F8FC]">
        <div className="border-b border-[#DDE7F0] bg-white px-4 pb-5 pt-4 sm:px-6">
          <BackButton to="/otj-hours" label="OTJH" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-[#14264A]">OTJH Ticket System</h1>
              <p className="mt-0.5 text-sm text-[#5F7288]">Manage off-the-job hours support tickets</p>
            </div>
            <Button onClick={() => setCreateOpen(true)} className="h-9 gap-1.5 rounded-lg bg-[#24557F] text-white hover:bg-[#1B466B]">
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
              { key: "all" as const, label: "All Tickets", sub: "Every case", count: allCount, defaultCls: "border-[#DDE7F0] bg-white text-[#14264A]", activeCls: "border-[#24557F] bg-[#24557F] text-white shadow-md" },
              { key: "open" as const, label: "Open Tickets", sub: "Active cases", count: openCount, defaultCls: "border-[#C7DCEB] bg-[#F1F7FB] text-[#24557F]", activeCls: "border-[#24557F] bg-[#24557F] text-white shadow-md" },
              { key: "resolved" as const, label: "Resolved", sub: "Resolved cases", count: resolvedCount, defaultCls: "border-[#DDE7F0] bg-white text-[#14264A]", activeCls: "border-[#315D93] bg-[#315D93] text-white shadow-md" },
            ] as const).map(({ key, label, sub, count, defaultCls, activeCls }) => {
              const isActive = cardFilter === key;
              return (
                <button key={key} onClick={() => setCardFilter(isActive ? "all" : key)} className={`w-full rounded-xl border p-3 text-left transition-all duration-150 hover:shadow-sm active:scale-[0.98] ${isActive ? activeCls : defaultCls}`}>
                  <div className="flex items-center gap-2"><BriefcaseBusiness className="h-4 w-4 opacity-60" /><span className="text-xs font-semibold">{label}</span></div>
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
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-[#5F7288]"><BriefcaseBusiness className="h-8 w-8 text-[#C5D5E3]" /><p>No tickets found</p></div>
            ) : (
              <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 320px)" }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#DDE7F0] bg-[#F8FBFE]">
                      <th className="sticky top-0 z-10 whitespace-nowrap bg-[#F8FBFE] px-3 py-3 text-left text-xs font-semibold text-[#5F7288]">Ticket</th>
                      <th className="sticky left-0 top-0 z-30 whitespace-nowrap border-r border-[#DDE7F0] bg-[#F8FBFE] px-3 py-3 text-left text-xs font-semibold text-[#5F7288]">Learner</th>
                      {["Risk", "Status", "Assigned Owner", "Completed", "Target Now", "Req. to Submit", "Days Open", "Notes", "Evidence", "Actions", "Edit", "Archive", "View"].map((h) => (
                        <th key={h} className="sticky top-0 z-10 whitespace-nowrap bg-[#F8FBFE] px-3 py-3 text-left text-xs font-semibold text-[#5F7288]">
                          {h === "Days Open" ? <DaysCreatedHeader /> : h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t) => (
                      <tr key={t.id} className="group border-b border-[#F0F4F8] transition-colors hover:bg-[#F8FBFE]">
                        <td className="px-3 py-3"><span className="font-mono text-xs font-semibold text-[#24557F]">{t.ticketRef}</span></td>
                        <td className="sticky left-0 z-10 border-r border-[#DDE7F0] bg-white px-3 py-3 group-hover:bg-[#F8FBFE]"><p className="font-semibold text-[#14264A]">{t.learnerName}</p><p className="text-xs text-[#71849A]">{t.learnerEmail}</p></td>
                        <td className="px-3 py-3">{riskBadge(t.risk)}</td>
                        <td className="px-3 py-3">{statusBadge(t.status)}</td>
                        <td className="px-3 py-3 text-xs text-[#5F7288]">{t.assignedOwner || <span className="italic text-[#A0B0C0]">Unassigned</span>}</td>
                        <td className="px-3 py-3 text-xs font-semibold text-[#14264A]">{fmtHoursMin(t.otjCompleted)}</td>
                        <td className="px-3 py-3 text-xs text-[#5F7288]">{fmtHoursMin(t.otjExpected)}</td>
                        <td className="px-3 py-3 text-xs font-semibold text-red-600">
                          {reqToSubmitHours(t.otjExpected, t.otjCompleted) > 0
                            ? fmtHoursMin(reqToSubmitHours(t.otjExpected, t.otjCompleted))
                            : <span className="text-green-600">—</span>}
                        </td>
                        <td className="px-3 py-3 text-xs font-semibold text-[#14264A]">{daysSince(t.createdAt)}</td>
                        <td className="px-3 py-3">
                          {(() => { const count = t.notes.split("\n").filter((l) => l.trim()).length; return count > 0 ? <button onClick={() => setQuickNotesTicket(t)} className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700 hover:bg-green-100"><MessageSquare className="h-3 w-3" />{count}</button> : <span className="text-xs text-[#A0B0C0]">—</span>; })()}
                        </td>
                        <td className="px-3 py-3">
                          {t.evidenceCount > 0 ? <button onClick={() => setQuickEvidenceTicket(t)} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"><Paperclip className="h-3 w-3" />{t.evidenceCount} {t.evidenceCount === 1 ? "file" : "files"}</button> : <span className="text-xs text-[#A0B0C0]">—</span>}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap items-center gap-1">
                            {t.escalated && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">Escalated</span>}
                            {t.action === "emailed" && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                                <Mail className="h-3 w-3" />Emailed ✓
                              </span>
                            )}
                            <OTJTicketActionsMenu ticket={t} onAddNote={() => setAddNoteTicket(t)} onAddEvidence={() => setAddEvidenceTicket(t)} onEmail={() => handleEmailTicket(t)} onQuickAction={handleQuickAction} />
                          </div>
                        </td>
                        <td className="px-3 py-3"><button onClick={() => setEditTicket(t)} className="rounded px-2 py-1 text-xs font-semibold text-[#24557F] hover:bg-[#EEF7FF]">Edit</button></td>
                        <td className="px-3 py-3">
                          <button onClick={async () => { await fetch(`/api/otj-tickets/${t.id}/archive/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archive: !t.isArchived }) }); await loadTickets(); }}
                            className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold ${t.isArchived ? "text-green-700 hover:bg-green-50" : "text-[#5F7288] hover:bg-[#F0F4F8]"}`}>
                            <Archive className="h-3.5 w-3.5" />{t.isArchived ? "Restore" : "Archive"}
                          </button>
                          {t.isArchived && <button onClick={() => setDeleteConfirm(t)} className="mt-1 flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" />Delete</button>}
                        </td>
                        <td className="px-3 py-3">
                          <button onClick={() => setViewTicket(t)} className="rounded px-2 py-1 text-xs font-semibold text-[#24557F] hover:bg-[#EEF7FF]">
                            View
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

      <OTJTicketFormModal open={createOpen} onClose={() => { setCreateOpen(false); setCreatePrefill(undefined); }} onSave={handleCreate} initial={createPrefill} />
      <OTJTicketFormModal open={Boolean(editTicket)} onClose={() => setEditTicket(null)} onSave={handleEdit} ticketId={editTicket?.id}
        initial={editTicket ? { learnerEmail: editTicket.learnerEmail, learnerName: editTicket.learnerName, learnerPhone: editTicket.learnerPhone, organisation: editTicket.organisation, programme: editTicket.programme, otjMinimum: editTicket.otjMinimum, otjCompleted: editTicket.otjCompleted, otjExpected: editTicket.otjExpected, otjStatus: editTicket.otjStatus, risk: editTicket.risk, status: editTicket.status, assignedOwner: editTicket.assignedOwner, action: (editTicket.action || "") as OTJAction, notes: editTicket.notes, escalated: editTicket.escalated } : undefined} />

      {/* View Modal */}
      <Dialog open={Boolean(viewTicket)} onOpenChange={(o) => !o && setViewTicket(null)}>
        <DialogContent className="max-h-[90vh] max-w-xl gap-0 overflow-y-auto rounded-2xl border border-[#DDE7F0] p-0 shadow-2xl">
          {viewTicket && (() => {
            const { otjExpected: tgt, otjCompleted: comp, otjMinimum: planned } = viewTicket;
            const diffPct = planned > 0 ? Math.abs(Math.round(((tgt - comp) / planned) * 100)) : 0;
            const ahead = comp >= tgt;
            const barPct = tgt > 0 ? Math.min(Math.round((comp / tgt) * 100), 100) : 0;
            const reqHrs = reqToSubmitHours(tgt, comp);
            const initials = viewTicket.learnerName.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
            const riskAccent: Record<OTJRisk, string> = { red: "bg-red-500", amber: "bg-amber-400", green: "bg-green-500" };
            const riskAvatarBg: Record<OTJRisk, string> = { red: "bg-red-100 text-red-700", amber: "bg-amber-100 text-amber-700", green: "bg-green-100 text-green-700" };
            return (
              <>
                {/* Top accent strip */}
                <div className={`h-1 w-full rounded-t-2xl ${riskAccent[viewTicket.risk]}`} />

                {/* Header */}
                <div className="flex items-start gap-4 px-6 pt-5 pb-4 border-b border-[#F0F4F8]">
                  {/* Avatar */}
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-base font-bold ${riskAvatarBg[viewTicket.risk]}`}>
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-mono text-xs font-bold text-[#5F7288] bg-[#F0F4F8] rounded px-2 py-0.5">{viewTicket.ticketRef}</span>
                      {riskBadge(viewTicket.risk)}
                      {statusBadge(viewTicket.status)}
                      {viewTicket.escalated && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">⚡ Escalated</span>}
                    </div>
                    <h2 className="text-base font-bold text-[#14264A] leading-snug">{viewTicket.learnerName}</h2>
                    <p className="text-xs text-[#71849A]">{viewTicket.learnerEmail}{viewTicket.learnerPhone ? ` · ${viewTicket.learnerPhone}` : ""}</p>
                  </div>
                </div>

                {/* Organisation + Programme */}
                <div className="grid grid-cols-2 gap-px bg-[#F0F4F8] border-b border-[#F0F4F8]">
                  {[["Organisation", viewTicket.organisation || "—"], ["Programme", viewTicket.programme || "—"]].map(([k, v]) => (
                    <div key={k} className="bg-white px-5 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-[#A0B0C0]">{k}</p>
                      <p className="mt-0.5 text-xs font-semibold text-[#14264A] leading-snug">{v}</p>
                    </div>
                  ))}
                </div>

                {/* OTJH Metrics */}
                <div className="grid grid-cols-4 gap-px bg-[#F0F4F8] border-b border-[#F0F4F8]">
                  {[
                    { label: "Completed", value: fmtHoursMin(comp), cls: "text-[#14264A]" },
                    { label: "Target Now", value: fmtHoursMin(tgt), cls: "text-[#14264A]" },
                    { label: "Req. to Submit", value: reqHrs > 0 ? fmtHoursMin(reqHrs) : "On Track", cls: reqHrs > 0 ? "text-red-600" : "text-green-600" },
                    { label: ahead ? `+${diffPct}% Ahead` : `${diffPct}% Behind`, value: `${barPct}%`, cls: ahead ? "text-green-600" : "text-red-600" },
                  ].map(({ label, value, cls }) => (
                    <div key={label} className="bg-white flex flex-col items-center justify-center px-2 py-4 text-center">
                      <p className={`text-base font-bold ${cls}`}>{value}</p>
                      <p className="mt-0.5 text-[10px] font-semibold text-[#A0B0C0] leading-tight">{label}</p>
                    </div>
                  ))}
                </div>

                {/* Progress bar */}
                <div className="px-6 py-3 bg-white border-b border-[#F0F4F8]">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-semibold text-[#A0B0C0]">OTJH Progress vs Target</span>
                    <span className={`text-[11px] font-bold ${ahead ? "text-green-600" : "text-red-500"}`}>{barPct}% complete</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[#E8EFF7]">
                    <div
                      className={`h-full rounded-full ${ahead ? "bg-green-500" : barPct >= 80 ? "bg-amber-400" : "bg-red-500"}`}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </div>

                {/* Owner + Action */}
                <div className="grid grid-cols-2 gap-px bg-[#F0F4F8] border-b border-[#F0F4F8]">
                  {[
                    ["Assigned Owner", viewTicket.assignedOwner || "Unassigned"],
                    ["Action Taken", ACTION_OPTIONS.find((o) => o.value === viewTicket.action)?.label || "—"],
                  ].map(([k, v]) => (
                    <div key={k} className="bg-white px-5 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-[#A0B0C0]">{k}</p>
                      <p className="mt-0.5 text-xs font-semibold text-[#14264A]">{v}</p>
                    </div>
                  ))}
                </div>

                {/* Notes */}
                {viewTicket.notes && (
                  <div className="px-6 py-4 border-b border-[#F0F4F8] bg-white">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#A0B0C0]">Notes</p>
                    <p className="whitespace-pre-wrap rounded-xl bg-[#F8FBFE] px-4 py-3 text-xs text-[#14264A] leading-relaxed border border-[#EEF3FA]">{viewTicket.notes}</p>
                  </div>
                )}

                {/* Evidence files */}
                {viewFiles.length > 0 && (
                  <div className="px-6 py-4 bg-white border-b border-[#F0F4F8]">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#A0B0C0]">Evidence Files ({viewFiles.length})</p>
                    <div className="space-y-2">
                      {viewFiles.map((f) => (
                        <div key={f.id} className="flex items-center gap-3 rounded-xl border border-[#EEF3FA] bg-[#F8FBFE] px-3 py-2">
                          <button type="button" onClick={() => setViewPreview({ url: f.url, name: f.name, mime: f.mimeType })} className="shrink-0 overflow-hidden rounded-lg">
                            {isImage(f.mimeType, f.name) ? <img src={f.url} alt={f.name} className="h-9 w-9 object-cover rounded-lg" /> : <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#EEF7FF]"><FileIcon className="h-4 w-4 text-[#24557F]" /></div>}
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-[#14264A]">{f.name}</p>
                            <p className="text-[10px] text-[#A0B0C0]">{fmtDate(f.uploadedAt)}</p>
                          </div>
                          <button type="button" onClick={() => setViewPreview({ url: f.url, name: f.name, mime: f.mimeType })} className="rounded-lg p-1.5 text-[#24557F] hover:bg-[#EEF7FF]"><Eye className="h-3.5 w-3.5" /></button>
                          <a href={f.url} target="_blank" rel="noreferrer" className="rounded-lg p-1.5 text-[#24557F] hover:bg-[#EEF7FF]"><Download className="h-3.5 w-3.5" /></a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Footer */}
                <div className="px-6 py-3 bg-[#F8FBFE] rounded-b-2xl">
                  <p className="text-center text-[11px] text-[#C0CDD8]">Created by <span className="font-semibold text-[#8AA0B6]">{viewTicket.createdBy}</span> · {fmtDate(viewTicket.createdAt)}</p>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
      <FilePreviewModal target={viewPreview} onClose={() => setViewPreview(null)} />

      {addNoteTicket && <AddNoteModal ticket={addNoteTicket} onClose={() => setAddNoteTicket(null)} onSaved={loadTickets} />}
      {addEvidenceTicket && <AddEvidenceModal ticket={addEvidenceTicket} onClose={() => setAddEvidenceTicket(null)} onSaved={loadTickets} />}

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
              <Paperclip className="h-4 w-4 text-[#24557F]" />
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
                    {isImage(f.mimeType, f.name) ? <img src={f.url} alt={f.name} className="h-10 w-10 rounded-md object-cover" /> : <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#EEF7FF]"><FileIcon className="h-5 w-5 text-[#24557F]" /></div>}
                  </div>
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-[#14264A]">{f.name}</p><p className="text-[11px] text-[#71849A]">{fmtDate(f.uploadedAt)}</p></div>
                  <a href={f.url} target="_blank" rel="noreferrer" className="shrink-0 rounded p-1 text-[#24557F] hover:bg-[#EEF7FF]"><Eye className="h-4 w-4" /></a>
                  <a href={f.url} download={f.name} className="shrink-0 rounded p-1 text-[#24557F] hover:bg-[#EEF7FF]"><Download className="h-4 w-4" /></a>
                </div>
              ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={Boolean(deleteConfirm)} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm rounded-xl border-[#DDE7F0]">
          <DialogHeader><DialogTitle className="text-base font-semibold text-[#14264A]">Permanently Delete Ticket?</DialogTitle></DialogHeader>
          <p className="mt-2 text-sm text-[#5F7288]">This will permanently delete <strong>{deleteConfirm?.ticketRef}</strong> and all attached files.</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)} className="rounded-lg">Cancel</Button>
            <Button onClick={async () => { if (!deleteConfirm) return; await fetch(`/api/otj-tickets/${deleteConfirm.id}/`, { method: "DELETE" }); setDeleteConfirm(null); await loadTickets(); }} className="rounded-lg bg-red-600 text-white hover:bg-red-700">
              <Trash2 className="mr-1.5 h-4 w-4" />Delete Permanently
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
