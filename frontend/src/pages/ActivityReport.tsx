import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import ZoomCallsReport from "@/components/ZoomCallsReport";
import AgentPerformance from "@/components/callcenter/AgentPerformance";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  Phone,
  PhoneOff,
  AlertTriangle,
  Calendar,
  Mail,
  PhoneCall,
} from "lucide-react";
import type { KbcCoach } from "@/lib/types/kbc";
import { fetchRawKbcCoaches } from "@/lib/services/kbcDashboard";

type CallItem = {
  call_id?: string;
  start_time?: string | null;
  end_time?: string | null;
  call_result?: string | null;
  callee_did_number?: string | null;
};

type LearnerMatch = {
  FullName?: string;
  Email?: string;
  learner_phone?: string | null;
  LMS__Tutor_Name?: string;
  coachName?: string;
};

type FlatCallRow = {
  id: string;
  date: string;
  phoneNumber: string;
  calls: number;
  answered: number;
  notAnswered: number;
  rawResult: string;
  coachName: string;
  learnerName: string;
  learnerEmail: string;
};

type DailyLogRow = {
  date: string;
  callsMade: number;
  answered: number;
  notAnswered: number;
  escalatedLM: number;
  escalatedHR: number;
  appointmentsBooked: number;
  emailsSent: number;
};

function getPhoneNumber(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value).trim();
  if (!str || str.toLowerCase() === "null") return "";
  return str;
}

function normalizePhone(value: unknown): string {
  const raw = getPhoneNumber(value);
  if (!raw) return "";

  let digits = raw.replace(/\D/g, "");

  if (digits.startsWith("0044")) {
    digits = digits.slice(2);
  }

  if (digits.startsWith("44")) {
    digits = `0${digits.slice(2)}`;
  }

  if (!digits.startsWith("0") && digits.length === 10) {
    digits = `0${digits}`;
  }

  return digits;
}

function formatApiDate(dateStr: string) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function formatTableDate(dateStr: string) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function getMonthKey(dateStr: string) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getCurrentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return monthKey;
  return new Date(year, month - 1, 1).toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });
}

function getCoachCalls(coach: KbcCoach): Record<string, CallItem[]> {
  const maybeCalls = (coach as any)?.calls;
  if (!maybeCalls || typeof maybeCalls !== "object") return {};
  return maybeCalls as Record<string, CallItem[]>;
}

function getCoachLearners(coach: KbcCoach): any[] {
  const raw = (coach as any)?.learners_json;

  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw;
  }

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function findLearnerFromIndex(
  index: Map<string, LearnerMatch>,
  phone: string
): LearnerMatch | null {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  return (
    index.get(normalized) ||
    index.get(normalized.slice(-10)) ||
    index.get(normalized.slice(-9)) ||
    null
  );
}

