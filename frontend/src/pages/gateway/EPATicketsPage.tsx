import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Archive,
  Award,
  CheckCircle2,
  Download,
  Edit,
  Eye,
  EyeOff,
  FileText,
  Info,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Ticket,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import BackButton from "@/components/BackButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type EPATicket = {
  id: number;
  ticketRef: string;
  learnerEmail: string;
  learnerName: string;
  learnerPhone: string;
  organisation: string;
  programme: string;
  coachName: string;
  endDate: string | null;
  daysOverdue: number;
  risk: "red" | "amber" | "green";
  status: "new" | "open" | "resolved";
  assignedOwner: string;
  action: string;
  notes: string;
  isArchived: boolean;
  escalated: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  evidenceCount: number;
};

type EvidenceFile = {
  id: number;
  name: string;
  url: string;
  mimeType: string;
  uploadedAt: string;
};

const riskColor: Record<EPATicket["risk"], string> = {
  red: "bg-red-100 text-red-700",
  amber: "bg-amber-100 text-amber-700",
  green: "bg-green-100 text-green-700",
};

const statusColor: Record<EPATicket["status"], string> = {
  new: "bg-slate-100 text-slate-700",
  open: "bg-blue-100 text-blue-700",
  resolved: "bg-green-100 text-green-700",
};

const DaysOverdueHeader = () => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="inline-flex cursor-help items-center gap-1">
        Days Overdue
        <Info className="h-3.5 w-3.5 text-[#8A4DFF]" />
      </span>
    </TooltipTrigger>
    <TooltipContent side="top" align="center" sideOffset={12} className="w-64 whitespace-normal rounded-lg border border-[#1F2937] bg-[#111827] px-3 py-2 text-left text-xs font-semibold leading-relaxed text-white shadow-none">
      Number of days past the learner's EPA End-Date.
    </TooltipContent>
  </Tooltip>
);

const actionLabel: Record<string, string> = {
  called: "Called",
  emailed: "Emailed",
  epa_booked: "EPA Booked",
  referred_support: "Referred to Support",
  no_action: "No Action Required",
};

const fmtDate = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const noteLines = (notes: string) => String(notes || "").split("\n").filter((line) => line.trim());
const noteCount = (notes: string) => noteLines(notes).length;

const currentOwner = (user: ReturnType<typeof useAuth>["user"]) =>
  user?.fullName || user?.email || user?.username || "Current user";

const EPA_STATUS_LABELS: Record<string, string> = {
  new: "New", open: "Open", resolved: "Resolved",
};

