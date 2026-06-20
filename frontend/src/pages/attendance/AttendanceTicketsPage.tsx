import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import {
  AlertTriangle,
  Archive,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Download,
  Eye,
  File as FileIcon,
  FileText,
  Filter,
  Flag,
  History,
  Image as ImageIcon,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UploadCloud,
  X,
  XCircle,
  ZoomIn,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import AppLayout from "@/components/AppLayout";
import BackButton from "@/components/BackButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Types ──────────────────────────────────────────────────────────

type TicketRisk = "red" | "amber" | "green";
type TicketStatus =
  | "new"
  | "open"
  | "under_review"
  | "follow_up_scheduled"
  | "support_plan_active"
  | "resolved"
  | "covered";

interface EvidenceFile {
  id: number;
  name: string;
  url: string;
  mimeType: string;
  uploadedAt: string;
}

interface AttTicket {
  id: number;
  ticketRef: string;
  learnerEmail: string;
  learnerName: string;
  learnerPhone: string;
  organisation: string;
  programme: string;
  attendanceDate: string | null;
  attendanceModule: string;
  risk: TicketRisk;
  status: TicketStatus;
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

type TicketAction =
  | ""
  | "called"
  | "emailed"
  | "sms"
  | "meeting_scheduled"
  | "referred_support"
  | "warning_issued"
  | "no_action";

const ACTION_OPTIONS: { value: TicketAction; label: string }[] = [
  { value: "", label: "— No action selected —" },
  { value: "called", label: "Called" },
  { value: "emailed", label: "Emailed" },
  { value: "sms", label: "SMS Sent" },
  { value: "meeting_scheduled", label: "Meeting Scheduled" },
  { value: "referred_support", label: "Referred to Support" },
  { value: "warning_issued", label: "Warning Issued" },
  { value: "no_action", label: "No Action Required" },
];

const EMPTY_FORM = {
  learnerEmail: "",
  learnerName: "",
  learnerPhone: "",
  organisation: "",
  programme: "",
  attendanceDate: "",
  attendanceModule: "",
  risk: "green" as TicketRisk,
  status: "new" as TicketStatus,
  assignedOwner: "",
  action: "" as TicketAction,
  notes: "",
  escalated: false,
};

// ─── Visual helpers ──────────────────────────────────────────────────

const riskBadge = (risk: TicketRisk) => {
  const styles: Record<TicketRisk, string> = {
    red: "bg-red-100 text-red-700 border-red-200",
    amber: "bg-amber-100 text-amber-700 border-amber-200",
    green: "bg-green-100 text-green-700 border-green-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${styles[risk]}`}>
      {risk}
    </span>
  );
};

const statusBadge = (status: TicketStatus) => {
  const map: Record<TicketStatus, { label: string; cls: string }> = {
    new: { label: "New", cls: "bg-slate-100 text-slate-700 border-slate-200" },
    open: { label: "Open", cls: "bg-blue-100 text-blue-700 border-blue-200" },
    under_review: { label: "Under Review", cls: "bg-purple-100 text-purple-700 border-purple-200" },
    follow_up_scheduled: { label: "Follow-up Scheduled", cls: "bg-teal-100 text-teal-700 border-teal-200" },
    support_plan_active: { label: "Support Plan Active", cls: "bg-orange-100 text-orange-700 border-orange-200" },
    resolved: { label: "Resolved", cls: "bg-green-100 text-green-700 border-green-200" },
    covered: { label: "Covered", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  };
  const { label, cls } = map[status] ?? map.new;
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
};

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return iso; }
};

const daysSince = (iso: string) => {
  try { return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000); }
  catch { return 0; }
};

const isClosedTicketStatus = (status: TicketStatus) => status === "resolved" || status === "covered";

const isImage = (mime: string, name: string) => {
  if (mime.startsWith("image/")) return true;
  return /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(name);
};

const isPdf = (mime: string, name: string) => {
  if (mime === "application/pdf") return true;
  return /\.pdf$/i.test(name);
};

const isText = (mime: string, name: string) => {
  if (mime.startsWith("text/")) return true;
  return /\.(csv|txt|log|tsv)$/i.test(name);
};

const isCsv = (mime: string, name: string) => {
  if (mime === "text/csv" || mime === "application/csv") return true;
  return /\.csv$/i.test(name);
};

// ─── File Preview Modal ──────────────────────────────────────────────

interface PreviewTarget {
  url: string;
  name: string;
  mime: string;
  size?: number;
  revoke?: boolean; // should we revokeObjectURL on close?
}

