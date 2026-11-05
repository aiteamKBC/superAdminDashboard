import { useCallback, useEffect, useState } from "react";
import { AlertCircle, BookOpenCheck, CheckSquare, ClipboardCheck, Download, RefreshCw } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import BackButton from "@/components/BackButton";
import { Button } from "@/components/ui/button";

interface PendingCoach {
  key: string;
  coach: string;
  totalLearners: number;
  currentLearners: number;
  learnersAwaitingReview: number;
  assignments: number;
  reflections: number;
  total: number;
  oldestSubmittedAt: string | null;
  newestSubmittedAt: string | null;
}

interface Reviewer {
  reviewer: string;
  accepted: number;
  returned: number;
  assignments: number;
  reflections: number;
  total: number;
  days: number[];
  lastReviewedAt: string | null;
}

interface MarkingData {
  asOf: string;
  timezone: string;
  pending: PendingCoach[];
  reviewed: Reviewer[];
  totals: {
    totalLearners: number;
    currentLearners: number;
    learnersAwaitingReview: number;
    pendingAssignments: number;
    pendingReflections: number;
    pending: number;
    accepted: number;
    returned: number;
    reviewed: number;
    reviewedLastEightDays: number;
    lastReviewedAt: string | null;
  };
}

function ukDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London",
  }).format(date);
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const csv = [headers, ...rows].map((row) => row
    .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function MarkingPage() {
  const [data, setData] = useState<MarkingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/lms-marking/", { cache: "no-store" });
      if (!response.ok) throw new Error("LMS marking request failed");
      const result = await response.json() as MarkingData;
      if (!Array.isArray(result.pending) || !Array.isArray(result.reviewed) || !result.totals) {
        throw new Error("Invalid LMS marking response");
      }
      setData(result);
      setError("");
    } catch {
      setData(null);
      setError("Could not load LMS marking. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const exportPending = () => {
    if (!data) return;
    downloadCsv("lms-pending-marking.csv",
      ["Assigned coach", "All LMS learners", "Current LMS learners (Active/Delivery)", "Learners awaiting review", "Assignments", "Reflections", "Total pending", "Oldest submission (UK)", "Newest submission (UK)"],
      data.pending.map((row) => [row.coach, row.totalLearners, row.currentLearners, row.learnersAwaitingReview, row.assignments, row.reflections,
        row.total, ukDate(row.oldestSubmittedAt), ukDate(row.newestSubmittedAt)]));
  };
  const exportDecisions = () => {
    if (!data) return;
    downloadCsv("lms-marking-decisions.csv",
      ["Reviewer", "Accepted", "Returned", "Assignments", "Reflections", "Total decisions", "Last reviewed (UK)"],
      data.reviewed.map((row) => [row.reviewer, row.accepted, row.returned,
        row.assignments, row.reflections, row.total, ukDate(row.lastReviewedAt)]));
  };

  return <AppLayout>
    <div className="min-h-full bg-[#F4F8FC]">
      <div className="border-b border-[#DDE7F0] bg-white px-4 pb-5 pt-4 sm:px-6">
        <BackButton to="/" label="Home" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
              <CheckSquare className="h-5 w-5 text-slate-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#14264A]">Marking</h1>
              <p className="mt-0.5 text-sm text-[#5F7288]">Live LMS submissions and coach decisions</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}
            className="h-9 gap-1.5 rounded-lg border-[#DDE7F0] bg-white text-[#24486D]">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>

      <main className="space-y-6 p-4 sm:p-6">
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {loading && !data ? <div className="rounded-xl border border-[#DDE7F0] bg-white p-10 text-center text-sm text-[#5F7288]">Loading LMS marking…</div>
          : data && <>
            <div>
              <h2 className="text-lg font-bold text-[#14264A]">LMS marking overview</h2>
              <p className="mt-1 text-xs text-[#5F7288]">LMS coach caseload and marking queue · UK time · {data.asOf}</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Metric icon={AlertCircle} title="Awaiting review" value={data.totals.pending} detail={`${data.totals.pendingAssignments} assignments · ${data.totals.pendingReflections} reflections`} />
              <Metric icon={ClipboardCheck} title="Accepted submissions" value={data.totals.accepted} detail="Coach decisions saved in the LMS marking queue" />
              <Metric icon={BookOpenCheck} title="Returned for changes" value={data.totals.returned} detail="Referred or rejected submissions" />
              <Metric icon={CheckSquare} title="Reviewed in last 8 days" value={data.totals.reviewedLastEightDays} detail="Today plus the previous 7 UK calendar days" />
            </div>

            <section aria-labelledby="pending-heading" className="overflow-hidden rounded-xl border border-[#DDE7F0] bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DDE7F0] px-4 py-4 sm:px-5">
                <div>
                  <h2 id="pending-heading" className="text-base font-bold text-[#14264A]">Coach caseload and work awaiting review</h2>
                  <p className="mt-1 text-xs text-[#5F7288]">Same LMS coaches and learner filter as Administrator. Current means Active or Delivery; all includes historical statuses. Awaiting review excludes drafts.</p>
                </div>
                <Button variant="outline" size="sm" onClick={exportPending} disabled={!data.pending.length} className="h-9 gap-1.5">
                  <Download className="h-4 w-4" /> Export pending CSV
                </Button>
              </div>
              {!data.pending.length ? <p className="p-6 text-sm text-[#5F7288]">No LMS learners found.</p>
                : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm">
                  <thead><tr className="border-b border-[#DDE7F0] bg-[#F8FBFE] text-xs text-[#5F7288]">
                    <th className="px-4 py-3 text-left">Assigned coach</th><th className="px-4 py-3 text-right">LMS learners (all statuses)</th>
                    <th className="px-4 py-3 text-right">Current learners</th>
                    <th className="px-4 py-3 text-right">Learners awaiting review</th>
                    <th className="px-4 py-3 text-right">Assignments</th><th className="px-4 py-3 text-right">Reflections</th>
                    <th className="px-4 py-3 text-right">Total pending</th><th className="px-4 py-3 text-right">Oldest submitted</th>
                  </tr></thead>
                  <tbody>{data.pending.map((row) => <tr key={row.key} className="border-b border-[#F0F4F8] hover:bg-[#F8FBFE]">
                    <td className="px-4 py-3 font-semibold text-[#14264A]">{row.coach}</td>
                    <td className="px-4 py-3 text-right">{row.totalLearners}</td>
                    <td className="px-4 py-3 text-right">{row.currentLearners}</td>
                    <td className="px-4 py-3 text-right">{row.learnersAwaitingReview}</td><td className="px-4 py-3 text-right">{row.assignments}</td>
                    <td className="px-4 py-3 text-right">{row.reflections}</td>
                    <td className="px-4 py-3 text-right font-bold text-[#6B2BB7]">{row.total}</td>
                    <td className="px-4 py-3 text-right text-[#5F7288]">{ukDate(row.oldestSubmittedAt)}</td>
                  </tr>)}</tbody>
                  <tfoot><tr className="border-t-2 border-[#DDE7F0] bg-[#F0F6FF] font-bold text-[#14264A]">
                    <td className="px-4 py-3">TOTAL</td><td className="px-4 py-3 text-right">{data.totals.totalLearners}</td>
                    <td className="px-4 py-3 text-right">{data.totals.currentLearners}</td>
                    <td className="px-4 py-3 text-right">{data.totals.learnersAwaitingReview}</td>
                    <td className="px-4 py-3 text-right">{data.totals.pendingAssignments}</td>
                    <td className="px-4 py-3 text-right">{data.totals.pendingReflections}</td>
                    <td className="px-4 py-3 text-right">{data.totals.pending}</td><td className="px-4 py-3 text-right">—</td>
                  </tr></tfoot>
                </table></div>}
            </section>

            <section aria-labelledby="reviewed-heading" className="overflow-hidden rounded-xl border border-[#DDE7F0] bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DDE7F0] px-4 py-4 sm:px-5">
                <div>
                  <h2 id="reviewed-heading" className="text-base font-bold text-[#14264A]">Completed marking decisions</h2>
                  <p className="mt-1 text-xs text-[#5F7288]">Only coach decisions saved in the LMS marking queue are counted here. Imported or automatically completed learning activities are separate from marking.</p>
                </div>
                <Button variant="outline" size="sm" onClick={exportDecisions} disabled={!data.reviewed.length} className="h-9 gap-1.5">
                  <Download className="h-4 w-4" /> Export decisions CSV
                </Button>
              </div>
              {!data.reviewed.length ? <p className="p-6 text-sm text-[#5F7288]">No completed marking decisions yet.</p>
                : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
                  <thead><tr className="border-b border-[#DDE7F0] bg-[#F8FBFE] text-xs text-[#5F7288]">
                    <th className="px-4 py-3 text-left">Reviewer</th><th className="px-4 py-3 text-right">Accepted</th>
                    <th className="px-4 py-3 text-right">Returned</th><th className="px-4 py-3 text-right">Assignments</th>
                    <th className="px-4 py-3 text-right">Reflections</th><th className="px-4 py-3 text-right">Total decisions</th>
                    <th className="px-4 py-3 text-right">Last reviewed</th>
                  </tr></thead>
                  <tbody>{data.reviewed.map((row) => <tr key={row.reviewer} className="border-b border-[#F0F4F8] hover:bg-[#F8FBFE]">
                    <td className="px-4 py-3 font-semibold text-[#14264A]">{row.reviewer}</td>
                    <td className="px-4 py-3 text-right text-emerald-700">{row.accepted}</td>
                    <td className="px-4 py-3 text-right text-amber-700">{row.returned}</td>
                    <td className="px-4 py-3 text-right">{row.assignments}</td><td className="px-4 py-3 text-right">{row.reflections}</td>
                    <td className="px-4 py-3 text-right font-bold">{row.total}</td>
                    <td className="px-4 py-3 text-right text-[#5F7288]">{ukDate(row.lastReviewedAt)}</td>
                  </tr>)}</tbody>
                  <tfoot><tr className="border-t-2 border-[#DDE7F0] bg-[#F0F6FF] font-bold text-[#14264A]">
                    <td className="px-4 py-3">TOTAL</td><td className="px-4 py-3 text-right">{data.totals.accepted}</td>
                    <td className="px-4 py-3 text-right">{data.totals.returned}</td><td className="px-4 py-3 text-right">—</td>
                    <td className="px-4 py-3 text-right">—</td><td className="px-4 py-3 text-right">{data.totals.reviewed}</td>
                    <td className="px-4 py-3 text-right">—</td>
                  </tr></tfoot>
                </table></div>}
            </section>

            {data.totals.reviewedLastEightDays === 0 && <p className="rounded-xl border border-[#DDE7F0] bg-white p-4 text-sm text-[#5F7288]">
              No marking decisions were recorded in the last 8 UK calendar days.
              {data.totals.lastReviewedAt && <> Last recorded decision: <strong className="text-[#14264A]">{ukDate(data.totals.lastReviewedAt)}</strong>.</>}
            </p>}
            {data.totals.reviewedLastEightDays > 0 && <section aria-labelledby="daily-heading" className="overflow-hidden rounded-xl border border-[#DDE7F0] bg-white shadow-sm">
              <h2 id="daily-heading" className="border-b border-[#DDE7F0] px-4 py-4 text-base font-bold text-[#14264A]">Recent decisions by reviewer</h2>
              <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm">
                <thead><tr className="bg-[#F8FBFE] text-xs text-[#5F7288]"><th className="px-4 py-3 text-left">Reviewer</th>
                  {Array.from({ length: 8 }, (_, index) => <th key={index} className="px-3 py-3 text-right">{index === 0 ? "Today" : index === 1 ? "Yesterday" : `${index} days ago`}</th>)}
                </tr></thead>
                <tbody>{data.reviewed.filter((row) => row.days.some(Boolean)).map((row) => <tr key={row.reviewer} className="border-t border-[#F0F4F8]"><td className="px-4 py-3 font-semibold text-[#14264A]">{row.reviewer}</td>
                  {row.days.map((value, index) => <td key={index} className="px-3 py-3 text-right">{value}</td>)}
                </tr>)}</tbody>
              </table></div>
            </section>}
          </>}
      </main>
    </div>
  </AppLayout>;
}

function Metric({ icon: Icon, title, value, detail }: {
  icon: typeof AlertCircle; title: string; value: number; detail: string;
}) {
  return <div className="rounded-xl border border-[#DDE7F0] bg-white p-5 shadow-sm">
    <div className="flex items-center gap-2 text-[#5F7288]"><Icon className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-wide">{title}</span></div>
    <p className="mt-3 text-3xl font-bold text-[#14264A]">{value.toLocaleString()}</p>
    <p className="mt-1 text-xs text-[#71849A]">{detail}</p>
  </div>;
}