function ModalShell({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className={`max-h-[90vh] w-full overflow-hidden rounded-2xl bg-white shadow-2xl ${wide ? "max-w-3xl" : "max-w-lg"}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#DDE7F0] bg-[#F8FBFE] px-5 py-4">
          <h2 className="text-base font-bold text-[#14264A]">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[#71849A] hover:bg-white hover:text-[#14264A]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[calc(90vh-64px)] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#DDE7F0] bg-[#F8FBFE] p-3">
      <p className="text-[11px] font-semibold text-[#71849A]">{label}</p>
      <div className="mt-1 text-sm font-semibold text-[#14264A]">{value || "-"}</div>
    </div>
  );
}

function ViewTicketModal({ ticket, onClose }: { ticket: EPATicket; onClose: () => void }) {
  return (
    <ModalShell title={`${ticket.ticketRef} - ${ticket.learnerName}`} onClose={onClose} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <InfoTile label="Learner" value={ticket.learnerName} />
        <InfoTile label="Email" value={ticket.learnerEmail} />
        <InfoTile label="Phone" value={ticket.learnerPhone || "-"} />
        <InfoTile label="Organisation" value={ticket.organisation || "-"} />
        <InfoTile label="Programme" value={ticket.programme || "-"} />
        <InfoTile label="Coach" value={ticket.coachName || "-"} />
        <InfoTile label="End-Date" value={fmtDate(ticket.endDate)} />
        <InfoTile label="Days Overdue" value={`${ticket.daysOverdue}d`} />
        <InfoTile label="Assigned Owner" value={ticket.assignedOwner || "Unassigned"} />
        <InfoTile label="Action" value={actionLabel[ticket.action] || ticket.action || "-"} />
      </div>
      <div className="mt-4 rounded-xl border border-[#DDE7F0] bg-white p-4">
        <p className="text-xs font-bold text-[#71849A]">Notes</p>
        <div className="mt-2 whitespace-pre-wrap text-sm text-[#14264A]">{ticket.notes || "No notes yet."}</div>
      </div>
    </ModalShell>
  );
}

function EditTicketModal({ ticket, onClose, onSave }: { ticket: EPATicket; onClose: () => void; onSave: (ticket: EPATicket, data: Partial<EPATicket>) => Promise<void> }) {
  const [form, setForm] = useState({
    risk: ticket.risk,
    status: ticket.status,
    assignedOwner: ticket.assignedOwner,
    action: ticket.action,
    endDate: ticket.endDate || "",
    daysOverdue: String(ticket.daysOverdue || 0),
    notes: ticket.notes,
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await onSave(ticket, {
      risk: form.risk as EPATicket["risk"],
      status: form.status as EPATicket["status"],
      assignedOwner: form.assignedOwner,
      action: form.action,
      endDate: form.endDate || null,
      daysOverdue: Number(form.daysOverdue || 0),
      notes: form.notes,
    });
    setSaving(false);
    onClose();
  };

  return (
    <ModalShell title={`Edit ${ticket.ticketRef}`} onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-xs font-semibold text-[#24486D]">
          Risk
          <select value={form.risk} onChange={(e) => setForm((p) => ({ ...p, risk: e.target.value as EPATicket["risk"] }))} className="h-10 w-full rounded-lg border border-[#D7E5F3] bg-white px-3 text-sm">
            <option value="red">Red</option>
            <option value="amber">Amber</option>
            <option value="green">Green</option>
          </select>
        </label>
        <label className="space-y-1.5 text-xs font-semibold text-[#24486D]">
          Status
          <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as EPATicket["status"] }))} className="h-10 w-full rounded-lg border border-[#D7E5F3] bg-white px-3 text-sm">
            <option value="new">New</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
          </select>
        </label>
        <label className="space-y-1.5 text-xs font-semibold text-[#24486D]">
          Assigned Owner
          <Input value={form.assignedOwner} onChange={(e) => setForm((p) => ({ ...p, assignedOwner: e.target.value }))} className="h-10 rounded-lg border-[#D7E5F3]" />
        </label>
        <label className="space-y-1.5 text-xs font-semibold text-[#24486D]">
          Action
          <select value={form.action} onChange={(e) => setForm((p) => ({ ...p, action: e.target.value }))} className="h-10 w-full rounded-lg border border-[#D7E5F3] bg-white px-3 text-sm">
            <option value="">None</option>
            <option value="called">Called</option>
            <option value="emailed">Emailed</option>
            <option value="epa_booked">EPA Booked</option>
            <option value="referred_support">Referred to Support</option>
            <option value="no_action">No Action Required</option>
          </select>
        </label>
        <label className="space-y-1.5 text-xs font-semibold text-[#24486D]">
          End-Date
          <Input type="date" value={form.endDate} onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))} className="h-10 rounded-lg border-[#D7E5F3]" />
        </label>
        <label className="space-y-1.5 text-xs font-semibold text-[#24486D]">
          Days Overdue
          <Input type="number" value={form.daysOverdue} onChange={(e) => setForm((p) => ({ ...p, daysOverdue: e.target.value }))} className="h-10 rounded-lg border-[#D7E5F3]" />
        </label>
      </div>
      <label className="mt-3 block space-y-1.5 text-xs font-semibold text-[#24486D]">
        Notes
        <textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className="min-h-28 w-full rounded-lg border border-[#D7E5F3] bg-white p-3 text-sm text-[#14264A]" />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => void save()} disabled={saving} className="bg-[#14264A] text-white hover:bg-[#1E3A6A]">
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </ModalShell>
  );
}

function NotesModal({ ticket, onClose, onSave }: { ticket: EPATicket; onClose: () => void; onSave: (ticket: EPATicket, note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!note.trim()) return;
    setSaving(true);
    await onSave(ticket, note.trim());
    setSaving(false);
    onClose();
  };

  return (
    <ModalShell title={`Notes - ${ticket.ticketRef}`} onClose={onClose}>
      <div className="space-y-2">
        {noteLines(ticket.notes).length ? noteLines(ticket.notes).map((line, index) => (
          <div key={index} className="rounded-xl border border-[#DDE7F0] bg-[#F8FBFE] p-3 text-sm text-[#14264A]">{line}</div>
        )) : <p className="rounded-xl bg-[#F8FBFE] p-4 text-sm text-[#71849A]">No notes added yet.</p>}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add a note..."
        className="mt-4 min-h-28 w-full rounded-xl border border-[#D7E5F3] bg-white p-3 text-sm text-[#14264A]"
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => void save()} disabled={saving || !note.trim()} className="bg-[#14264A] text-white hover:bg-[#1E3A6A]">
          Add Note
        </Button>
      </div>
    </ModalShell>
  );
}

function EvidenceModal({ ticket, onClose, onUploaded, assignOwner }: { ticket: EPATicket; onClose: () => void; onUploaded: () => Promise<void>; assignOwner: (ticket: EPATicket) => Promise<void> }) {
  const [files, setFiles] = useState<EvidenceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState<EvidenceFile | null>(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/epa-tickets/${ticket.id}/files/`);
      setFiles(res.ok ? await res.json() : []);
    } finally {
      setLoading(false);
    }
  }, [ticket.id]);

  useEffect(() => { void loadFiles(); }, [loadFiles]);

  const upload = async (selected: FileList | null) => {
    const selectedFiles = Array.from(selected || []);
    if (!selectedFiles.length) return;
    setUploading(true);
    await assignOwner(ticket);
    for (const file of selectedFiles) {
      const data = new FormData();
      data.append("file", file);
      await fetch(`/api/epa-tickets/${ticket.id}/files/`, { method: "POST", body: data });
    }
    await loadFiles();
    await onUploaded();
    setUploading(false);
  };

  const remove = async (fileId: number) => {
    if (previewFile?.id === fileId) {
      setPreviewFile(null);
      if (previewBlobUrl) { URL.revokeObjectURL(previewBlobUrl); setPreviewBlobUrl(null); }
    }
    await fetch(`/api/epa-tickets/${ticket.id}/files/${fileId}/`, { method: "DELETE" });
    await loadFiles();
    await onUploaded();
  };

  const fetchBlob = async (file: EvidenceFile): Promise<string> => {
    const res = await fetch(file.url);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  };

  const togglePreview = async (file: EvidenceFile) => {
    if (previewFile?.id === file.id) {
      if (previewBlobUrl) { URL.revokeObjectURL(previewBlobUrl); setPreviewBlobUrl(null); }
      setPreviewFile(null);
      return;
    }
    if (previewBlobUrl) { URL.revokeObjectURL(previewBlobUrl); setPreviewBlobUrl(null); }
    setPreviewFile(file);
    setPreviewLoading(true);
    const blobUrl = await fetchBlob(file);
    setPreviewBlobUrl(blobUrl);
    setPreviewLoading(false);
  };

  const downloadFile = async (file: EvidenceFile) => {
    const blobUrl = await fetchBlob(file);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(blobUrl);
  };

  const isImage = (f: EvidenceFile) => f.mimeType?.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(f.name);
  const isPdf = (f: EvidenceFile) => f.mimeType === "application/pdf" || /\.pdf$/i.test(f.name);

  return (
    <ModalShell title={`Evidence - ${ticket.ticketRef}`} onClose={onClose} wide>
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#B8D7F2] bg-[#F8FBFE] px-4 py-6 text-center hover:bg-[#EEF7FF]">
        <UploadCloud className="h-8 w-8 text-[#315D93]" />
        <span className="text-sm font-semibold text-[#14264A]">{uploading ? "Uploading..." : "Upload images or files"}</span>
        <span className="text-xs text-[#71849A]">Images, PDF, Word, Excel, text and CSV files are accepted</span>
        <input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" className="hidden" onChange={(e) => void upload(e.target.files)} />
      </label>

      <div className="mt-4 space-y-2">
        {loading ? (
          <p className="text-sm text-[#71849A]">Loading files...</p>
        ) : files.length ? files.map((file) => (
          <div key={file.id} className="overflow-hidden rounded-xl border border-[#DDE7F0] bg-white">
            <div className="flex items-center gap-3 p-3">
              <Paperclip className="h-4 w-4 shrink-0 text-[#315D93]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[#14264A]">{file.name}</p>
                <p className="text-[11px] text-[#71849A]">{fmtDate(file.uploadedAt)}</p>
              </div>
              <button
                onClick={() => void togglePreview(file)}
                title={previewFile?.id === file.id ? "Close preview" : "Preview"}
                className={`rounded-lg p-1.5 transition-colors ${previewFile?.id === file.id ? "bg-[#EEF7FF] text-[#1E6ACB]" : "text-[#1E6ACB] hover:bg-[#EEF7FF]"}`}
              >
                {previewFile?.id === file.id ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <button
                onClick={() => void downloadFile(file)}
                title="Download"
                className="rounded-lg p-1.5 text-[#315D93] hover:bg-[#EEF3FB]"
              >
                <Download className="h-4 w-4" />
              </button>
              <button onClick={() => void remove(file.id)} title="Delete" className="rounded-lg p-1.5 text-red-500 hover:bg-red-50">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

          </div>
        )) : (
          <p className="rounded-xl bg-[#F8FBFE] p-4 text-sm text-[#71849A]">No evidence files uploaded yet.</p>
        )}
      </div>

      {previewFile && (
        <div
          className="fixed inset-0 z-[200] bg-black/75 p-3"
          onClick={() => { if (previewBlobUrl) { URL.revokeObjectURL(previewBlobUrl); setPreviewBlobUrl(null); } setPreviewFile(null); }}
        >
          <div
            className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* header */}
            <div className="flex shrink-0 items-center justify-between border-b border-[#DDE7F0] bg-[#F8FBFE] px-5 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <Paperclip className="h-4 w-4 shrink-0 text-[#315D93]" />
                <span className="truncate text-sm font-bold text-[#14264A]">{previewFile.name}</span>
              </div>
              <div className="ml-3 flex shrink-0 items-center gap-2">
                <button
                  onClick={() => void downloadFile(previewFile)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#D7E5F3] bg-white px-3 py-1.5 text-xs font-semibold text-[#315D93] hover:bg-[#EEF3FB]"
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </button>
                <button
                  onClick={() => { if (previewBlobUrl) { URL.revokeObjectURL(previewBlobUrl); setPreviewBlobUrl(null); } setPreviewFile(null); }}
                  className="rounded-lg p-1.5 text-[#71849A] hover:bg-slate-100 hover:text-[#14264A]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* body — min-h-0 is required so flex-1 can shrink and iframe fills remaining space */}
            <div className="min-h-0 flex-1 bg-[#1a1a2e]">
              {previewLoading ? (
                <div className="flex h-full items-center justify-center text-sm text-white/60">Loading preview...</div>
              ) : previewBlobUrl && isImage(previewFile) ? (
                <div className="flex h-full items-center justify-center p-4">
                  <img src={previewBlobUrl} alt={previewFile.name} className="max-h-full max-w-full rounded-lg object-contain" />
                </div>
              ) : previewBlobUrl && isPdf(previewFile) ? (
                <iframe src={previewBlobUrl} title={previewFile.name} className="block h-full w-full border-0" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <FileText className="h-12 w-12 text-white/30" />
                  <p className="text-sm text-white/60">Preview not available for this file type.</p>
                  <button
                    onClick={() => void downloadFile(previewFile)}
                    className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#14264A] hover:bg-[#F0F4F8]"
                  >
                    <Download className="h-4 w-4" /> Download to view
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

function CreateTicketModal({ onClose, onCreated, initialName = "", initialEmail = "" }: { onClose: () => void; onCreated: () => Promise<void>; initialName?: string; initialEmail?: string }) {
  const [form, setForm] = useState({
    learnerName: initialName,
    learnerEmail: initialEmail,
    learnerPhone: "",
    organisation: "",
    programme: "",
    coachName: "",
    endDate: "",
    daysOverdue: "0",
    risk: "red" as EPATicket["risk"],
    status: "new" as EPATicket["status"],
    assignedOwner: "",
    action: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!form.learnerName.trim() || !form.learnerEmail.trim()) {
      setError("Learner name and email are required.");
      return;
    }
    setSaving(true);
    setError("");
    const res = await fetch("/api/epa-tickets/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        learner_name: form.learnerName,
        learner_email: form.learnerEmail,
        learner_phone: form.learnerPhone,
        organisation: form.organisation,
        programme: form.programme,
        coach_name: form.coachName,
        end_date: form.endDate || null,
        days_overdue: Number(form.daysOverdue || 0),
        risk: form.risk,
        status: form.status,
        assigned_owner: form.assignedOwner,
        action: form.action,
        notes: form.notes,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body?.detail || "Failed to create ticket. Please try again.");
      return;
    }
    await onCreated();
    onClose();
  };

  const field = (label: string, key: keyof typeof form, type = "text") => (
    <label className="space-y-1.5 text-xs font-semibold text-[#24486D]">
      {label}
      <Input
        type={type}
        value={form[key] as string}
        onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
        className="h-10 rounded-lg border-[#D7E5F3]"
      />
    </label>
  );

  return (
    <ModalShell title="Create New Ticket" onClose={onClose} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        {field("Learner Name *", "learnerName")}
        {field("Learner Email *", "learnerEmail", "email")}
        {field("Learner Phone", "learnerPhone")}
        {field("Organisation", "organisation")}
        {field("Programme", "programme")}
        {field("Coach Name", "coachName")}
        {field("End-Date", "endDate", "date")}
        {field("Days Overdue", "daysOverdue", "number")}
        <label className="space-y-1.5 text-xs font-semibold text-[#24486D]">
          Risk
          <select value={form.risk} onChange={(e) => setForm((p) => ({ ...p, risk: e.target.value as EPATicket["risk"] }))} className="h-10 w-full rounded-lg border border-[#D7E5F3] bg-white px-3 text-sm">
            <option value="red">Red</option>
            <option value="amber">Amber</option>
            <option value="green">Green</option>
          </select>
        </label>
        <label className="space-y-1.5 text-xs font-semibold text-[#24486D]">
          Status
          <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as EPATicket["status"] }))} className="h-10 w-full rounded-lg border border-[#D7E5F3] bg-white px-3 text-sm">
            <option value="new">New</option>
            <option value="open">Open</option>
          </select>
        </label>
        {field("Assigned Owner", "assignedOwner")}
        <label className="space-y-1.5 text-xs font-semibold text-[#24486D]">
          Action
          <select value={form.action} onChange={(e) => setForm((p) => ({ ...p, action: e.target.value }))} className="h-10 w-full rounded-lg border border-[#D7E5F3] bg-white px-3 text-sm">
            <option value="">None</option>
            <option value="called">Called</option>
            <option value="emailed">Emailed</option>
            <option value="epa_booked">EPA Booked</option>
            <option value="referred_support">Referred to Support</option>
            <option value="no_action">No Action Required</option>
          </select>
        </label>
      </div>
      <label className="mt-3 block space-y-1.5 text-xs font-semibold text-[#24486D]">
        Notes
        <textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className="min-h-24 w-full rounded-lg border border-[#D7E5F3] bg-white p-3 text-sm text-[#14264A]" />
      </label>
      {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => void save()} disabled={saving} className="gap-2 bg-[#14264A] text-white hover:bg-[#1E3A6A]">
          <Plus className="h-4 w-4" /> {saving ? "Creating..." : "Create Ticket"}
        </Button>
      </div>
    </ModalShell>
  );
}

function EPATicketActionsMenu({
  ticket,
  onPatch,
  onAddNote,
  onAddEvidence,
}: {
  ticket: EPATicket;
  onPatch: (ticket: EPATicket, data: Partial<EPATicket>) => void;
  onAddNote: (ticket: EPATicket) => void;
  onAddEvidence: (ticket: EPATicket) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-8 w-8 items-center justify-center rounded-lg text-[#5F7288] hover:bg-[#EEF3FB] hover:text-[#315D93]">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 border-[#DDE7F0]">
        <div className="px-2 py-1.5 text-xs font-semibold text-[#5F7288]">
          {ticket.ticketRef} - {ticket.learnerName}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onPatch(ticket, { status: "open" })} className="gap-2">
          <RotateCcw className="h-4 w-4 text-blue-600" /> Open / Set Active
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPatch(ticket, { status: "resolved", action: "epa_booked" })} className="gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-600" /> Mark EPA Booked
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onAddNote(ticket)} className="gap-2">
          <MessageSquare className="h-4 w-4 text-green-700" /> Add Note
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAddEvidence(ticket)} className="gap-2">
          <Paperclip className="h-4 w-4 text-blue-700" /> Add Evidence
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#8AA0B6]">Risk Level</div>
        <DropdownMenuItem onClick={() => onPatch(ticket, { risk: "red" })} className="gap-2">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 ${ticket.risk === "red" ? "ring-2 ring-red-300" : ""}`} />
          Red {ticket.risk === "red" && <span className="ml-auto text-[10px] text-[#A0B0C0]">current</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPatch(ticket, { risk: "amber" })} className="gap-2">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400 ${ticket.risk === "amber" ? "ring-2 ring-amber-200" : ""}`} />
          Amber {ticket.risk === "amber" && <span className="ml-auto text-[10px] text-[#A0B0C0]">current</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPatch(ticket, { risk: "green" })} className="gap-2">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full bg-green-500 ${ticket.risk === "green" ? "ring-2 ring-green-200" : ""}`} />
          Green {ticket.risk === "green" && <span className="ml-auto text-[10px] text-[#A0B0C0]">current</span>}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onPatch(ticket, { action: "called" })} className="gap-2">
          <CheckCircle2 className="h-4 w-4 text-slate-500" /> Called
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPatch(ticket, { action: "emailed" })} className="gap-2">
          <Mail className="h-4 w-4 text-blue-600" /> Emailed
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPatch(ticket, { action: "referred_support" })} className="gap-2">
          <Plus className="h-4 w-4 text-orange-600" /> Referred to Support
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPatch(ticket, { action: "no_action" })} className="gap-2">
          <CheckCircle2 className="h-4 w-4 text-slate-500" /> No Action Required
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function EPATicketsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tickets, setTickets] = useState<EPATicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<"all" | EPATicket["risk"]>("all");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [viewTicket, setViewTicket] = useState<EPATicket | null>(null);
  const [editTicket, setEditTicket] = useState<EPATicket | null>(null);
  const [notesTicket, setNotesTicket] = useState<EPATicket | null>(null);
  const [evidenceTicket, setEvidenceTicket] = useState<EPATicket | null>(null);
  const syncedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/epa-tickets/?archived=${showArchived}`);
      if (res.ok) setTickets(await res.json());
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  const autoCreate = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/epa-tickets/auto-create/", { method: "POST" });
      if (!res.ok) return;
      await load();
    } finally {
      setSyncing(false);
    }
  }, [load]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const learner = searchParams.get("learner");
    if (learner) setSearch(learner);
    const newFor = searchParams.get("newFor");
    if (newFor) setShowCreateModal(true);
  }, [searchParams]);

  useEffect(() => {
    const learner = searchParams.get("learner");
    if (!learner || loading) return;
    const ticket = tickets.find((item) => item.learnerEmail.toLowerCase() === learner.toLowerCase());
    if (!ticket) return;
    setSearch(ticket.learnerEmail);
    setSearchParams({}, { replace: true });
  }, [loading, searchParams, setSearchParams, tickets]);

  useEffect(() => {
    if (loading || showArchived || syncedRef.current) return;
    syncedRef.current = true;
    void autoCreate();
  }, [autoCreate, loading, showArchived]);

  const patchTicket = useCallback(async (ticket: EPATicket, data: Partial<EPATicket>) => {
    const payload: Record<string, unknown> = {};
    if (data.status) payload.status = data.status;
    if (data.action !== undefined) payload.action = data.action;
    if (data.risk) payload.risk = data.risk;
    if (data.assignedOwner !== undefined) payload.assigned_owner = data.assignedOwner;
    if (data.endDate !== undefined) payload.end_date = data.endDate;
    if (data.daysOverdue !== undefined) payload.days_overdue = data.daysOverdue;

    // Auto-append status-change note (only for explicit status-only patches, not when notes are provided)
    let notes = data.notes;
    if (data.status && data.status !== ticket.status && data.notes === undefined) {
      const dateStr = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      const owner = currentOwner(user);
      const note = `[${dateStr}${owner ? ` · ${owner}` : ""}] Status changed from "${EPA_STATUS_LABELS[ticket.status] || ticket.status}" to "${EPA_STATUS_LABELS[data.status] || data.status}"`;
      const existing = ticket.notes?.trim() || "";
      notes = existing ? `${existing}\n${note}` : note;
    }
    if (notes !== undefined) payload.notes = notes;

    const res = await fetch(`/api/epa-tickets/${ticket.id}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const updated = await res.json();
      setTickets((prev) => prev.map((item) => (item.id === ticket.id ? updated : item)));
      setViewTicket((prev) => (prev?.id === ticket.id ? updated : prev));
      setEditTicket((prev) => (prev?.id === ticket.id ? updated : prev));
      setNotesTicket((prev) => (prev?.id === ticket.id ? updated : prev));
      setEvidenceTicket((prev) => (prev?.id === ticket.id ? updated : prev));
    }
  }, [user]);

  const assignIfNeeded = useCallback(async (ticket: EPATicket) => {
    if (ticket.assignedOwner?.trim()) return;
    await patchTicket(ticket, { assignedOwner: currentOwner(user), status: ticket.status === "new" ? "open" : ticket.status });
  }, [patchTicket, user]);

  const addNote = useCallback(async (ticket: EPATicket, note: string) => {
    const owner = currentOwner(user);
    const date = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const entry = `${date} - ${owner}: ${note}`;
    const notes = ticket.notes?.trim() ? `${ticket.notes.trim()}\n${entry}` : entry;
    await patchTicket(ticket, {
      notes,
      assignedOwner: ticket.assignedOwner?.trim() || owner,
      status: ticket.status === "new" ? "open" : ticket.status,
    });
  }, [patchTicket, user]);

  const archiveToggle = async (ticket: EPATicket) => {
    await fetch(`/api/epa-tickets/${ticket.id}/archive/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archive: !ticket.isArchived }),
    });
    await load();
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((ticket) => {
      if (riskFilter !== "all" && ticket.risk !== riskFilter) return false;
      if (!q) return true;
      return [ticket.ticketRef, ticket.learnerName, ticket.learnerEmail, ticket.programme, ticket.coachName, ticket.assignedOwner].some((value) =>
        String(value || "").toLowerCase().includes(q)
      );
    });
  }, [tickets, search, riskFilter]);

  const openCount = tickets.filter((ticket) => ticket.status !== "resolved").length;
  const resolvedCount = tickets.filter((ticket) => ticket.status === "resolved").length;

  return (
    <AppLayout>
      <div className="min-h-full bg-[#F4F8FC]">
        <div className="border-b border-[#DDE7F0] bg-white px-4 pb-5 pt-4 sm:px-6">
          <BackButton to="/gateway" label="Gateway (EPA)" />
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E8F0F9]">
                <Ticket className="h-5 w-5 text-[#315D93]" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-[#14264A]">EPA Ticket System</h1>
                <p className="mt-0.5 text-sm text-[#5F7288]">
                  Track overdue EPA follow-up tickets
                  {syncing && <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">Auto-syncing overdue EPAs...</span>}
                </p>
              </div>
            </div>
            <Button onClick={() => void autoCreate()} variant="outline" className="gap-2">
              <RefreshCw className="h-4 w-4" /> Sync
            </Button>
          </div>
        </div>

        <div className="space-y-4 p-4 sm:p-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              ["All Tickets", tickets.length],
              ["Open Tickets", openCount],
              ["Resolved", resolvedCount],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-[#DDE7F0] bg-white p-4 shadow-sm">
                <p className="text-sm text-[#5F7288]">{label}</p>
                <p className="mt-2 text-2xl font-bold text-[#14264A]">{value}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="flex h-10 min-w-[260px] flex-1 items-center gap-2 rounded-lg border border-[#DDE7F0] bg-white px-3">
              <Search className="h-4 w-4 text-[#8AA0B6]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tickets..."
                className="h-full border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              />
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-[#DDE7F0] bg-white px-2">
              {(["all", "red", "amber", "green"] as const).map((risk) => {
                const isActive = riskFilter === risk;
                const styles: Record<string, string> = {
                  all: isActive ? "bg-[#14264A] text-white" : "text-[#5F7288] hover:bg-[#F0F4F8]",
                  red: isActive ? "bg-red-600 text-white" : "text-red-600 hover:bg-red-50",
                  amber: isActive ? "bg-amber-500 text-white" : "text-amber-600 hover:bg-amber-50",
                  green: isActive ? "bg-green-600 text-white" : "text-green-700 hover:bg-green-50",
                };
                return (
                  <button
                    key={risk}
                    onClick={() => setRiskFilter(risk)}
                    className={`rounded-md px-3 py-1.5 text-xs font-bold uppercase transition-colors ${styles[risk]}`}
                  >
                    {risk === "all" ? "All" : risk}
                  </button>
                );
              })}
            </div>
            <Button variant={showArchived ? "default" : "outline"} onClick={() => setShowArchived((value) => !value)} className="gap-2">
              <Archive className="h-4 w-4" /> {showArchived ? "Archived" : "Archive"}
            </Button>
            <Button onClick={() => setShowCreateModal(true)} className="gap-2 bg-[#14264A] text-white hover:bg-[#1E3A6A]">
              <Plus className="h-4 w-4" /> Create Ticket
            </Button>
          </div>

          <div className="overflow-hidden rounded-xl border border-[#DDE7F0] bg-white shadow-sm">
            {loading ? (
              <div className="flex h-40 items-center justify-center text-sm text-[#5F7288]">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-[#5F7288]">
                <Award className="h-8 w-8 text-[#C5D5E3]" />
                <p>No tickets found</p>
              </div>
            ) : (
              <div className="max-h-[calc(100vh-380px)] overflow-auto">
                <table className="w-full min-w-[1320px] text-sm">
                  <thead>
                    <tr className="border-b border-[#DDE7F0] bg-[#F8FBFE]">
                      {["Ticket", "Learner", "Risk", "Status", "Coach", "End-Date", "Days Overdue", "Assigned Owner", "Notes", "Evidence", "Actions", "Edit", "View", "Archive"].map((head) => (
                        <th key={head} className="sticky top-0 bg-[#F8FBFE] px-4 py-3 text-left text-xs font-semibold text-[#5F7288]">
                          {head === "Days Overdue" ? <DaysOverdueHeader /> : head}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((ticket) => (
                      <tr key={ticket.id} className="border-b border-[#F0F4F8] hover:bg-[#F8FBFE]">
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-[#EEF3FB] px-2 py-0.5 text-[11px] font-bold text-[#315D93]">{ticket.ticketRef}</span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-[#14264A]">{ticket.learnerName}</p>
                          <p className="text-[11px] text-[#71849A]">{ticket.learnerEmail}</p>
                        </td>
                        <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${riskColor[ticket.risk]}`}>{ticket.risk}</span></td>
                        <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${statusColor[ticket.status]}`}>{ticket.status}</span></td>
                        <td className="px-4 py-3 text-xs text-[#5F7288]">{ticket.coachName || "-"}</td>
                        <td className="px-4 py-3 font-semibold text-[#14264A]">{fmtDate(ticket.endDate)}</td>
                        <td className="px-4 py-3"><span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700">{ticket.daysOverdue}d</span></td>
                        <td className="px-4 py-3 text-xs text-[#5F7288]">{ticket.assignedOwner || "-"}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => setNotesTicket(ticket)} className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-1 text-xs font-semibold text-green-700 hover:bg-green-100">
                            <MessageSquare className="h-3 w-3" /> {noteCount(ticket.notes)}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => setEvidenceTicket(ticket)} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100">
                            <Paperclip className="h-3 w-3" /> {ticket.evidenceCount || 0}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <EPATicketActionsMenu
                            ticket={ticket}
                            onPatch={(item, data) => void patchTicket(item, data)}
                            onAddNote={setNotesTicket}
                            onAddEvidence={setEvidenceTicket}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => setEditTicket(ticket)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[#1E6ACB] hover:bg-[#EEF7FF]">
                            <Edit className="h-4 w-4" />
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => {
                              setSearch(ticket.learnerEmail);
                            }}
                            className="text-xs font-bold text-[#1E6ACB] hover:underline"
                          >
                            View
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => void archiveToggle(ticket)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[#5F7288] hover:bg-amber-50 hover:text-amber-700">
                            {showArchived ? <FileText className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
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

      {showCreateModal && (
        <CreateTicketModal
          onClose={() => setShowCreateModal(false)}
          onCreated={load}
          initialEmail={searchParams.get("newFor") || ""}
          initialName={searchParams.get("newName") || ""}
        />
      )}
      {viewTicket && <ViewTicketModal ticket={viewTicket} onClose={() => setViewTicket(null)} />}
      {editTicket && <EditTicketModal ticket={editTicket} onClose={() => setEditTicket(null)} onSave={patchTicket} />}
      {notesTicket && <NotesModal ticket={notesTicket} onClose={() => setNotesTicket(null)} onSave={addNote} />}
      {evidenceTicket && (
        <EvidenceModal
          ticket={evidenceTicket}
          onClose={() => setEvidenceTicket(null)}
          onUploaded={load}
          assignOwner={assignIfNeeded}
        />
      )}
    </AppLayout>
  );
}