function LegacyActivityReport() {
  const [apiData, setApiData] = useState<KbcCoach[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthKey);

  useEffect(() => {
    let ignore = false;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const rows = await fetchRawKbcCoaches();

        if (!ignore) {
          setApiData(rows);
        }
      } catch (err: any) {
        if (!ignore) {
          setError(err?.message || "Failed to load activity report");
          setApiData([]);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      ignore = true;
    };
  }, []);

  const learnerPhoneIndex = useMemo(() => {
    const map = new Map<string, LearnerMatch>();

    (apiData || []).forEach((coach) => {
      const learners = getCoachLearners(coach);

      learners.forEach((learner: any) => {
        const normalized = normalizePhone(learner?.learner_phone);
        if (!normalized) return;

        const coachName = coach.case_owner || learner?.LMS__Tutor_Name || "-";

        const payload: LearnerMatch = {
          ...learner,
          coachName,
        };

        map.set(normalized, payload);
        map.set(normalized.slice(-10), payload);
        map.set(normalized.slice(-9), payload);
      });
    });

    return map;
  }, [apiData]);

  const allFlatCalls = useMemo<FlatCallRow[]>(() => {
    const rows: FlatCallRow[] = [];

    (apiData || []).forEach((coach) => {
      const coachCalls = getCoachCalls(coach);

      Object.entries(coachCalls).forEach(([eventDate, calls]) => {
        if (!Array.isArray(calls)) return;

        calls.forEach((call, index) => {
          const phoneNumber = getPhoneNumber(call?.callee_did_number);
          if (!phoneNumber) return;

          const result = String(call?.call_result || "").trim().toLowerCase();
          const matchedLearner = findLearnerFromIndex(
            learnerPhoneIndex,
            phoneNumber
          );

          rows.push({
            id: `${coach.case_owner_id}-${eventDate}-${phoneNumber}-${index}-${call?.call_id || "noid"}`,
            date: eventDate,
            phoneNumber,
            calls: 1,
            answered: result === "connected" ? 1 : 0,
            notAnswered: result === "hang_up" ? 1 : 0,
            rawResult: result,
            coachName:
              matchedLearner?.coachName ||
              matchedLearner?.LMS__Tutor_Name ||
              coach.case_owner ||
              "-",
            learnerName: matchedLearner?.FullName || "Unknown learner",
            learnerEmail: matchedLearner?.Email || "-",
          });
        });
      });
    });

    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }, [apiData, learnerPhoneIndex]);

  const monthOptions = useMemo(() => {
    const months = new Set<string>([getCurrentMonthKey()]);
    allFlatCalls.forEach((row) => {
      const month = getMonthKey(row.date);
      if (month) months.add(month);
    });
    return Array.from(months)
      .sort((a, b) => b.localeCompare(a))
      .map((value) => ({ value, label: formatMonthLabel(value) }));
  }, [allFlatCalls]);

  const flatCalls = useMemo(
    () => allFlatCalls.filter((row) => getMonthKey(row.date) === selectedMonth),
    [allFlatCalls, selectedMonth]
  );

  const dailyActivity = useMemo<DailyLogRow[]>(() => {
    const grouped = new Map<string, DailyLogRow>();

    flatCalls.forEach((row) => {
      const existing = grouped.get(row.date) || {
        date: row.date,
        callsMade: 0,
        answered: 0,
        notAnswered: 0,
        escalatedLM: 0,
        escalatedHR: 0,
        appointmentsBooked: 0,
        emailsSent: 0,
      };

      existing.callsMade += 1;
      existing.answered += row.answered;
      existing.notAnswered += row.notAnswered;

      grouped.set(row.date, existing);
    });

    return Array.from(grouped.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );
  }, [flatCalls]);

  const totals = useMemo(
    () =>
      dailyActivity.reduce(
        (acc, d) => ({
          calls: acc.calls + d.callsMade,
          answered: acc.answered + d.answered,
          notAnswered: acc.notAnswered + d.notAnswered,
          escalatedLM: acc.escalatedLM + d.escalatedLM,
          escalatedHR: acc.escalatedHR + d.escalatedHR,
          appointments: acc.appointments + d.appointmentsBooked,
          emails: acc.emails + d.emailsSent,
        }),
        {
          calls: 0,
          answered: 0,
          notAnswered: 0,
          escalatedLM: 0,
          escalatedHR: 0,
          appointments: 0,
          emails: 0,
        }
      ),
    [dailyActivity]
  );

  const pieData = [
    { name: "Answered", value: totals.answered },
    { name: "Not Answered", value: totals.notAnswered },
    { name: "Escalated LM", value: totals.escalatedLM },
    { name: "Escalated HR", value: totals.escalatedHR },
  ].filter((item) => item.value > 0);

  const pieColors = [
    "hsl(142,71%,45%)",
    "hsl(0,72%,51%)",
    "hsl(38,92%,50%)",
    "hsl(262,83%,58%)",
  ];

  const stats = [
    { label: "Total Calls", value: totals.calls, icon: Phone, iconBg: "#EEF2FF", iconColor: "#5B47D5" },
    { label: "Answered", value: totals.answered, icon: PhoneCall, iconBg: "#ECFAF6", iconColor: "#1C9B7A" },
    { label: "Not Answered", value: totals.notAnswered, icon: PhoneOff, iconBg: "#FFF1F3", iconColor: "#E05C68" },
    { label: "Escalated (LM)", value: totals.escalatedLM, icon: AlertTriangle, iconBg: "#FFF8E8", iconColor: "#E4A11B" },
    { label: "Escalated (HR)", value: totals.escalatedHR, icon: AlertTriangle, iconBg: "#FFF1F3", iconColor: "#E05C68" },
    { label: "Appointments", value: totals.appointments, icon: Calendar, iconBg: "#F3F0FF", iconColor: "#7A61D1" },
    { label: "Emails Sent", value: totals.emails, icon: Mail, iconBg: "#EEF5FF", iconColor: "#2D73D5" },
  ];

  return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[#1D1050]">
              Activity for {formatMonthLabel(selectedMonth)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="bg-[#EEF2FF] text-[#5B47D5]">Monthly View</Badge>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="h-10 w-[190px] rounded-xl border-[#E2DCF8] bg-white text-sm font-semibold text-[#1D1050] focus:ring-[#5B47D5]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-[#E2DCF8] bg-white shadow-xl">
                {monthOptions.map((month) => (
                  <SelectItem key={month.value} value={month.value} className="rounded-lg">
                    {month.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {error && (
          <Card className="border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-600">{error}</p>
          </Card>
        )}

        {/* KPI Stat Cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {stats.map((s) => (
            <Card key={s.label} className="rounded-xl border border-[#E2DCF8] p-4 shadow-[0_4px_16px_rgba(29,16,80,0.06)]">
              <div
                className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg"
                style={{ backgroundColor: s.iconBg }}
              >
                <s.icon className="h-[18px] w-[18px]" style={{ color: s.iconColor }} />
              </div>
              <p className="text-2xl font-bold text-[#1D1050] tabular-nums">
                {loading ? <span className="text-[#C4B8F0]">…</span> : s.value}
              </p>
              <p className="mt-1 text-[11px] font-medium text-[#6E6D8A]">
                {s.label}
              </p>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Card className="rounded-xl border border-[#E2DCF8] p-5 shadow-[0_4px_16px_rgba(29,16,80,0.06)] lg:col-span-2">
            <p className="mb-1 text-sm font-bold text-[#1D1050]">Calls by Day</p>
            <p className="mb-4 text-xs text-[#6E6D8A]">Answered vs not answered</p>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={dailyActivity} barCategoryGap="35%">
                <CartesianGrid strokeDasharray="3 3" stroke="#EEEAFF" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9B94C8" }} tickFormatter={formatApiDate} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#9B94C8" }} axisLine={false} tickLine={false} />
                <Tooltip
                  labelFormatter={(value) => formatTableDate(String(value))}
                  contentStyle={{ borderRadius: "10px", border: "1px solid #E2DCF8", boxShadow: "0 8px 24px rgba(29,16,80,0.12)", fontSize: "12px" }}
                />
                <Bar dataKey="answered" stackId="a" fill="#1C9B7A" name="Answered" radius={[0, 0, 0, 0]} />
                <Bar dataKey="notAnswered" stackId="a" fill="#E05C68" name="Not Answered" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card className="rounded-xl border border-[#E2DCF8] p-5 shadow-[0_4px_16px_rgba(29,16,80,0.06)]">
            <p className="mb-1 text-sm font-bold text-[#1D1050]">Outcomes</p>
            <p className="mb-4 text-xs text-[#6E6D8A]">Breakdown by result</p>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} dataKey="value" paddingAngle={3}>
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={pieColors[i]} />
                  ))}
                </Pie>
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                <Tooltip contentStyle={{ borderRadius: "10px", border: "1px solid #E2DCF8", fontSize: "12px" }} />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </div>

        <Card className="rounded-xl border border-[#E2DCF8] shadow-[0_4px_16px_rgba(29,16,80,0.06)]">
          <div className="flex items-center justify-between border-b border-[#F0EDF9] px-5 py-4">
            <p className="text-sm font-bold text-[#1D1050]">Daily Activity Log</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[640px] w-full text-sm">
              <thead>
                <tr className="border-b border-[#F0EDF9] bg-[#FAF9FF]">
                  {["Date","Calls","Answered","Not Answered","Escalated LM","Escalated HR","Appts Booked","Emails Sent"].map((h, i) => (
                    <th key={h} className={`px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-[#9B94C8] ${i > 0 ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dailyActivity.slice().reverse().map((d) => (
                  <tr key={d.date} className="border-b border-[#F5F3FC] transition-colors hover:bg-[#FAF9FF]">
                    <td className="px-4 py-3 font-semibold text-[#1D1050]">{formatTableDate(d.date)}</td>
                    <td className="px-4 py-3 text-right font-bold text-[#5B47D5] tabular-nums">{d.callsMade}</td>
                    <td className="px-4 py-3 text-right tabular-nums"><span className="font-semibold text-[#1C9B7A]">{d.answered}</span></td>
                    <td className="px-4 py-3 text-right tabular-nums"><span className="font-semibold text-[#E05C68]">{d.notAnswered}</span></td>
                    <td className="px-4 py-3 text-right text-[#6E6D8A] tabular-nums">{d.escalatedLM}</td>
                    <td className="px-4 py-3 text-right text-[#6E6D8A] tabular-nums">{d.escalatedHR}</td>
                    <td className="px-4 py-3 text-right text-[#6E6D8A] tabular-nums">{d.appointmentsBooked}</td>
                    <td className="px-4 py-3 text-right text-[#6E6D8A] tabular-nums">{d.emailsSent}</td>
                  </tr>
                ))}
                {!loading && dailyActivity.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-[#9B94C8]">No activity data found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="rounded-xl border border-[#E2DCF8] shadow-[0_4px_16px_rgba(29,16,80,0.06)]">
          <div className="flex items-center justify-between border-b border-[#F0EDF9] px-5 py-4">
            <p className="text-sm font-bold text-[#1D1050]">Recent Call Details</p>
            <span className="rounded-full bg-[#EEF2FF] px-2.5 py-1 text-xs font-semibold text-[#5B47D5]">
              {flatCalls.length} calls
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[700px] w-full text-sm">
              <thead>
                <tr className="border-b border-[#F0EDF9] bg-[#FAF9FF]">
                  {["Date","Learner","Email","Coach","Phone","Calls","Status"].map((h, i) => (
                    <th key={h} className={`px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-[#9B94C8] ${i === 5 ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {flatCalls.slice().reverse().slice(0, 30).map((row) => (
                  <tr key={row.id} className="border-b border-[#F5F3FC] transition-colors hover:bg-[#FAF9FF]">
                    <td className="px-4 py-3 font-semibold text-[#1D1050]">{formatTableDate(row.date)}</td>
                    <td className="px-4 py-3 font-medium text-[#1D1050]">{row.learnerName}</td>
                    <td className="px-4 py-3 text-[#6E6D8A]">{row.learnerEmail}</td>
                    <td className="px-4 py-3 text-[#6E6D8A]">{row.coachName}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[#6E6D8A]">{row.phoneNumber}</td>
                    <td className="px-4 py-3 text-right text-[#6E6D8A] tabular-nums">{row.calls}</td>
                    <td className="px-4 py-3">
                      {row.rawResult === "connected" ? (
                        <span className="inline-flex items-center rounded-full bg-[#ECFAF6] px-2.5 py-0.5 text-[11px] font-semibold text-[#0F6F57]">Answered</span>
                      ) : row.rawResult === "hang_up" ? (
                        <span className="inline-flex items-center rounded-full bg-[#FFF1F3] px-2.5 py-0.5 text-[11px] font-semibold text-[#B42332]">Not Answered</span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-[#F5F3FC] px-2.5 py-0.5 text-[11px] font-semibold text-[#6E6D8A]">{row.rawResult || "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && flatCalls.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-[#9B94C8]">No call details found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
  );
}

export default function ActivityReport() {
  return (
    <AppLayout>
      <div className="min-w-0">
        {/* Page Header */}
        <div className="border-b border-[#E2DCF8] bg-white px-6 py-5">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-[#9B87D8]">Reporting</p>
          <h1 className="text-2xl font-extrabold text-[#1D1050]">Activity Report</h1>
          <p className="mt-1 text-sm text-[#6E6D8A]">Call logs, Zoom activity, and agent performance</p>
        </div>

        <div className="p-4 sm:p-5 lg:p-6">
          <Tabs defaultValue="zoom">
            <div className="mb-5 overflow-x-auto">
              <TabsList className="w-max rounded-xl bg-[#EEF2FF] p-1">
                <TabsTrigger value="zoom" className="rounded-lg px-5 text-sm font-semibold data-[state=active]:bg-white data-[state=active]:text-[#5B47D5] data-[state=active]:shadow-sm">
                  Zoom calls
                </TabsTrigger>
                <TabsTrigger value="activity" className="rounded-lg px-5 text-sm font-semibold data-[state=active]:bg-white data-[state=active]:text-[#5B47D5] data-[state=active]:shadow-sm">
                  Activity log
                </TabsTrigger>
                <TabsTrigger value="agents" className="rounded-lg px-5 text-sm font-semibold data-[state=active]:bg-white data-[state=active]:text-[#5B47D5] data-[state=active]:shadow-sm">
                  Agent performance
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="zoom"><ZoomCallsReport /></TabsContent>
            <TabsContent value="activity"><LegacyActivityReport /></TabsContent>
            <TabsContent value="agents"><AgentPerformance /></TabsContent>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}