function FilePreviewModal({ target, onClose }: { target: PreviewTarget | null; onClose: () => void }) {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);

  // Load text content when target is CSV/TXT
  useEffect(() => {
    if (!target) { setTextContent(null); return; }
    if (isText(target.mime, target.name)) {
      setTextLoading(true);
      fetch(target.url)
        .then((r) => r.text())
        .then((t) => { setTextContent(t); setTextLoading(false); })
        .catch(() => { setTextContent(null); setTextLoading(false); });
    } else {
      setTextContent(null);
    }
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      if (target.revoke) URL.revokeObjectURL(target.url);
    };
  }, [target, onClose]);

  // Parse CSV rows — must be before early return to respect Rules of Hooks
  const csvRows = useMemo(() => {
    if (!target || !isCsv(target.mime, target.name) || !textContent) return null;
    return textContent.trim().split("\n").map((line) =>
      line.split(",").map((cell) => cell.replace(/^"|"$/g, "").trim())
    );
  }, [target, textContent]);

  if (!target) return null;

  const img = isImage(target.mime, target.name);
  const pdf = isPdf(target.mime, target.name);
  const csv = isCsv(target.mime, target.name);
  const txt = isText(target.mime, target.name) && !csv;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-[#DDE7F0] px-4 py-3">
          {img ? (
            <ImageIcon className="h-4 w-4 shrink-0 text-[#1E6ACB]" />
          ) : (
            <FileIcon className="h-4 w-4 shrink-0 text-[#1E6ACB]" />
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#14264A]">{target.name}</span>
          {target.size !== undefined && (
            <span className="shrink-0 text-xs text-[#A0B0C0]">{(target.size / 1024).toFixed(0)} KB</span>
          )}
          <a
            href={target.url}
            download={target.name}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-lg p-1.5 text-[#1E6ACB] hover:bg-[#EEF7FF]"
            title="Download"
            onClick={(e) => e.stopPropagation()}
          >
            <Download className="h-4 w-4" />
          </a>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-[#71849A] hover:bg-[#F0F4F8]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className={`flex-1 overflow-auto bg-[#F4F8FC] ${img ? "flex items-center justify-center p-4" : "p-4"}`}>
          {/* Image */}
          {img && (
            <img
              src={target.url}
              alt={target.name}
              className="max-h-[75vh] max-w-full rounded-lg object-contain shadow-md"
            />
          )}

          {/* PDF */}
          {pdf && (
            <iframe
              src={target.url}
              title={target.name}
              className="h-[72vh] w-full rounded-lg border border-[#DDE7F0] bg-white"
            />
          )}

          {/* CSV — table */}
          {csv && (
            textLoading ? (
              <div className="flex h-40 items-center justify-center text-sm text-[#71849A]">Loading…</div>
            ) : csvRows ? (
              <div className="overflow-auto rounded-xl border border-[#DDE7F0] bg-white">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#DDE7F0] bg-[#F0F6FF]">
                      {csvRows[0].map((cell, ci) => (
                        <th key={ci} className="px-3 py-2 text-left font-semibold text-[#14264A]">
                          {cell}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {csvRows.slice(1).map((row, ri) => (
                      <tr key={ri} className={`border-b border-[#F4F8FC] ${ri % 2 === 0 ? "bg-white" : "bg-[#F9FBFD]"}`}>
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-3 py-2 text-[#3A506B]">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="border-t border-[#DDE7F0] px-3 py-2 text-[11px] text-[#A0B0C0]">
                  {csvRows.length - 1} rows · {csvRows[0]?.length ?? 0} columns
                </p>
              </div>
            ) : (
              <p className="text-sm text-[#A0B0C0]">Could not load CSV content.</p>
            )
          )}

          {/* Plain text / TXT */}
          {txt && (
            textLoading ? (
              <div className="flex h-40 items-center justify-center text-sm text-[#71849A]">Loading…</div>
            ) : textContent ? (
              <pre className="max-h-[72vh] overflow-auto whitespace-pre-wrap rounded-xl border border-[#DDE7F0] bg-white p-4 font-mono text-xs leading-relaxed text-[#14264A]">
                {textContent}
              </pre>
            ) : (
              <p className="text-sm text-[#A0B0C0]">Could not load file content.</p>
            )
          )}

          {/* Unsupported */}
          {!img && !pdf && !csv && !txt && (
            <div className="flex flex-col items-center gap-4 py-10">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[#EEF7FF]">
                <FileIcon className="h-10 w-10 text-[#1E6ACB]" />
              </div>
              <p className="text-base font-semibold text-[#14264A]">{target.name}</p>
              {target.size !== undefined && (
                <p className="text-sm text-[#71849A]">{(target.size / 1024).toFixed(1)} KB</p>
              )}
              <p className="text-xs text-[#A0B0C0]">Preview not available for this file type</p>
              <a
                href={target.url}
                download={target.name}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-[#14264A] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1E3A6A]"
              >
                <Download className="h-4 w-4" />
                Download file
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Evidence Upload Zone ────────────────────────────────────────────

interface EvidenceUploadZoneProps {
  ticketId?: number;
  existingFiles: EvidenceFile[];
  pendingFiles: File[];
  onAddPending: (files: File[]) => void;
  onRemovePending: (index: number) => void;
  onDeleteExisting: (fileId: number) => void;
  uploading?: boolean;
}

function EvidenceUploadZone({
  ticketId,
  existingFiles,
  pendingFiles,
  onAddPending,
  onRemovePending,
  onDeleteExisting,
  uploading,
}: EvidenceUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onAddPending(files);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) onAddPending(files);
    e.target.value = "";
  };

  const openPendingPreview = (f: File) => {
    const url = URL.createObjectURL(f);
    setPreview({ url, name: f.name, mime: f.type || "", size: f.size, revoke: true });
  };

  const openExistingPreview = (f: EvidenceFile) => {
    setPreview({ url: f.url, name: f.name, mime: f.mimeType, revoke: false });
  };

  const totalCount = existingFiles.length + pendingFiles.length;

  return (
    <>
      <div className="space-y-3">
        {/* Drop Zone */}
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 transition-colors ${
            dragging
              ? "border-[#1E6ACB] bg-[#EEF7FF]"
              : "border-[#D7E5F3] bg-[#F8FBFE] hover:border-[#1E6ACB] hover:bg-[#EEF7FF]"
          }`}
        >
          <UploadCloud className={`h-8 w-8 ${dragging ? "text-[#1E6ACB]" : "text-[#A0B8D0]"}`} />
          <div className="text-center">
            <p className="text-sm font-semibold text-[#14264A]">
              {uploading ? "Uploading…" : "Click to upload or drag & drop"}
            </p>
            <p className="mt-0.5 text-xs text-[#71849A]">Images, PDFs, Word docs, Excel, etc.</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {/* File list */}
        {totalCount > 0 && (
          <div className="space-y-2">
            {/* Existing uploaded files */}
            {existingFiles.map((f) => (
              <div key={f.id} className="group flex items-center gap-3 rounded-lg border border-[#DDE7F0] bg-white p-2.5">
                {/* Thumbnail — click to preview */}
                <button
                  type="button"
                  onClick={() => openExistingPreview(f)}
                  className="relative shrink-0 overflow-hidden rounded-md"
                  title="Preview"
                >
                  {isImage(f.mimeType, f.name) ? (
                    <img src={f.url} alt={f.name} className="h-10 w-10 object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center bg-[#EEF7FF]">
                      <FileIcon className="h-5 w-5 text-[#1E6ACB]" />
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                    <ZoomIn className="h-4 w-4 text-white" />
                  </div>
                </button>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-[#14264A]">{f.name}</p>
                  <p className="text-[11px] text-[#71849A]">{fmtDate(f.uploadedAt)}</p>
                </div>

                <button
                  type="button"
                  onClick={() => openExistingPreview(f)}
                  className="shrink-0 rounded p-1 text-[#1E6ACB] hover:bg-[#EEF7FF]"
                  title="Preview"
                >
                  <Eye className="h-4 w-4" />
                </button>
                <a href={f.url} target="_blank" rel="noreferrer" className="shrink-0 rounded p-1 text-[#1E6ACB] hover:bg-[#EEF7FF]" title="Download">
                  <Download className="h-4 w-4" />
                </a>
                <button
                  type="button"
                  onClick={() => onDeleteExisting(f.id)}
                  className="shrink-0 rounded p-1 text-red-500 hover:bg-red-50"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}

            {/* Pending (not yet uploaded) files */}
            {pendingFiles.map((f, i) => {
              const thumbUrl = f.type.startsWith("image/") ? URL.createObjectURL(f) : null;
              return (
                <div key={`pending-${i}`} className="group flex items-center gap-3 rounded-lg border border-dashed border-[#B8D7F2] bg-[#F0F8FF] p-2.5">
                  {/* Thumbnail — click to preview */}
                  <button
                    type="button"
                    onClick={() => openPendingPreview(f)}
                    className="relative shrink-0 overflow-hidden rounded-md"
                    title="Preview"
                  >
                    {thumbUrl ? (
                      <img src={thumbUrl} alt={f.name} className="h-10 w-10 object-cover" />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center bg-[#EEF7FF]">
                        <FileIcon className="h-5 w-5 text-[#1E6ACB]" />
                      </div>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                      <ZoomIn className="h-4 w-4 text-white" />
                    </div>
                  </button>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-[#14264A]">{f.name}</p>
                    <p className="text-[11px] text-[#71849A]">
                      {(f.size / 1024).toFixed(0)} KB · Pending upload
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => openPendingPreview(f)}
                    className="shrink-0 rounded p-1 text-[#1E6ACB] hover:bg-[#EEF7FF]"
                    title="Preview"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemovePending(i)}
                    className="shrink-0 rounded p-1 text-red-400 hover:bg-red-50"
                    title="Remove"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Preview modal — rendered outside the form flow */}
      <FilePreviewModal target={preview} onClose={() => setPreview(null)} />
    </>
  );
}

// ─── Ticket Form Modal ───────────────────────────────────────────────

function TicketFormModal({
  open,
  onClose,
  onSave,
  initial,
  ticketId,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (data: typeof EMPTY_FORM, pendingFiles: File[]) => Promise<void>;
  initial?: Partial<typeof EMPTY_FORM>;
  ticketId?: number;
}) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initial });
  const [saving, setSaving] = useState(false);
  const [existingFiles, setExistingFiles] = useState<EvidenceFile[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY_FORM, ...initial });
      setPendingFiles([]);
    }
  }, [open]);

  // Load existing files when editing
  useEffect(() => {
    if (open && ticketId) {
      fetch(`/api/attendance-tickets/${ticketId}/files/`)
        .then((r) => r.ok ? r.json() : [])
        .then(setExistingFiles)
        .catch(() => setExistingFiles([]));
    } else {
      setExistingFiles([]);
    }
  }, [open, ticketId]);

  const set = (k: keyof typeof EMPTY_FORM, v: string | boolean) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const handleDeleteExisting = async (fileId: number) => {
    if (!ticketId) return;
    await fetch(`/api/attendance-tickets/${ticketId}/files/${fileId}/`, { method: "DELETE" });
    setExistingFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  const handleSave = async () => {
    if (!form.learnerEmail.trim() || !form.learnerName.trim()) return;
    setSaving(true);
    try {
      await onSave(form, pendingFiles);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-xl border-[#DDE7F0]">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-[#14264A]">
            {ticketId ? "Edit Ticket" : "Create Attendance Ticket"}
          </DialogTitle>
        </DialogHeader>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-[#24486D]">Learner Email *</Label>
            <Input value={form.learnerEmail} onChange={(e) => set("learnerEmail", e.target.value)}
              placeholder="learner@example.com" className="h-10 rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-[#24486D]">Learner Name *</Label>
            <Input value={form.learnerName} onChange={(e) => set("learnerName", e.target.value)}
              placeholder="Full name" className="h-10 rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-[#24486D]">Phone</Label>
            <Input value={form.learnerPhone} onChange={(e) => set("learnerPhone", e.target.value)}
              placeholder="07700 000000" className="h-10 rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-[#24486D]">Organisation</Label>
            <Input value={form.organisation} onChange={(e) => set("organisation", e.target.value)}
              placeholder="Organisation name" className="h-10 rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-[#24486D]">Programme</Label>
            <Input value={form.programme} onChange={(e) => set("programme", e.target.value)}
              placeholder="e.g. Team Leader" className="h-10 rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-[#24486D]">Attendance Date</Label>
            <Input type="date" value={form.attendanceDate} onChange={(e) => set("attendanceDate", e.target.value)}
              className="h-10 rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-[#24486D]">Risk Level</Label>
            <Select value={form.risk} onValueChange={(v) => set("risk", v as TicketRisk)}>
              <SelectTrigger className="h-10 rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="green">Green</SelectItem>
                <SelectItem value="amber">Amber</SelectItem>
                <SelectItem value="red">Red</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-[#24486D]">Status</Label>
            <Select value={form.status} onValueChange={(v) => set("status", v as TicketStatus)}>
              <SelectTrigger className="h-10 rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="under_review">Under Review</SelectItem>
                <SelectItem value="follow_up_scheduled">Follow-up Scheduled</SelectItem>
                <SelectItem value="support_plan_active">Support Plan Active</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="covered">Covered</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs font-semibold text-[#24486D]">Assigned Owner</Label>
            <Input value={form.assignedOwner} onChange={(e) => set("assignedOwner", e.target.value)}
              placeholder="Coach or staff name" className="h-10 rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm" />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs font-semibold text-[#24486D]">Action Taken</Label>
            <Select value={form.action} onValueChange={(v) => set("action", v as TicketAction)}>
              <SelectTrigger className="h-10 rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm"><SelectValue placeholder="Select an action…" /></SelectTrigger>
              <SelectContent>
                {ACTION_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value || "__none__"}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs font-semibold text-[#24486D]">Notes</Label>
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)}
              placeholder="Add any relevant notes…" className="min-h-[80px] rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm" />
          </div>

          {/* Evidence — file upload */}
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs font-semibold text-[#24486D]">
              Evidence
              <span className="ml-1 font-normal text-[#71849A]">— images, PDFs, or documents</span>
            </Label>
            <EvidenceUploadZone
              ticketId={ticketId}
              existingFiles={existingFiles}
              pendingFiles={pendingFiles}
              onAddPending={(files) => setPendingFiles((prev) => [...prev, ...files])}
              onRemovePending={(i) => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
              onDeleteExisting={handleDeleteExisting}
              uploading={uploading}
            />
            {!ticketId && pendingFiles.length > 0 && (
              <p className="text-[11px] text-[#71849A]">
                Files will be uploaded after the ticket is created.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" id="escalated" checked={form.escalated}
              onChange={(e) => set("escalated", e.target.checked)}
              className="h-4 w-4 rounded border-[#D7E5F3] accent-[#14264A]" />
            <label htmlFor="escalated" className="text-sm font-medium text-[#14264A]">
              Mark as Escalated
            </label>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-lg border-[#DDE7F0]">Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={saving || !form.learnerEmail.trim() || !form.learnerName.trim()}
            className="rounded-lg bg-[#14264A] text-white hover:bg-[#184D91]"
          >
            {saving ? "Saving…" : ticketId ? "Save Changes" : "Create Ticket"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Evidence view in View Modal ─────────────────────────────────────

function EvidenceViewer({ ticketId }: { ticketId: number }) {
  const [files, setFiles] = useState<EvidenceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

  useEffect(() => {
    fetch(`/api/attendance-tickets/${ticketId}/files/`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => { setFiles(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ticketId]);

  if (loading) return <p className="text-xs text-[#71849A]">Loading files…</p>;
  if (!files.length) return <p className="text-xs italic text-[#A0B0C0]">No evidence files attached</p>;

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {files.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setPreview({ url: f.url, name: f.name, mime: f.mimeType, revoke: false })}
            className="group relative overflow-hidden rounded-lg border border-[#DDE7F0] bg-white text-left transition hover:shadow-md focus:outline-none"
          >
            {isImage(f.mimeType, f.name) ? (
              <img src={f.url} alt={f.name} className="h-28 w-full object-cover" />
            ) : (
              <div className="flex h-28 flex-col items-center justify-center gap-1 bg-[#F8FBFE]">
                <FileIcon className="h-8 w-8 text-[#1E6ACB]" />
                <span className="px-2 text-center text-[11px] font-medium text-[#5F7288] line-clamp-2">{f.name}</span>
              </div>
            )}
            <div className="border-t border-[#DDE7F0] px-2 py-1.5">
              <p className="truncate text-[11px] font-semibold text-[#14264A]">{f.name}</p>
              <p className="text-[10px] text-[#71849A]">{fmtDate(f.uploadedAt)}</p>
            </div>
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
              <Eye className="h-6 w-6 text-white" />
            </div>
          </button>
        ))}
      </div>
      <FilePreviewModal target={preview} onClose={() => setPreview(null)} />
    </>
  );
}

// ─── Add Note Modal ──────────────────────────────────────────────────

function AddNoteModal({
  ticket,
  onClose,
  onSaved,
}: {
  ticket: AttTicket;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!text.trim()) return;
    setSaving(true);
    const newNotes = ticket.notes.trim()
      ? `${ticket.notes.trim()}\n${text.trim()}`
      : text.trim();
    await fetch(`/api/attendance-tickets/${ticket.id}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: newNotes }),
    });
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-xl border-[#DDE7F0]">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-[#14264A]">
            Add Note · {ticket.learnerName}
          </DialogTitle>
        </DialogHeader>
        <div className="mt-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type your note here…"
            className="min-h-[100px] rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm"
            autoFocus
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-lg border-[#DDE7F0]">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !text.trim()}
            className="rounded-lg bg-[#14264A] text-white hover:bg-[#184D91]"
          >
            {saving ? "Saving…" : "Add Note"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Quick Evidence Modal ─────────────────────────────────────────────

function QuickEvidenceModal({
  ticket,
  onClose,
  onSaved,
}: {
  ticket: AttTicket;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [existingFiles, setExistingFiles] = useState<EvidenceFile[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetch(`/api/attendance-tickets/${ticket.id}/files/`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setExistingFiles)
      .catch(() => {});
  }, [ticket.id]);

  const handleUpload = async () => {
    if (!pendingFiles.length) return;
    setUploading(true);
    for (const f of pendingFiles) {
      const fd = new FormData();
      fd.append("file", f);
      await fetch(`/api/attendance-tickets/${ticket.id}/files/`, { method: "POST", body: fd });
    }
    setUploading(false);
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg rounded-xl border-[#DDE7F0]">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-[#14264A]">
            Add Evidence · {ticket.learnerName}
          </DialogTitle>
        </DialogHeader>
        <div className="mt-3">
          <EvidenceUploadZone
            ticketId={ticket.id}
            existingFiles={existingFiles}
            pendingFiles={pendingFiles}
            onAddPending={(files) => setPendingFiles((prev) => [...prev, ...files])}
            onRemovePending={(i) => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
            onDeleteExisting={async (fileId) => {
              await fetch(`/api/attendance-tickets/${ticket.id}/files/${fileId}/`, { method: "DELETE" });
              setExistingFiles((prev) => prev.filter((f) => f.id !== fileId));
              onSaved();
            }}
            uploading={uploading}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-lg border-[#DDE7F0]">
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!pendingFiles.length || uploading}
            className="rounded-lg bg-[#14264A] text-white hover:bg-[#184D91]"
          >
            {uploading
              ? "Uploading…"
              : `Upload ${pendingFiles.length} file${pendingFiles.length !== 1 ? "s" : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Ticket Actions Dropdown ──────────────────────────────────────────

function TicketActionsMenu({
  ticket,
  onAddNote,
  onAddEvidence,
  onEmail,
  onQuickAction,
}: {
  ticket: AttTicket;
  onAddNote: () => void;
  onAddEvidence: () => void;
  onEmail: () => void;
  onQuickAction: (id: number, updates: Record<string, unknown>) => Promise<void>;
}) {
  const noteCount = ticket.notes.split("\n").filter((l) => l.trim()).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-lg p-1.5 text-[#71849A] hover:bg-[#F0F4F8] focus:outline-none">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-60 overflow-hidden rounded-xl border-[#DDE7F0] p-0 shadow-xl"
        style={{ maxHeight: "min(80vh, 520px)" }}
      >
        {/* Header */}
        <div className="border-b border-[#DDE7F0] bg-[#F8FBFE] px-3 py-2">
          <p className="text-[11px] font-bold text-[#14264A]">Ticket Actions</p>
          <p className="truncate text-[10px] text-[#71849A]">
            {ticket.ticketRef} · {ticket.learnerName}
          </p>
        </div>

        <div
          className="overflow-y-auto"
          style={{ maxHeight: "calc(min(80vh, 520px) - 88px)" }}
        >
          <div className="space-y-0.5 p-1.5">
          {/* NOTES & FILES */}
          <p className="px-2 pb-0.5 pt-1 text-[10px] font-bold uppercase tracking-wide text-[#A0B0C0]">
            Notes &amp; Files
          </p>
          <DropdownMenuItem
            onClick={onAddNote}
            className="cursor-pointer gap-2 rounded-lg text-[#14264A] hover:bg-[#F0F4F8] focus:bg-[#F0F4F8]"
          >
            <FileText className="h-4 w-4 text-[#5F7288]" /> Add Note
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onAddEvidence}
            className="cursor-pointer gap-2 rounded-lg text-[#14264A] hover:bg-[#F0F4F8] focus:bg-[#F0F4F8]"
          >
            <Paperclip className="h-4 w-4 text-[#5F7288]" /> Add Evidence / File
          </DropdownMenuItem>

          <DropdownMenuSeparator className="my-1 bg-[#EEF3F8]" />

          {/* SCHEDULE */}
          <p className="px-2 pb-0.5 pt-1 text-[10px] font-bold uppercase tracking-wide text-[#A0B0C0]">
            Schedule
          </p>
          <DropdownMenuItem
            onClick={() => onQuickAction(ticket.id, { status: "follow_up_scheduled" })}
            className="cursor-pointer gap-2 rounded-lg text-[#14264A] hover:bg-[#F0F4F8] focus:bg-[#F0F4F8]"
          >
            <CalendarClock className="h-4 w-4 text-[#5F7288]" /> Schedule Follow-up
          </DropdownMenuItem>

          <DropdownMenuSeparator className="my-1 bg-[#EEF3F8]" />

          {/* STATUS */}
          <p className="px-2 pb-0.5 pt-1 text-[10px] font-bold uppercase tracking-wide text-[#A0B0C0]">
            Status
          </p>
          <DropdownMenuItem
            onClick={() => onQuickAction(ticket.id, { status: "under_review" })}
            className="cursor-pointer gap-2 rounded-lg text-[#14264A] hover:bg-[#F0F4F8] focus:bg-[#F0F4F8]"
          >
            <ClipboardCheck className="h-4 w-4 text-[#5F7288]" /> Mark as Reviewed
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onQuickAction(ticket.id, { escalated: true, risk: "red" })}
            className="cursor-pointer gap-2 rounded-lg text-[#14264A] hover:bg-[#F0F4F8] focus:bg-[#F0F4F8]"
          >
            <Flag className="h-4 w-4 text-amber-500" /> Flag for Attention
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onQuickAction(ticket.id, { status: "open", escalated: false })}
            className="cursor-pointer gap-2 rounded-lg text-[#14264A] hover:bg-[#F0F4F8] focus:bg-[#F0F4F8]"
          >
            <RefreshCw className="h-4 w-4 text-green-600" /> Reopen / Set Active
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onQuickAction(ticket.id, { status: "covered" })}
            className="cursor-pointer gap-2 rounded-lg text-red-600 hover:bg-red-50 focus:bg-red-50 focus:text-red-600"
          >
            <XCircle className="h-4 w-4" /> Close / Covered
          </DropdownMenuItem>

          <DropdownMenuSeparator className="my-1 bg-[#EEF3F8]" />

          <p className="px-2 pb-0.5 pt-1 text-[10px] font-bold uppercase tracking-wide text-[#A0B0C0]">
            Action Taken
          </p>
          {ACTION_OPTIONS.filter((option) => option.value !== "").map((option) => {
            const isEmailed = option.value === "emailed";
            const isActive = ticket.action === option.value;
            return (
              <DropdownMenuItem
                key={option.value}
                onClick={() =>
                  isEmailed
                    ? onEmail()
                    : onQuickAction(ticket.id, { action: option.value })
                }
                className={`cursor-pointer gap-2 rounded-lg hover:bg-[#F0F4F8] ${
                  isActive
                    ? "bg-[#EEF7FF] font-semibold text-[#1E6ACB]"
                    : "text-[#14264A]"
                }`}
              >
                {isEmailed ? (
                  <Mail
                    className={`h-4 w-4 shrink-0 ${
                      isActive ? "text-[#1E6ACB]" : "text-[#5F7288]"
                    }`}
                  />
                ) : (
                  <CheckCircle2
                    className={`h-4 w-4 shrink-0 ${
                      isActive ? "text-[#1E6ACB]" : "text-[#C5D5E3]"
                    }`}
                  />
                )}
                {option.label}
                {isEmailed && (
                  <span className="ml-auto text-[10px] text-[#A0B0C0]">
                    → Email Centre
                  </span>
                )}
              </DropdownMenuItem>
            );
          })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-1.5 border-t border-[#DDE7F0] bg-[#F8FBFE] px-3 py-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#E8EFF7] px-2 py-0.5 text-[10px] font-semibold text-[#5F7288]">
            <MessageSquare className="h-2.5 w-2.5" /> {noteCount}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#E8EFF7] px-2 py-0.5 text-[10px] font-semibold text-[#5F7288]">
            <Paperclip className="h-2.5 w-2.5" /> {ticket.evidenceCount}
          </span>
          <span className="ml-auto">{statusBadge(ticket.status)}</span>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Case Notes Modal ────────────────────────────────────────────────

function CaseNotesModal({ ticket, onClose }: { ticket: AttTicket; onClose: () => void }) {
  const lines = ticket.notes.split("\n").filter((l) => l.trim());

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
          <button onClick={onClose} className="rounded p-1 text-white/70 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-72 space-y-2.5 overflow-y-auto bg-white p-4">
          {lines.length > 0 ? (
            lines.map((line, i) => (
              <div key={i} className="rounded-xl border border-[#DDE7F0] bg-[#F8FBFE] p-3">
                <p className="text-sm text-[#14264A]">{line}</p>
                <p className="mt-1.5 text-[11px] text-[#71849A]">
                  {ticket.createdBy} · {fmtDate(ticket.createdAt)}
                </p>
              </div>
            ))
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
          <span className="ml-auto">{statusBadge(ticket.status)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Evidence Files Modal ─────────────────────────────────────────────

function EvidenceFilesModal({ ticket, onClose }: { ticket: AttTicket; onClose: () => void }) {
  const [files, setFiles] = useState<EvidenceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

  useEffect(() => {
    fetch(`/api/attendance-tickets/${ticket.id}/files/`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => { setFiles(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ticket.id]);

  const noteCount = ticket.notes.split("\n").filter((l) => l.trim()).length;

  return (
    <>
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
            <Paperclip className="h-4 w-4 text-white/70" />
            <span className="flex-1 truncate text-sm font-semibold text-white">
              Evidence Files · {ticket.learnerName}
            </span>
            <button onClick={onClose} className="rounded p-1 text-white/70 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Content */}
          <div className="max-h-72 space-y-2.5 overflow-y-auto bg-white p-4">
            {loading ? (
              <div className="py-4 text-center text-sm text-[#71849A]">Loading…</div>
            ) : files.length > 0 ? (
              files.map((f) => (
                <div key={f.id} className="rounded-xl border border-[#DDE7F0] bg-[#F8FBFE] p-3">
                  <p className="text-sm font-semibold text-[#14264A]">{f.name}</p>
                  <button
                    type="button"
                    onClick={() => setPreview({ url: f.url, name: f.name, mime: f.mimeType, revoke: false })}
                    className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[#1E6ACB] hover:underline"
                  >
                    <Eye className="h-3 w-3" /> Preview
                  </button>
                  <p className="mt-1.5 text-[11px] text-[#71849A]">
                    {ticket.createdBy} · {fmtDate(f.uploadedAt)}
                  </p>
                </div>
              ))
            ) : (
              <p className="py-4 text-center text-sm text-[#A0B0C0]">No evidence files attached</p>
            )}
          </div>

          {/* Footer */}
          <div className="flex flex-wrap items-center gap-2 border-t border-[#DDE7F0] bg-[#F8FBFE] px-4 py-2.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-[#E8EFF7] px-2.5 py-1 text-xs font-semibold text-[#5F7288]">
              <MessageSquare className="h-3 w-3" />
              {noteCount} {noteCount === 1 ? "note" : "notes"}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-[#E8EFF7] px-2.5 py-1 text-xs font-semibold text-[#5F7288]">
              <Paperclip className="h-3 w-3" />
              {files.length} {files.length === 1 ? "file" : "files"}
            </span>
            <span className="ml-auto">{statusBadge(ticket.status)}</span>
          </div>
        </div>
      </div>
      <FilePreviewModal target={preview} onClose={() => setPreview(null)} />
    </>
  );
}

// ─── Week filter helpers (mirrors TrackAttendancePage logic) ─────────

const getTicketWeekRange = (weekIndex: 0 | 1 | 2 | 3) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dow = today.getDay();
  const daysToMonday = dow === 0 ? 6 : dow - 1;
  const start = new Date(today); start.setDate(today.getDate() - daysToMonday - weekIndex * 7); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23, 59, 59, 999);
  return { start, end };
};

const fmtShort = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

const formatDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const getWeekOptions = () => {
  const opts: { value: string; label: string }[] = [{ value: "all", label: "All Weeks" }];
  const labels = ["This Week", "Previous Week", "2 Weeks Ago", "3 Weeks Ago"];
  for (let i = 0; i < 4; i++) {
    const { start, end } = getTicketWeekRange(i as 0 | 1 | 2 | 3);
    opts.push({ value: String(i), label: `${labels[i]} — ${fmtShort(start)} › ${fmtShort(end)}` });
  }
  return opts;
};

const WEEK_OPTIONS = getWeekOptions();

const ticketDateInWeek = (ticket: AttTicket, weekFilter: "all" | "0" | "1" | "2" | "3") => {
  if (weekFilter === "all") return true;
  if (!ticket.attendanceDate) return false;
  const { start, end } = getTicketWeekRange(Number(weekFilter) as 0 | 1 | 2 | 3);
  const parts = ticket.attendanceDate.split("-").map(Number);
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  return dt >= start && dt <= end;
};

const syncRecentAttendanceTickets = async () => {
  await Promise.all(
    ([0, 1, 2, 3] as const).map((weekIndex) => {
      const { start, end } = getTicketWeekRange(weekIndex);
      return fetch("/api/attendance-tickets/auto-create/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          week_start: formatDateKey(start),
          week_end: formatDateKey(end),
        }),
      }).catch(() => null);
    }),
  );
};

const getAttendanceHistoryUrl = (email: string) => {
  const learnerEmail = String(email || "").trim().toLowerCase();
  const hasUsableLearnerEmail =
    learnerEmail &&
    learnerEmail !== "unknown" &&
    learnerEmail !== "n/a" &&
    learnerEmail.includes("@");

  return hasUsableLearnerEmail
    ? `https://studentportal.kentbusinesscollege.net/student?email=${encodeURIComponent(learnerEmail)}`
    : "";
};

// ─── Main Component ──────────────────────────────────────────────────

export default function AttendanceTicketsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tickets, setTickets] = useState<AttTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [ragFilter, setRagFilter] = useState<"all" | TicketRisk>("all");
  const [notesFilter, setNotesFilter] = useState<"all" | "has" | "missing">("all");
  const [cardFilter, setCardFilter] = useState<"all" | "open" | "resolved">("all");
  const [weekFilter, setWeekFilter] = useState<"all" | "0" | "1" | "2" | "3">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [createPrefill, setCreatePrefill] = useState<Partial<typeof EMPTY_FORM> | undefined>();
  const [editTicket, setEditTicket] = useState<AttTicket | null>(null);
  const [viewTicket, setViewTicket] = useState<AttTicket | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<AttTicket | null>(null);
  const [notesTicket, setNotesTicket] = useState<AttTicket | null>(null);
  const [evidenceTicket, setEvidenceTicket] = useState<AttTicket | null>(null);
  const [addNoteTicket, setAddNoteTicket] = useState<AttTicket | null>(null);
  const [quickEvidenceTicket, setQuickEvidenceTicket] = useState<AttTicket | null>(null);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      if (!showArchived) await syncRecentAttendanceTickets();
      const res = await fetch(`/api/attendance-tickets/?archived=${showArchived}`);
      if (res.ok) setTickets(await res.json());
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => { void loadTickets(); }, [loadTickets]);

  // Handle ?open=<id> and ?create=1&email=...&name=... query params
  useEffect(() => {
    const openId = searchParams.get("open");
    const createFlag = searchParams.get("create");
    if (openId && !loading) {
      const ticket = tickets.find((t) => String(t.id) === openId);
      if (ticket) {
        setViewTicket(ticket);
        setSearchParams({}, { replace: true });
      }
    } else if (createFlag === "1") {
      setCreatePrefill({
        learnerEmail: searchParams.get("email") ?? "",
        learnerName: searchParams.get("name") ?? "",
        learnerPhone: searchParams.get("phone") ?? "",
        organisation: searchParams.get("organisation") ?? "",
        programme: searchParams.get("programme") ?? "",
        attendanceDate: searchParams.get("date") ?? "",
      });
      setCreateOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, tickets, loading, setSearchParams]);

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
    const sentBy = user?.fullName || user?.email || "";
    const noteEntry = `Email sent on ${dateLabel}${sentBy ? ` by ${sentBy}` : ""}`;
    const currentNotes = ticket?.notes?.trim() || "";
    const notes = currentNotes ? `${currentNotes}\n${noteEntry}` : noteEntry;

    fetch(`/api/attendance-tickets/${ticketId}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "emailed", notes }),
    }).then(() => loadTickets());
    setSearchParams({}, { replace: true });
  }, [loading, loadTickets, searchParams, setSearchParams, tickets, user]);

  const handleEmailTicket = useCallback(
    (ticket: AttTicket) => {
      navigate("/email-centre", {
        state: {
          selectedRecipient: {
            learnerName: ticket.learnerName,
            learnerEmail: ticket.learnerEmail,
            programme: ticket.programme || "",
            coachName: ticket.assignedOwner || "",
            coachEmail: "",
            lastSessionDate: ticket.attendanceDate || "",
            periodDate: ticket.attendanceDate || "",
            status: "Active",
            riskCategories: ["missed-session"],
            hasAttendanceInWindow: true,
            lastSessionStatus: "Missed",
          },
          source: "attendance-ticket",
          ticketId: ticket.id,
        },
      });
    },
    [navigate]
  );

  const uploadFiles = async (ticketId: number, files: File[]) => {
    for (const f of files) {
      const fd = new FormData();
      fd.append("file", f);
      await fetch(`/api/attendance-tickets/${ticketId}/files/`, { method: "POST", body: fd });
    }
  };

  const handleCreate = async (form: typeof EMPTY_FORM, pendingFiles: File[]) => {
    const res = await fetch("/api/attendance-tickets/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        learner_email: form.learnerEmail,
        learner_name: form.learnerName,
        learner_phone: form.learnerPhone,
        organisation: form.organisation,
        programme: form.programme,
        attendance_date: form.attendanceDate || null,
        attendance_module: form.attendanceModule,
        risk: form.risk,
        status: form.status,
        assigned_owner: form.assignedOwner,
        action: form.action === "__none__" ? "" : form.action,
        notes: form.notes,
        escalated: form.escalated,
      }),
    });
    if (res.ok) {
      const ticket = await res.json();
      if (pendingFiles.length) await uploadFiles(ticket.id, pendingFiles);
      await loadTickets();
    }
  };

  const handleEdit = async (form: typeof EMPTY_FORM, pendingFiles: File[]) => {
    if (!editTicket) return;
    const res = await fetch(`/api/attendance-tickets/${editTicket.id}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        learner_name: form.learnerName,
        learner_phone: form.learnerPhone,
        organisation: form.organisation,
        programme: form.programme,
        attendance_date: form.attendanceDate || null,
        attendance_module: form.attendanceModule,
        risk: form.risk,
        status: form.status,
        assigned_owner: form.assignedOwner,
        action: form.action === "__none__" ? "" : form.action,
        notes: form.notes,
        escalated: form.escalated,
      }),
    });
    if (res.ok) {
      if (pendingFiles.length) await uploadFiles(editTicket.id, pendingFiles);
      await loadTickets();
    }
  };

  const handleArchive = async (ticket: AttTicket) => {
    await fetch(`/api/attendance-tickets/${ticket.id}/archive/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archive: !ticket.isArchived }),
    });
    await loadTickets();
  };

  const handleDelete = async (ticket: AttTicket) => {
    await fetch(`/api/attendance-tickets/${ticket.id}/`, { method: "DELETE" });
    setDeleteConfirm(null);
    await loadTickets();
  };

  const handleQuickAction = useCallback(
    async (ticketId: number, updates: Record<string, unknown>) => {
      await fetch(`/api/attendance-tickets/${ticketId}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      await loadTickets();
    },
    [loadTickets],
  );

  const weekScopedTickets = useMemo(
    () => tickets.filter((ticket) => ticketDateInWeek(ticket, weekFilter)),
    [tickets, weekFilter],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return weekScopedTickets.filter((t) => {
      if (q && !t.learnerName.toLowerCase().includes(q) && !t.learnerEmail.toLowerCase().includes(q) && !t.ticketRef.toLowerCase().includes(q)) return false;
      if (ragFilter !== "all" && t.risk !== ragFilter) return false;
      if (notesFilter === "has" && !t.notes.trim()) return false;
      if (notesFilter === "missing" && t.notes.trim()) return false;
      if (cardFilter === "open" && isClosedTicketStatus(t.status)) return false;
      if (cardFilter === "resolved" && !isClosedTicketStatus(t.status)) return false;
      return true;
    });
  }, [weekScopedTickets, search, ragFilter, notesFilter, cardFilter]);

  const allCount = weekScopedTickets.length;
  const openCount = weekScopedTickets.filter((t) => !isClosedTicketStatus(t.status)).length;
  const resolvedCount = weekScopedTickets.filter((t) => isClosedTicketStatus(t.status)).length;
  const redCount = weekScopedTickets.filter((t) => t.risk === "red").length;
  const amberCount = weekScopedTickets.filter((t) => t.risk === "amber").length;
  const greenCount = weekScopedTickets.filter((t) => t.risk === "green").length;
  const escalatedCount = weekScopedTickets.filter((t) => t.escalated).length;

  const exportCsv = () => {
    const cols = ["Ticket", "Learner", "Email", "Organisation", "Risk", "Status", "Assigned Owner", "Date", "Created", "Days", "Notes"];
    const rows = filtered.map((t) => [
      t.ticketRef, t.learnerName, t.learnerEmail, t.organisation,
      t.risk, t.status, t.assignedOwner, fmtDate(t.attendanceDate),
      fmtDate(t.createdAt), daysSince(t.createdAt), t.notes.replace(/\n/g, " "),
    ]);
    const csv = [cols, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "attendance-tickets.csv";
    a.click();
  };

  const exportPdf = () => {
    const cols = ["Ticket", "Learner", "Email", "Organisation", "Risk", "Status", "Owner", "Att. Date", "Notes", "Days"];
    const rows = filtered.map((t) => [
      t.ticketRef, t.learnerName, t.learnerEmail, t.organisation || "—",
      t.risk.toUpperCase(), t.status.replace(/_/g, " "), t.assignedOwner || "—",
      fmtDate(t.attendanceDate), t.notes.replace(/\n/g, " ") || "—", String(daysSince(t.createdAt)),
    ]);

    const riskColor = (r: string) =>
      r === "RED" ? "#dc2626" : r === "AMBER" ? "#d97706" : "#16a34a";

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
      <title>Attendance Tickets</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, sans-serif; font-size: 11px; color: #1a1a2e; padding: 24px; }
        header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 16px; border-bottom: 2px solid #14264A; padding-bottom: 10px; }
        header h1 { font-size: 18px; font-weight: 700; color: #14264A; }
        header p { font-size: 10px; color: #6b7280; }
        table { width: 100%; border-collapse: collapse; margin-top: 4px; }
        th { background: #14264A; color: #fff; padding: 7px 8px; text-align: left; font-size: 10px; font-weight: 600; letter-spacing: 0.03em; }
        td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: middle; }
        tr:nth-child(even) td { background: #f9fafb; }
        .risk { display: inline-block; padding: 1px 7px; border-radius: 99px; font-weight: 700; font-size: 9px; color: #fff; }
        @page { margin: 16mm; }
        @media print { body { padding: 0; } }
      </style>
    </head><body>
      <header>
        <div>
          <h1>Attendance Tickets</h1>
          <p>Kent Business College — Engagement Dashboard</p>
        </div>
        <p>Generated: ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} &nbsp;·&nbsp; ${filtered.length} record${filtered.length !== 1 ? "s" : ""}</p>
      </header>
      <table>
        <thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows
            .map(
              (row, ri) =>
                `<tr>${row
                  .map((cell, ci) =>
                    ci === 4
                      ? `<td><span class="risk" style="background:${riskColor(cell)}">${cell}</span></td>`
                      : `<td>${cell}</td>`,
                  )
                  .join("")}</tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </body></html>`;

    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
      win.onload = () => win.print();
    }
  };

  return (
    <AppLayout>
      <div className="min-h-full bg-[#F4F8FC]">
        {/* Header */}
        <div className="border-b border-[#DDE7F0] bg-white px-4 pb-5 pt-4 sm:px-6">
          <BackButton to="/attendance" label="Attendance" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-[#14264A]">Attendance Tickets</h1>
              <p className="mt-0.5 text-sm text-[#5F7288]">Manage and track attendance support cases</p>
            </div>
            <Button onClick={() => setCreateOpen(true)} className="h-9 gap-1.5 rounded-lg bg-[#14264A] text-white hover:bg-[#184D91]">
              <Plus className="h-4 w-4" />
              Create Ticket
            </Button>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          {/* Controls */}
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="relative flex-1" style={{ minWidth: 200 }}>
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8AA0B6]" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tickets, learners, email…"
                className="h-10 rounded-lg border-[#D7E5F3] bg-white pl-9 text-sm" />
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowArchived((v) => !v)}
              className={`h-10 gap-1.5 rounded-lg border-[#DDE7F0] ${showArchived ? "bg-[#14264A] text-white" : "bg-white text-[#24486D]"}`}>
              <Archive className="h-4 w-4" />
              {showArchived ? "Back to Active" : "Archived"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-10 gap-1.5 rounded-lg border-[#DDE7F0] bg-white text-[#24486D]">
                  <Download className="h-4 w-4" />
                  Export
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44 rounded-xl border-[#DDE7F0] p-1.5 shadow-lg">
                <DropdownMenuItem
                  onClick={exportCsv}
                  className="cursor-pointer gap-2 rounded-lg text-[#14264A] hover:bg-[#F0F4F8] focus:bg-[#F0F4F8]"
                >
                  <FileText className="h-4 w-4 text-[#5F7288]" />
                  Export as CSV
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={exportPdf}
                  className="cursor-pointer gap-2 rounded-lg text-[#14264A] hover:bg-[#F0F4F8] focus:bg-[#F0F4F8]"
                >
                  <FileIcon className="h-4 w-4 text-[#5F7288]" />
                  Export as PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Week filter row */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Select value={weekFilter} onValueChange={(v) => setWeekFilter(v as typeof weekFilter)}>
              <SelectTrigger className="h-10 w-auto min-w-[260px] rounded-lg border-[#D7E5F3] bg-white text-sm font-medium text-[#14264A]">
                <CalendarClock className="mr-2 h-4 w-4 text-[#8AA0B6]" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-[#DDE7F0] shadow-xl">
                {WEEK_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="rounded-lg text-sm">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {weekFilter !== "all" && (
              <button
                onClick={() => setWeekFilter("all")}
                className="flex h-10 items-center gap-1.5 rounded-lg border border-[#DDE7F0] bg-white px-3 text-sm text-[#5F7288] hover:bg-[#F0F6FF]"
              >
                <X className="h-3.5 w-3.5" /> Clear Week
              </button>
            )}
            {weekFilter !== "all" && (
              <span className="ml-1 rounded-full bg-[#EEF3FB] px-3 py-1 text-xs font-semibold text-[#1E6ACB]">
                {allCount} ticket{allCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* Summary cards */}
          <div className="mb-5 grid grid-cols-3 gap-3">
            {(
              [
                {
                  key: "all" as const,
                  label: "All Tickets",
                  sub: "Every case",
                  count: allCount,
                  defaultCls: "border-[#DDE7F0] bg-white text-[#14264A]",
                  activeCls: "border-[#14264A] bg-[#14264A] text-white shadow-md",
                },
                {
                  key: "open" as const,
                  label: "Open Tickets",
                  sub: "Active cases",
                  count: openCount,
                  defaultCls: "border-green-300 bg-green-50 text-green-900",
                  activeCls: "border-green-600 bg-green-600 text-white shadow-md",
                },
                {
                  key: "resolved" as const,
                  label: "Closed / Covered",
                  sub: "Closed cases",
                  count: resolvedCount,
                  defaultCls: "border-[#DDE7F0] bg-white text-[#14264A]",
                  activeCls: "border-violet-600 bg-violet-600 text-white shadow-md",
                },
              ] as const
            ).map(({ key, label, sub, count, defaultCls, activeCls }) => {
              const isActive = cardFilter === key;
              return (
                <button
                  key={key}
                  onClick={() => setCardFilter(isActive ? "all" : key)}
                  className={`w-full rounded-xl border p-3 text-left transition-all duration-150 hover:shadow-sm active:scale-[0.98] ${isActive ? activeCls : defaultCls}`}
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 opacity-60" />
                    <span className="text-xs font-semibold">{label}</span>
                  </div>
                  <p className="mt-1 text-xs opacity-70">{sub}</p>
                  <p className="mt-1 text-2xl font-bold">{count}</p>
                </button>
              );
            })}
          </div>

          {/* RAG filter */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-[#5F7288]">OPEN TICKET RAG</span>
            {(["all", "red", "amber", "green"] as const).map((r) => {
              const cnt = r === "all" ? openCount : weekScopedTickets.filter((t) => t.risk === r && !isClosedTicketStatus(t.status)).length;
              const active = ragFilter === r;
              const colors: Record<string, string> = { all: "bg-[#14264A] text-white border-[#14264A]", red: "bg-red-600 text-white border-red-600", amber: "bg-amber-500 text-white border-amber-500", green: "bg-green-600 text-white border-green-600" };
              return (
                <button key={r} onClick={() => setRagFilter(r)}
                  className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition-all ${active ? colors[r] : "border-[#DDE7F0] bg-white text-[#5F7288] hover:bg-[#EEF7FF]"}`}>
                  {r === "all" ? `All Tickets ${cnt}` : `${r.charAt(0).toUpperCase() + r.slice(1)} ${cnt}`}
                </button>
              );
            })}
          </div>

          {/* Notes filter */}
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-[#5F7288]">NOTES / EVIDENCE</span>
            {(["all", "has", "missing"] as const).map((f) => {
              const labels = { all: "All", has: `Has notes ${weekScopedTickets.filter((t) => t.notes.trim()).length}`, missing: `Missing notes ${weekScopedTickets.filter((t) => !t.notes.trim()).length}` };
              return (
                <button key={f} onClick={() => setNotesFilter(f)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition-all ${notesFilter === f ? "border-[#14264A] bg-[#14264A] text-white" : "border-[#DDE7F0] bg-white text-[#5F7288] hover:bg-[#EEF7FF]"}`}>
                  {labels[f]}
                </button>
              );
            })}
          </div>

          {/* Stats */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              { label: "Open Tickets", val: openCount, icon: <Filter className="h-4 w-4" /> },
              { label: "Red Risk", val: redCount, icon: <AlertTriangle className="h-4 w-4 text-red-500" /> },
              { label: "Amber Risk", val: amberCount, icon: <AlertTriangle className="h-4 w-4 text-amber-500" /> },
              { label: "Green Risk", val: greenCount, icon: <CheckCircle2 className="h-4 w-4 text-green-600" /> },
              { label: "Escalated", val: escalatedCount, icon: <AlertTriangle className="h-4 w-4 text-orange-500" /> },
            ].map(({ label, val, icon }) => (
              <div key={label} className="flex items-center gap-3 rounded-xl border border-[#DDE7F0] bg-white p-3">
                {icon}
                <div><p className="text-xs font-medium text-[#5F7288]">{label}</p><p className="text-xl font-bold text-[#14264A]">{val}</p></div>
              </div>
            ))}
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-xl border border-[#DDE7F0] bg-white shadow-sm">
            {loading ? (
              <div className="flex h-40 items-center justify-center text-sm text-[#5F7288]">Loading tickets…</div>
            ) : filtered.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-[#5F7288]">
                <CheckCircle2 className="h-8 w-8 text-[#C5D5E3]" /><p>No tickets found</p>
              </div>
            ) : (
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full min-w-[1120px] text-sm">
                  <thead>
                    <tr className="sticky top-0 z-10 border-b border-[#DDE7F0] bg-[#F8FBFE]">
                      {["Ticket", "Learner", "Attendance history", "Risk", "Status", "Assigned Owner", "Created", "Days", "Notes", "Evidence", "Actions", "Edit", "Archive", "View"].map((h) => (
                        <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-[#5F7288]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t) => (
                      <tr key={t.id} className="border-b border-[#F0F4F8] transition-colors hover:bg-[#F8FBFE]">
                        <td className="px-3 py-3"><span className="font-mono text-xs font-semibold text-[#1E6ACB]">{t.ticketRef}</span></td>
                        <td className="px-3 py-3">
                          <p className="font-semibold text-[#14264A]">{t.learnerName}</p>
                          <p className="text-xs text-[#71849A]">{t.learnerEmail}</p>
                        </td>
                        <td className="px-3 py-3">
                          {(() => {
                            const attendanceHistoryUrl = getAttendanceHistoryUrl(t.learnerEmail);

                            return attendanceHistoryUrl ? (
                              <a
                                href={attendanceHistoryUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-[#1E6ACB] hover:bg-[#EEF7FF]"
                              >
                                <History className="h-3.5 w-3.5" />
                                Attendance History
                              </a>
                            ) : (
                              <button
                                type="button"
                                disabled
                                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-[#A0B0C0]"
                              >
                                <History className="h-3.5 w-3.5" />
                                Attendance History
                              </button>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-3">{riskBadge(t.risk)}</td>
                        <td className="px-3 py-3">{statusBadge(t.status)}</td>
                        <td className="px-3 py-3 text-xs text-[#5F7288]">{t.assignedOwner || <span className="italic text-[#A0B0C0]">Unassigned</span>}</td>
                        <td className="px-3 py-3 text-xs text-[#5F7288]">{fmtDate(t.createdAt)}</td>
                        <td className="px-3 py-3 text-xs font-semibold text-[#14264A]">{daysSince(t.createdAt)}</td>
                        <td className="px-3 py-3">
                          {(() => {
                            const count = t.notes.split("\n").filter((l) => l.trim()).length;
                            return count > 0 ? (
                              <button
                                onClick={() => setNotesTicket(t)}
                                className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700 hover:bg-green-100"
                              >
                                <MessageSquare className="h-3 w-3" />
                                {count} {count === 1 ? "note" : "notes"}
                              </button>
                            ) : (
                              <span className="text-xs text-[#A0B0C0]">—</span>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-3">
                          {t.evidenceCount > 0 ? (
                            <button
                              onClick={() => setEvidenceTicket(t)}
                              className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                            >
                              <Paperclip className="h-3 w-3" /> {t.evidenceCount} {t.evidenceCount === 1 ? "file" : "files"}
                            </button>
                          ) : (
                            <span className="text-xs text-[#A0B0C0]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1">
                            {t.escalated && (
                              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
                                Escalated
                              </span>
                            )}
                            {t.action === "emailed" && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                                <Mail className="h-3 w-3" />
                                Emailed
                              </span>
                            )}
                            <TicketActionsMenu
                              ticket={t}
                              onAddNote={() => setAddNoteTicket(t)}
                              onAddEvidence={() => setQuickEvidenceTicket(t)}
                              onEmail={() => handleEmailTicket(t)}
                              onQuickAction={handleQuickAction}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <button onClick={() => setEditTicket(t)} className="rounded px-2 py-1 text-xs font-semibold text-[#1E6ACB] hover:bg-[#EEF7FF]">Edit</button>
                        </td>
                        <td className="px-3 py-3">
                          <button onClick={() => handleArchive(t)}
                            className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold ${t.isArchived ? "text-green-700 hover:bg-green-50" : "text-[#5F7288] hover:bg-[#F0F4F8]"}`}>
                            <Archive className="h-3.5 w-3.5" />
                            {t.isArchived ? "Restore" : "Archive"}
                          </button>
                          {t.isArchived && (
                            <button onClick={() => setDeleteConfirm(t)}
                              className="mt-1 flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">
                              <Trash2 className="h-3.5 w-3.5" /> Delete
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <button onClick={() => setViewTicket(t)} className="rounded px-2 py-1 text-xs font-semibold text-[#1E6ACB] hover:bg-[#EEF7FF]">View</button>
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

      {/* Create modal */}
      <TicketFormModal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setCreatePrefill(undefined); }}
        onSave={handleCreate}
        initial={createPrefill}
      />

      {/* Edit modal */}
      <TicketFormModal
        open={Boolean(editTicket)}
        onClose={() => setEditTicket(null)}
        onSave={handleEdit}
        ticketId={editTicket?.id}
        initial={editTicket ? {
          learnerEmail: editTicket.learnerEmail,
          learnerName: editTicket.learnerName,
          learnerPhone: editTicket.learnerPhone,
          organisation: editTicket.organisation,
          programme: editTicket.programme,
          attendanceDate: editTicket.attendanceDate ?? "",
          attendanceModule: editTicket.attendanceModule,
          risk: editTicket.risk,
          status: editTicket.status,
          assignedOwner: editTicket.assignedOwner,
          action: (editTicket.action || "") as TicketAction,
          notes: editTicket.notes,
          escalated: editTicket.escalated,
        } : undefined}
      />

      {/* View modal */}
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
                {[
                  ["Learner", `${viewTicket.learnerName}`],
                  ["Email", viewTicket.learnerEmail],
                  ["Phone", viewTicket.learnerPhone || "—"],
                  ["Organisation", viewTicket.organisation || "—"],
                  ["Programme", viewTicket.programme || "—"],
                  ["Attendance Date", fmtDate(viewTicket.attendanceDate)],
                  ["Assigned Owner", viewTicket.assignedOwner || "Unassigned"],
                  ["Action Taken", ACTION_OPTIONS.find((o) => o.value === viewTicket.action)?.label || "—"],
                  ["Created By", `${viewTicket.createdBy} · ${fmtDate(viewTicket.createdAt)}`],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p className="text-xs font-semibold text-[#71849A]">{k}</p>
                    <p className="mt-0.5 text-sm text-[#14264A]">{v}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                {statusBadge(viewTicket.status)}
                {viewTicket.escalated && <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-700">Escalated</span>}
              </div>
              {viewTicket.notes && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-[#71849A]">Notes</p>
                  <p className="whitespace-pre-wrap rounded-lg bg-[#F8FBFE] p-3 text-xs text-[#14264A]">{viewTicket.notes}</p>
                </div>
              )}
              <div>
                <p className="mb-2 text-xs font-semibold text-[#71849A]">Evidence Files</p>
                <EvidenceViewer ticketId={viewTicket.id} />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Case Notes Modal */}
      {notesTicket && <CaseNotesModal ticket={notesTicket} onClose={() => setNotesTicket(null)} />}

      {/* Evidence Files Modal */}
      {evidenceTicket && <EvidenceFilesModal ticket={evidenceTicket} onClose={() => setEvidenceTicket(null)} />}

      {/* Add Note Modal */}
      {addNoteTicket && (
        <AddNoteModal
          ticket={addNoteTicket}
          onClose={() => setAddNoteTicket(null)}
          onSaved={loadTickets}
        />
      )}

      {/* Quick Evidence Upload Modal */}
      {quickEvidenceTicket && (
        <QuickEvidenceModal
          ticket={quickEvidenceTicket}
          onClose={() => setQuickEvidenceTicket(null)}
          onSaved={loadTickets}
        />
      )}

      {/* Delete confirm */}
      <Dialog open={Boolean(deleteConfirm)} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm rounded-xl border-[#DDE7F0]">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-[#14264A]">Permanently Delete Ticket?</DialogTitle>
          </DialogHeader>
          <p className="mt-2 text-sm text-[#5F7288]">
            This will permanently delete <strong>{deleteConfirm?.ticketRef}</strong> and all attached files. This cannot be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)} className="rounded-lg">Cancel</Button>
            <Button onClick={() => deleteConfirm && handleDelete(deleteConfirm)} className="rounded-lg bg-red-600 text-white hover:bg-red-700">
              <Trash2 className="mr-1.5 h-4 w-4" />
              Delete Permanently
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
