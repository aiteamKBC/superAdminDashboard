import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckSquare, Download, RefreshCw, TrendingUp, ClipboardCheck, AlertCircle } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import AppLayout from "@/components/AppLayout";
import BackButton from "@/components/BackButton";
import { Button } from "@/components/ui/button";

// ─── Types ────────────────────────────────────────────────────────────

interface Learner {
  learnerId: number;
  fullName: string;
  email: string;
  caseOwner: string;
  countEvidencePending: number;
  evidenceAccepted: number;
  evidenceReferred: number;
  totalEvidence: number;
  todayCount: number;
  yesterdayCount: number;
  day2Count: number;
  day3Count: number;
  day4Count: number;
  day5Count: number;
  day6Count: number;
  day7Count: number;
}

interface CoachRow {
  coach: string;
  pendingEvidence: number;
  today: number;
  yesterday: number;
  day2: number;
  day3: number;
  day4: number;
  day5: number;
  day6: number;
  day7: number;
  weeklyTotal: number;
  correctionRate: number;
}

// ─── Main Page ─────────────────────────────────────────────────────────

export default function MarkingPage() {
  const [learners, setLearners] = useState<Learner[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/require-marking/");
      if (res.ok) setLearners(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Group by coach
  const coachRows = useMemo<CoachRow[]>(() => {
    const map = new Map<string, CoachRow>();
    for (const l of learners) {
      const coach = l.caseOwner || "Unassigned";
      const existing = map.get(coach) ?? {
        coach,
        pendingEvidence: 0,
        today: 0, yesterday: 0,
        day2: 0, day3: 0, day4: 0, day5: 0, day6: 0, day7: 0,
        weeklyTotal: 0,
        correctionRate: 0,
      };
      existing.pendingEvidence += Number(l.countEvidencePending) || 0;
      existing.today += Number(l.todayCount) || 0;
      existing.yesterday += Number(l.yesterdayCount) || 0;
      existing.day2 += Number(l.day2Count) || 0;
      existing.day3 += Number(l.day3Count) || 0;
      existing.day4 += Number(l.day4Count) || 0;
      existing.day5 += Number(l.day5Count) || 0;
      existing.day6 += Number(l.day6Count) || 0;
      existing.day7 += Number(l.day7Count) || 0;
      existing.weeklyTotal = existing.today + existing.yesterday + existing.day2 + existing.day3 + existing.day4 + existing.day5 + existing.day6 + existing.day7;
      const correctionDenominator = existing.weeklyTotal + existing.pendingEvidence;
      existing.correctionRate = correctionDenominator > 0
        ? Math.ceil((existing.weeklyTotal / correctionDenominator) * 100)
        : 0;
      map.set(coach, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.pendingEvidence - a.pendingEvidence);
  }, [learners]);

  // Summary totals
  const totals = useMemo(() => {
    const totalPending = coachRows.reduce((s, r) => s + r.pendingEvidence, 0);
    const totalToday = coachRows.reduce((s, r) => s + r.today, 0);
    const totalYesterday = coachRows.reduce((s, r) => s + r.yesterday, 0);
    const totalDay2 = coachRows.reduce((s, r) => s + r.day2, 0);
    const totalDay3 = coachRows.reduce((s, r) => s + r.day3, 0);
    const totalDay4 = coachRows.reduce((s, r) => s + r.day4, 0);
    const totalDay5 = coachRows.reduce((s, r) => s + r.day5, 0);
    const totalDay6 = coachRows.reduce((s, r) => s + r.day6, 0);
    const totalDay7 = coachRows.reduce((s, r) => s + r.day7, 0);
    const weeklyMarked = totalToday + totalYesterday + totalDay2 + totalDay3 + totalDay4 + totalDay5 + totalDay6 + totalDay7;
    const correctionRate = (weeklyMarked + totalPending) > 0 ? Math.ceil((weeklyMarked / (weeklyMarked + totalPending)) * 100) : 0;
    return { totalPending, weeklyMarked, correctionRate, totalToday, totalYesterday, totalDay2, totalDay3, totalDay4, totalDay5, totalDay6, totalDay7 };
  }, [coachRows]);

  const exportCsv = () => {
    const cols = ["Coach Name", "Pending Evidence", "Today marking", "Yesterday marking", "-2 marking", "-3 marking", "-4 marking", "-5 marking", "-6 marking", "-7 marking", "Weekly Marked", "Weekly Correction Rate"];
    const rows = coachRows.map((r) => [r.coach, r.pendingEvidence, r.today, r.yesterday, r.day2, r.day3, r.day4, r.day5, r.day6, r.day7, r.weeklyTotal, `${r.correctionRate}%`]);
    const totalRow = ["TOTAL", totals.totalPending, totals.totalToday, totals.totalYesterday, totals.totalDay2, totals.totalDay3, totals.totalDay4, totals.totalDay5, totals.totalDay6, totals.totalDay7, totals.weeklyMarked, `${totals.correctionRate}%`];
    const csv = [cols, ...rows, totalRow].map((r) => r.map((c) => `"${String(c ?? "")}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "marking-report.csv";
    a.click();
  };

  const DAY_COLS = [
    { key: "today" as const, label: "Today marking" },
    { key: "yesterday" as const, label: "Yesterday marking" },
    { key: "day2" as const, label: "-2 marking" },
    { key: "day3" as const, label: "-3 marking" },
    { key: "day4" as const, label: "-4 marking" },
    { key: "day5" as const, label: "-5 marking" },
    { key: "day6" as const, label: "-6 marking" },
    { key: "day7" as const, label: "-7 marking" },
  ];

  const TOTAL_KEYS: Record<typeof DAY_COLS[number]["key"], number> = {
    today: totals.totalToday,
    yesterday: totals.totalYesterday,
    day2: totals.totalDay2,
    day3: totals.totalDay3,
    day4: totals.totalDay4,
    day5: totals.totalDay5,
    day6: totals.totalDay6,
    day7: totals.totalDay7,
  };

  return (
    <AppLayout>
      <div className="min-h-full bg-[#F4F8FC]">
        {/* Header */}
        <div className="border-b border-[#DDE7F0] bg-white px-4 pb-5 pt-4 sm:px-6">
          <BackButton to="/" label="Home" />
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
                <CheckSquare className="h-5 w-5 text-slate-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-[#14264A]">Marking</h1>
                <p className="mt-0.5 text-sm text-[#5F7288]">Grade and provide feedback on submitted work</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={load} className="h-9 gap-1.5 rounded-lg border-[#DDE7F0] bg-white text-[#24486D]">
                <RefreshCw className="h-4 w-4" /> Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={exportCsv} className="h-9 gap-1.5 rounded-lg border-[#DDE7F0] bg-white text-[#24486D]">
                <Download className="h-4 w-4" /> Export CSV
              </Button>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          {/* Summary cards */}
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-[#DDE7F0] bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-[#5F7288]">
                <AlertCircle className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">Pending Evidence</span>
              </div>
              <p className="mt-3 text-3xl font-bold text-[#14264A]">{loading ? "…" : totals.totalPending.toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-[#DDE7F0] bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-[#5F7288]">
                <ClipboardCheck className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">Weekly Marked Total</span>
              </div>
              <p className="mt-3 text-3xl font-bold text-[#14264A]">{loading ? "…" : totals.weeklyMarked.toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-[#DDE7F0] bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-[#5F7288]">
                <TrendingUp className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">Weekly Correction Rate</span>
              </div>
              <p className="mt-3 text-3xl font-bold text-[#475569]">{loading ? "…" : `${totals.correctionRate}%`}</p>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-xl border border-[#DDE7F0] bg-white shadow-sm">
            {loading ? (
              <div className="flex h-40 items-center justify-center text-sm text-[#5F7288]">Loading data…</div>
            ) : coachRows.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-[#5F7288]">No data found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#DDE7F0] bg-[#F8FBFE]">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-[#5F7288]">Coach Name</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-[#5F7288]">Pending Evidence</th>
                      {DAY_COLS.map((d) => (
                        <th key={d.key} className="px-4 py-3 text-right text-xs font-semibold text-[#5F7288]">{d.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {coachRows.map((row) => (
                      <tr key={row.coach} className="border-b border-[#F0F4F8] transition-colors hover:bg-[#F8FBFE]">
                        <td className="px-4 py-3 font-semibold text-[#14264A]">{row.coach}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`font-semibold ${row.pendingEvidence > 50 ? "text-red-600" : row.pendingEvidence > 20 ? "text-amber-600" : "text-[#14264A]"}`}>
                            {row.pendingEvidence}
                          </span>
                        </td>
                        {DAY_COLS.map((d) => (
                          <td key={d.key} className="px-4 py-3 text-right text-[#3A506B]">
                            {row[d.key] > 0 ? <span className="font-semibold text-[#14264A]">{row[d.key]}</span> : <span className="text-[#C5D5E3]">0</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {/* TOTAL row */}
                    <tr className="border-t-2 border-[#DDE7F0] bg-[#F0F6FF]">
                      <td className="px-4 py-3 text-sm font-bold text-[#14264A]">TOTAL</td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-red-600">{totals.totalPending}</td>
                      {DAY_COLS.map((d) => (
                        <td key={d.key} className="px-4 py-3 text-right text-sm font-bold text-[#14264A]">{TOTAL_KEYS[d.key]}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {!loading && coachRows.length > 0 && (
            <div className="mt-6 overflow-hidden rounded-xl border border-[#DDE7F0] bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DDE7F0] px-4 py-4 sm:px-5">
                <div>
                  <h2 className="text-sm font-bold text-[#14264A]">
                    Weekly Correction Rate by Coach
                  </h2>
                  <p className="mt-0.5 text-xs text-[#71849A]">
                    Weekly marked evidence compared with marked plus current pending evidence
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-600">
                  Overall {totals.correctionRate}%
                </span>
              </div>

              <div className="overflow-x-auto px-2 py-4 sm:px-4">
                <div className="min-w-[680px]">
                  <ResponsiveContainer
                    width="100%"
                    height={Math.max(360, coachRows.length * 46)}
                  >
                    <BarChart
                      data={coachRows}
                      layout="vertical"
                      margin={{ top: 4, right: 54, bottom: 16, left: 18 }}
                      barCategoryGap="26%"
                    >
                      <CartesianGrid
                        horizontal={false}
                        stroke="#E8EFF7"
                        strokeDasharray="3 3"
                      />
                      <XAxis
                        type="number"
                        domain={[0, 100]}
                        tickFormatter={(value) => `${value}%`}
                        tick={{ fill: "#71849A", fontSize: 11 }}
                        axisLine={{ stroke: "#DDE7F0" }}
                        tickLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="coach"
                        width={130}
                        tick={{ fill: "#14264A", fontSize: 11, fontWeight: 600 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: "#F4F8FC" }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const row = payload[0].payload as CoachRow;
                          return (
                            <div className="rounded-lg border border-[#DDE7F0] bg-white px-3 py-2 text-xs shadow-lg">
                              <p className="font-bold text-[#14264A]">{row.coach}</p>
                              <p className="mt-1 text-[#5F7288]">
                                Weekly marked: <strong>{row.weeklyTotal}</strong>
                              </p>
                              <p className="text-[#5F7288]">
                                Pending evidence: <strong>{row.pendingEvidence}</strong>
                              </p>
                              <p className="mt-1 font-bold text-slate-600">
                                Correction rate: {row.correctionRate}%
                              </p>
                            </div>
                          );
                        }}
                      />
                      <Bar
                        dataKey="correctionRate"
                        radius={[0, 6, 6, 0]}
                        maxBarSize={22}
                      >
                        {coachRows.map((row) => (
                          <Cell
                            key={row.coach}
                            fill={
                              row.correctionRate >= 70
                                ? "#22C55E"
                                : row.correctionRate >= 40
                                  ? "#8B5CF6"
                                  : "#EF4444"
                            }
                          />
                        ))}
                        <LabelList
                          dataKey="correctionRate"
                          position="right"
                          formatter={(value: number) => `${value}%`}
                          fill="#14264A"
                          fontSize={11}
                          fontWeight={700}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
