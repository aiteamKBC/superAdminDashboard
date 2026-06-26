import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Award, CalendarClock, ExternalLink, Medal, Search } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import BackButton from "@/components/BackButton";
import { Input } from "@/components/ui/input";

type EPALearner = {
  id: string | number;
  fullName: string;
  email: string;
  phone: string;
  organisation: string;
  programme: string;
  coach: string;
  endDate: string | null;
  daysUntilEnd: number | null;
  daysOverdue: number;
  programStatus: string;
  subscriptionStatus: string;
  otjHoursStatus: string;
};

type EPASummary = {
  closeToEpa: EPALearner[];
  epaOverdue: EPALearner[];
  enteredEpa: EPALearner[];
  closeToEpaCount: number;
  epaOverdueCount: number;
  enteredEpaCount: number;
};

type EPATicketSummary = {
  id: number;
  ticketRef: string;
  learnerEmail: string;
  status: string;
  isArchived: boolean;
};

const fmtDate = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const otjBadge = (status: string) => {
  const s = (status || "").toLowerCase().trim();
  if (s === "at risk") return <span className="inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">At Risk</span>;
  if (s === "need attention") return <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">Need Attention</span>;
  if (s === "on track") return <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">On Track</span>;
  return <span className="text-xs text-[#A0B0C0]">{status || "-"}</span>;
};

export default function EPALearnersPage({ mode }: { mode: "close" | "overdue" | "entered" }) {
  const navigate = useNavigate();
  const [data, setData] = useState<EPASummary | null>(null);
  const [tickets, setTickets] = useState<EPATicketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([
      fetch("/api/epa-summary/").then((res) => res.json()),
      mode === "overdue" ? fetch("/api/epa-tickets/?archived=false").then((res) => res.json()) : Promise.resolve([]),
    ])
      .then(([summary, ticketRows]) => {
        if (!mounted) return;
        setData(summary);
        setTickets(Array.isArray(ticketRows) ? ticketRows : []);
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [mode]);

  const ticketByEmail = useMemo(() => {
    const map = new Map<string, EPATicketSummary>();
    tickets
      .filter((ticket) => !ticket.isArchived && ticket.status !== "resolved")
      .forEach((ticket) => map.set(ticket.learnerEmail.trim().toLowerCase(), ticket));
    return map;
  }, [tickets]);

  const rows =
    mode === "close"
      ? data?.closeToEpa || []
      : mode === "entered"
        ? data?.enteredEpa || []
        : data?.epaOverdue || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.fullName, row.email, row.organisation, row.programme, row.coach].some((value) =>
        String(value || "").toLowerCase().includes(q)
      )
    );
  }, [rows, search]);

  const isClose = mode === "close";
  const isEntered = mode === "entered";
  const Icon = isClose ? CalendarClock : isEntered ? Medal : AlertTriangle;
  const title = isClose ? "Close to EPA" : isEntered ? "Entered EPA" : "EPA Overdue";
  const description = isClose
    ? "Active learners with End-Date in the next 60 days"
    : isEntered
      ? "Learners currently in EPA stage"
      : "Active learners more than 7 days past End-Date";
  const iconTone = isClose
    ? "bg-blue-50 text-blue-700"
    : isEntered
      ? "bg-violet-50 text-violet-700"
      : "bg-amber-50 text-amber-700";

  return (
    <AppLayout>
      <div className="min-h-full bg-[#F4F8FC]">
        <div className="border-b border-[#DDE7F0] bg-white px-4 pb-5 pt-4 sm:px-6">
          <BackButton to="/gateway" label="Gateway (EPA)" />
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconTone.split(" ")[0]}`}>
                <Icon className={`h-5 w-5 ${iconTone.split(" ")[1]}`} />
              </div>
              <div>
                <h1 className="text-xl font-bold text-[#14264A]">{title}</h1>
                <p className="mt-0.5 text-sm text-[#5F7288]">{description}</p>
              </div>
            </div>
            <div className="rounded-xl border border-[#DDE7F0] bg-white px-4 py-2 text-right shadow-sm">
              <p className="text-xs text-[#5F7288]">Total</p>
              <p className="text-2xl font-bold text-[#14264A]">{rows.length}</p>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          <div className="mb-4 flex h-10 items-center gap-2 rounded-lg border border-[#DDE7F0] bg-white px-3">
            <Search className="h-4 w-4 text-[#8AA0B6]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search learner, email, coach..."
              className="h-full border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-[#DDE7F0] bg-white shadow-sm">
            {loading ? (
              <div className="flex h-40 items-center justify-center text-sm text-[#5F7288]">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-[#5F7288]">
                <Award className="h-8 w-8 text-[#C5D5E3]" />
                <p>No learners found</p>
              </div>
            ) : (
              <div className="max-h-[calc(100vh-300px)] overflow-auto">
                <table className="w-full min-w-[1280px] text-sm">
                  <thead>
                    <tr className="border-b border-[#DDE7F0] bg-[#F8FBFE]">
                      {["Learner", "Email", "Coach", "Programme", "Organisation", "End-Date", isClose ? "Days Left" : isEntered ? "EPA Stage" : "Days Overdue", "Status", "OTJH Status", "Details", ...(!isClose && !isEntered ? ["Follow-up"] : [])].map((head) => (
                        <th key={head} className="sticky top-0 min-w-[120px] whitespace-nowrap bg-[#F8FBFE] px-4 py-3 text-left text-xs font-semibold text-[#5F7288]">{head}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => (
                      <tr key={`${row.id}-${row.email}`} className="border-b border-[#F0F4F8] hover:bg-[#F8FBFE]">
                        <td className="px-4 py-3 font-semibold text-[#14264A]">{row.fullName}</td>
                        <td className="px-4 py-3 text-xs text-[#5F7288]">{row.email}</td>
                        <td className="px-4 py-3 text-xs text-[#5F7288]">{row.coach || "-"}</td>
                        <td className="px-4 py-3 text-xs text-[#24486D]">{row.programme || "-"}</td>
                        <td className="px-4 py-3 text-xs text-[#5F7288]">{row.organisation || "-"}</td>
                        <td className="px-4 py-3 font-semibold text-[#14264A]">{fmtDate(row.endDate)}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className={`inline-flex min-w-[72px] items-center justify-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${isClose ? "bg-blue-50 text-blue-700" : isEntered ? "bg-violet-50 text-violet-700" : "bg-red-50 text-red-700"}`}>
                            {isClose ? `${row.daysUntilEnd ?? "-"}d` : isEntered ? "Entered" : `${row.daysOverdue}d`}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className={`inline-flex min-w-[92px] items-center justify-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${isEntered ? "bg-emerald-50 text-emerald-700" : "bg-green-50 text-green-700"}`}>
                            {isEntered ? "Entered EPA" : "Active"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">{otjBadge(row.otjHoursStatus)}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => navigate(`/active-learners?learner=${encodeURIComponent(row.email)}`)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[#D7E5F3] bg-white px-3 py-1.5 text-xs font-semibold text-[#24557F] hover:bg-[#EEF7FF]"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Details
                          </button>
                        </td>
                        {!isClose && !isEntered && (
                          <td className="px-4 py-3">
                            {ticketByEmail.has(row.email.trim().toLowerCase()) ? (
                              <button
                                onClick={() => navigate(`/gateway/tickets?learner=${encodeURIComponent(row.email)}`)}
                                className="rounded-lg bg-[#EEF6FF] px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-[#DCEBFF]"
                              >
                                View Ticket
                              </button>
                            ) : (
                              <span className="text-xs text-[#8AA0B6]">No ticket</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
