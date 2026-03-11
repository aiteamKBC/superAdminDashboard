import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

export default function ActivityReport() {
  const [apiData, setApiData] = useState<KbcCoach[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const flatCalls = useMemo<FlatCallRow[]>(() => {
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

  const last7 = useMemo(() => dailyActivity.slice(-7), [dailyActivity]);

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
    { label: "Total Calls", value: totals.calls, icon: Phone },
    { label: "Answered", value: totals.answered, icon: PhoneCall },
    { label: "Not Answered", value: totals.notAnswered, icon: PhoneOff },
    { label: "Escalated (LM)", value: totals.escalatedLM, icon: AlertTriangle },
    { label: "Escalated (HR)", value: totals.escalatedHR, icon: AlertTriangle },
    { label: "Appointments Booked", value: totals.appointments, icon: Calendar },
    { label: "Emails Sent", value: totals.emails, icon: Mail },
  ];

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground">
              Engagement Activity Report
            </h2>
            <p className="text-sm text-muted-foreground">Last 30 days</p>
          </div>
          <Badge variant="secondary">Month to Date</Badge>
        </div>

        {error && (
          <Card className="border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-600">{error}</p>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {stats.map((s) => (
            <Card key={s.label} className="p-4 text-center">
              <s.icon className="mx-auto mb-2 h-4 w-4 text-muted-foreground" />
              <p className="text-2xl font-bold text-foreground">
                {loading ? "..." : s.value}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {s.label}
              </p>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <p className="mb-4 text-sm font-medium text-foreground">
              Calls by Day (Last 7 Days)
            </p>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={last7}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(214,32%,91%)"
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickFormatter={formatApiDate}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  labelFormatter={(value) => formatTableDate(String(value))}
                />
                <Bar
                  dataKey="answered"
                  stackId="a"
                  fill="hsl(142,71%,45%)"
                  name="Answered"
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="notAnswered"
                  stackId="a"
                  fill="hsl(0,72%,51%)"
                  name="Not Answered"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-5">
            <p className="mb-4 text-sm font-medium text-foreground">
              Outcomes Breakdown
            </p>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  dataKey="value"
                  paddingAngle={2}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={pieColors[i]} />
                  ))}
                </Pie>
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </div>

        <Card className="overflow-x-auto">
          <div className="border-b p-4">
            <p className="text-sm font-medium text-foreground">
              Daily Activity Log
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left font-medium text-muted-foreground">
                  Date
                </th>
                <th className="p-3 text-right font-medium text-muted-foreground">
                  Calls
                </th>
                <th className="p-3 text-right font-medium text-muted-foreground">
                  Answered
                </th>
                <th className="p-3 text-right font-medium text-muted-foreground">
                  Not Answered
                </th>
                <th className="p-3 text-right font-medium text-muted-foreground">
                  Escalated LM
                </th>
                <th className="p-3 text-right font-medium text-muted-foreground">
                  Escalated HR
                </th>
                <th className="p-3 text-right font-medium text-muted-foreground">
                  Appts Booked
                </th>
                <th className="p-3 text-right font-medium text-muted-foreground">
                  Emails Sent
                </th>
              </tr>
            </thead>
            <tbody>
              {dailyActivity
                .slice(-14)
                .reverse()
                .map((d) => (
                  <tr key={d.date} className="border-b hover:bg-muted/30">
                    <td className="p-3 font-medium text-foreground">
                      {formatTableDate(d.date)}
                    </td>
                    <td className="p-3 text-right text-muted-foreground">
                      {d.callsMade}
                    </td>
                    <td className="p-3 text-right text-muted-foreground">
                      {d.answered}
                    </td>
                    <td className="p-3 text-right text-muted-foreground">
                      {d.notAnswered}
                    </td>
                    <td className="p-3 text-right text-muted-foreground">
                      {d.escalatedLM}
                    </td>
                    <td className="p-3 text-right text-muted-foreground">
                      {d.escalatedHR}
                    </td>
                    <td className="p-3 text-right text-muted-foreground">
                      {d.appointmentsBooked}
                    </td>
                    <td className="p-3 text-right text-muted-foreground">
                      {d.emailsSent}
                    </td>
                  </tr>
                ))}

              {!loading && dailyActivity.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="p-6 text-center text-sm text-muted-foreground"
                  >
                    No activity data found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        <Card className="overflow-x-auto">
          <div className="border-b p-4">
            <p className="text-sm font-medium text-foreground">
              Recent Call Details
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left font-medium text-muted-foreground">
                  Date
                </th>
                <th className="p-3 text-left font-medium text-muted-foreground">
                  Learner
                </th>
                <th className="p-3 text-left font-medium text-muted-foreground">
                  Learner Email
                </th>
                <th className="p-3 text-left font-medium text-muted-foreground">
                  Coach
                </th>
                <th className="p-3 text-left font-medium text-muted-foreground">
                  Phone Number
                </th>
                <th className="p-3 text-right font-medium text-muted-foreground">
                  Calls
                </th>
                <th className="p-3 text-left font-medium text-muted-foreground">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {flatCalls
                .slice()
                .reverse()
                .slice(0, 30)
                .map((row) => (
                  <tr key={row.id} className="border-b hover:bg-muted/30">
                    <td className="p-3 font-medium text-foreground">
                      {formatTableDate(row.date)}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {row.learnerName}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {row.learnerEmail}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {row.coachName}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {row.phoneNumber}
                    </td>
                    <td className="p-3 text-right text-muted-foreground">
                      {row.calls}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {row.rawResult === "connected"
                        ? "Answered"
                        : row.rawResult === "hang_up"
                          ? "Not Answered"
                          : row.rawResult || "-"}
                    </td>
                  </tr>
                ))}

              {!loading && flatCalls.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="p-6 text-center text-sm text-muted-foreground"
                  >
                    No call details found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </AppLayout>
  );
}