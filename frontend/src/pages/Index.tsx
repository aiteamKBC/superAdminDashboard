// src/pages/Index.tsx
import { useCallback, useEffect, useMemo, useState } from "react";

import AppLayout from "@/components/AppLayout";
import GlobalFilters from "@/components/GlobalFilters";
import KpiCard from "@/components/KpiCard";
import LearnerTable from "@/components/LearnerTable";
import LearnerDrawer from "@/components/LearnerDrawer";

import { fetchUiCoaches } from "@/lib/services/kbcDashboard";
import { applyDashboardFilters, type DashboardFilters } from "@/lib/filters/dashboardFilters";
import type { UiCoach } from "@/lib/adapters/kbcToUi";

import type { KpiCategory, Learner } from "@/types/dashboard";
import type { KpiCardData } from "@/types/dashboard";

/* ---------------- helpers ---------------- */

const pickFirstString = (obj: any, keys: string[]) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
};

const normEmail = (v: unknown) => String(v ?? "").trim().toLowerCase();
const normId = (v: unknown) => String(v ?? "").trim();

const splitName = (full: string) => {
  const s = String(full || "").trim();
  if (!s) return { firstName: "Unknown", lastName: "" };
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
};

const safePct = (num: number, den: number) => {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return 0;
  return Math.round((num / den) * 100);
};

const sortDatesAsc = (dates: string[]) =>
  dates.filter(Boolean).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

const kpiAccentClass: Record<KpiCategory, string> = {
  "missed-session": "border-l-[var(--kpi-missed)]",
  "review-due": "border-l-[var(--kpi-review)]",
  "coaching-due": "border-l-[var(--kpi-coaching)]",
  "coaching-booked": "border-l-sky-500",
  "otj-behind": "border-l-[var(--kpi-otj)]",
  "coach-marking-overdue": "border-l-violet-500",
};

const parseProgrammeFromModule = (moduleStr: string) => {
  const s = String(moduleStr || "").trim();
  if (!s) return "Unknown";
  const parts = s
    .split(" - ")
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "Unknown";
};

function buildAttendanceMetrics(att?: Record<string, { value?: number; module?: string }>) {
  const entries = Object.entries(att || {});
  if (!entries.length) {
    return {
      absenceRatio: 0,
      missedLast10Weeks: 0,
      missedInRow: 0,
      lastSessionDate: "N/A",
      lastSessionStatus: "Unknown" as Learner["lastSessionStatus"],
      latestProgramme: "Unknown",
    };
  }

  const dates = sortDatesAsc(entries.map(([d]) => d));
  const lastDate = dates[dates.length - 1];
  const lastVal = att?.[lastDate]?.value ?? null;

  const lastStatus = (
    lastVal == null ? "Unknown" : lastVal === 1 ? "Attended" : "Missed"
  ) as Learner["lastSessionStatus"];

  const last10 = dates.slice(-10);
  const missedLast10 = last10.reduce((acc, d) => acc + ((att?.[d]?.value ?? 0) === 0 ? 1 : 0), 0);

  let missedInRow = 0;
  for (let i = dates.length - 1; i >= 0; i--) {
    const d = dates[i];
    const v = att?.[d]?.value;
    if (v === 0) missedInRow++;
    else break;
  }

  const total = dates.length;
  const attended = dates.reduce((acc, d) => acc + ((att?.[d]?.value ?? 0) === 1 ? 1 : 0), 0);
  const absenceRatio = safePct(total - attended, total);

  const mod = att?.[lastDate]?.module;
  const latestProgramme = mod ? parseProgrammeFromModule(mod) : "Unknown";

  return {
    absenceRatio,
    missedLast10Weeks: missedLast10,
    missedInRow,
    lastSessionDate: lastDate,
    lastSessionStatus: lastStatus,
    latestProgramme,
  };
}

function priorityFromAttendance(missedInRow: number, absenceRatio: number): Learner["priority"] {
  if (missedInRow >= 3 || absenceRatio >= 35) return "critical";
  if (missedInRow >= 2 || absenceRatio >= 25) return "high";
  return "normal";
}

function riskCatsFromAttendance(missedInRow: number, absenceRatio: number): KpiCategory[] {
  const cats: KpiCategory[] = [];
  if (missedInRow >= 2 || absenceRatio >= 25) cats.push("missed-session");
  return cats;
}

/* ---------------- JSON array helpers ---------------- */

const asArray = (v: any): any[] => {
  if (!v) return [];
  if (Array.isArray(v)) return v;

  if (typeof v === "string") {
    try {
      return asArray(JSON.parse(v));
    } catch {
      return [];
    }
  }

  if (typeof v === "object") {
    if (Array.isArray(v.students)) return v.students;
    if (Array.isArray(v.value)) return v.value;
  }

  return [];
};

const getStudentsFromRaw = (raw: any): any[] => {
  const fromLearnersJson = asArray(raw?.learners_json);
  if (fromLearnersJson.length) return fromLearnersJson;

  const fromNested = asArray(raw?.learners_json?.students);
  if (fromNested.length) return fromNested;

  return asArray(raw?.students);
};

/* ---------------- bookings helpers (Monthly Coaching) ---------------- */

const getBookedStudentsFromRaw = (raw: any): any[] => {
  const cols = [
    "booked_students_PR",
    "booked_students_MCM",
    "booked_students_StSupport",
  ];

  const out: any[] = [];

  for (const c of cols) {
    const val = raw?.[c];

    if (!val) continue;

    let parsed = val;

    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        continue;
      }
    }

    if (Array.isArray(parsed?.students)) {
      out.push(...parsed.students);
    }
  }

  return out;
};

const pickBookedEmail = (row: any) => {
  // keys الموجودة فعلا في booking json حسب الصورة
  const v = pickFirstString(row, [
    "matched_student_email",
    "matchedStudentEmail",
    "customerEmail", // fallback لو الطالب حجز بايميل مختلف
    "Email",
    "email",
  ]);
  return normEmail(v);
};

const pickBookedId = (row: any) => {
  const v = pickFirstString(row, ["matched_student_id", "matchedStudentId", "ID", "Id", "id"]);
  return normId(v);
};

const buildBookedIndex = (raw: any) => {
  const booked = getBookedStudentsFromRaw(raw);
  const byEmail = new Set<string>();
  const byId = new Set<string>();

  for (const it of booked) {
    const e = pickBookedEmail(it);
    const id = pickBookedId(it);
    if (e) byEmail.add(e);
    if (id) byId.add(id);
  }

  return { byEmail, byId, count: booked.length };
};

const BOOKED_TYPE_LABELS = {
  booked_students_PR: "Progress Review",
  booked_students_MCM: "MCM",
  booked_students_StSupport: "Support Session",
} as const;

type SessionType = (typeof BOOKED_TYPE_LABELS)[keyof typeof BOOKED_TYPE_LABELS] | "Unknown";

const normText = (v: unknown) =>
  String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const getBookedEntriesFromRaw = (
  raw: any
): Array<{
  source: "booked_students_PR" | "booked_students_MCM" | "booked_students_StSupport";
  sessionType: SessionType;
  student: any;
}> => {
  const cols = [
    "booked_students_PR",
    "booked_students_MCM",
    "booked_students_StSupport",
  ] as const;

  const out: Array<{
    source: "booked_students_PR" | "booked_students_MCM" | "booked_students_StSupport";
    sessionType: SessionType;
    student: any;
  }> = [];

  for (const col of cols) {
    const val = raw?.[col];
    if (!val) continue;

    let parsed = val;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        continue;
      }
    }

    const students = Array.isArray(parsed?.students) ? parsed.students : [];
    for (const student of students) {
      out.push({
        source: col,
        sessionType: BOOKED_TYPE_LABELS[col],
        student,
      });
    }
  }

  return out;
};

const getUpcomingMeetingsFromRaw = (raw: any): any[] => {
  const meetings = raw?.upcomming_sessions?.meetings;
  return Array.isArray(meetings) ? meetings : [];
};

/* ---------------- helper name ---------------- */

const normName = (v: unknown) =>
  String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const sameLooseName = (a: string, b: string) => {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
};

const getLearnerBookedMeta = (
  raw: any,
  learner: any,
  learnerId: string,
  learnerEmailKey: string,
  learnerFullName: string
): {
  booked: boolean;
  hasData: boolean;
  sessionType: SessionType;
  sessionDate: string;
} => {
  const bookedEntries = getBookedEntriesFromRaw(raw);

  const upcomingMeetings = getUpcomingMeetingsFromRaw(raw)
    .filter((m) => m && m.date)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

  if (!bookedEntries.length) {
    return {
      booked: false,
      hasData: false,
      sessionType: "Unknown",
      sessionDate: "N/A",
    };
  }

  const learnerNameNorm = normName(
    learnerFullName ||
    pickFirstString(learner, ["FullName", "fullName", "DisplayName", "displayName", "name"])
  );

  const learnerEmail = normEmail(
    pickFirstString(learner, ["Email", "email", "emailAddress", "UserEmail", "LearnerEmail"])
  );

  const matchedBooking =
    bookedEntries.find(({ student }) => {
      const bookedId = normId(
        pickFirstString(student, ["matched_student_id", "matchedStudentId", "ID", "Id", "id"])
      );

      const bookedEmail = normEmail(
        pickFirstString(student, [
          "matched_student_email",
          "matchedStudentEmail",
          "customerEmail",
          "Email",
          "email",
        ])
      );

      const bookedName = normName(
        pickFirstString(student, [
          "matched_student_name",
          "matchedStudentName",
          "customerName",
          "FullName",
          "name",
        ])
      );

      return (
        (learnerId && bookedId && learnerId === bookedId) ||
        (learnerEmailKey && bookedEmail && learnerEmailKey === bookedEmail) ||
        (learnerEmail && bookedEmail && learnerEmail === bookedEmail) ||
        (learnerNameNorm && bookedName && sameLooseName(learnerNameNorm, bookedName))
      );
    }) || null;

  if (!matchedBooking) {
    return {
      booked: false,
      hasData: true,
      sessionType: "Unknown",
      sessionDate: "N/A",
    };
  }

  const sessionType = matchedBooking.sessionType;
  const bookedStudent = matchedBooking.student;

  const candidateNames = [
    pickFirstString(bookedStudent, [
      "matched_student_name",
      "matchedStudentName",
      "customerName",
      "FullName",
      "name",
    ]),
    learnerFullName,
    pickFirstString(learner, ["FullName", "fullName", "DisplayName", "displayName", "name"]),
  ]
    .map(normName)
    .filter(Boolean);

  const matchedMeeting =
    upcomingMeetings.find((meeting) => {
      const meetingCustomerName = normName(meeting?.customerName);
      if (!meetingCustomerName) return false;

      return candidateNames.some((name) => sameLooseName(name, meetingCustomerName));
    }) || null;

  return {
    booked: true,
    hasData: true,
    sessionType,
    sessionDate: matchedMeeting?.date || "N/A",
  };
};

/* ---------------- progress review helpers ---------------- */

type ReviewListItem = {
  ID?: string;
  Email?: string;
  FullName?: string;
  overdueReviews?: number;
  earliestOverdue?: string;
  nextDue?: string;
  dueUpcomingReviews?: number;
};

function parseDDMMYYYY(s: string): Date | null {
  const m = String(s || "").trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const d = new Date(yyyy, mm - 1, dd);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getLatestMonthKey(byMonth: Record<string, unknown> | undefined | null) {
  if (!byMonth) return null;
  const keys = Object.keys(byMonth).filter(Boolean);
  if (!keys.length) return null;
  keys.sort((a, b) => a.localeCompare(b));
  return keys[keys.length - 1];
}

function buildProgressReviewIndex(overall: unknown) {
  const o = overall as any;
  const byMonth = o?.byMonth;
  const monthKey = getLatestMonthKey(byMonth);
  const month = monthKey ? byMonth?.[monthKey] : null;

  const overdue: ReviewListItem[] = month?.lists?.overdueLearners ?? [];
  const upcoming: ReviewListItem[] = month?.lists?.dueUpcomingLearners ?? [];

  const overdueByEmail = new Map<string, ReviewListItem>();
  const overdueById = new Map<string, ReviewListItem>();
  for (const it of overdue) {
    const e = normEmail(it?.Email);
    const id = normId(it?.ID);
    if (e) overdueByEmail.set(e, it);
    if (id) overdueById.set(id, it);
  }

  const upcomingByEmail = new Map<string, ReviewListItem>();
  const upcomingById = new Map<string, ReviewListItem>();
  for (const it of upcoming) {
    const e = normEmail(it?.Email);
    const id = normId(it?.ID);
    if (e) upcomingByEmail.set(e, it);
    if (id) upcomingById.set(id, it);
  }

  return { monthKey, overdueByEmail, overdueById, upcomingByEmail, upcomingById };
}

function priorityFromReview(overdueReviews: number | undefined): Learner["priority"] {
  const n = Number(overdueReviews ?? 1);
  if (n >= 2) return "critical";
  return "high";
}

/* ---------------- OTJ helpers ---------------- */

const toNum = (v: any): number | null => {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replace(/[%+,]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/* ---------------- reading helpers ---------------- */
const normalizeLooseKey = (value: string) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const getLooseRawValue = (raw: any, aliases: string[]) => {
  if (!raw || typeof raw !== "object") return undefined;

  const keys = Object.keys(raw);
  const wanted = new Set(aliases.map(normalizeLooseKey));

  const matchedKey = keys.find((key) => wanted.has(normalizeLooseKey(key)));
  return matchedKey ? raw[matchedKey] : undefined;
};

const getLooseNum = (raw: any, aliases: string[]) => {
  return toNum(getLooseRawValue(raw, aliases)) ?? 0;
};

/* ---------------- Marking helpers ---------------- */
type CoachMarkingRow = {
  coachId: string;
  coachName: string;

  todayMarking: number;
  yesterdayMarking: number;
  minus2Marking: number;
  minus3Marking: number;
  minus4Marking: number;
  minus5Marking: number;
  minus6Marking: number;
  minus7Marking: number;

  lastWeekPr: number;
  secondWeekPr: number;
  thirdWeekPr: number;
  fourthWeekPr: number;

  monthlyTotalPrDoneOld: number;
  actuallyMonthlyDone: number;
  monthlyTotalPrRequired: number;
  completionRate: number;

  totalOverdue: number;
};

function getCoachMarkingSummary(raw: any): CoachMarkingRow {
  const todayMarking = getLooseNum(raw, ["Today marking"]);

  const yesterdayMarking = getLooseNum(raw, ["Yesterday marking"]);
  const minus2Marking = getLooseNum(raw, ["-2 marking"]);
  const minus3Marking = getLooseNum(raw, ["-3 marking"]);
  const minus4Marking = getLooseNum(raw, ["-4 marking"]);
  const minus5Marking = getLooseNum(raw, ["-5 marking"]);
  const minus6Marking = getLooseNum(raw, ["-6 marking"]);
  const minus7Marking = getLooseNum(raw, ["-7 marking"]);

  const lastWeekPr = getLooseNum(raw, [
    "Last Week PR",
    "-Last Week PR",
  ]);

  const secondWeekPr = getLooseNum(raw, [
    "-Second Week PR",
    "Second Week PR",
    "- Second Week PR",
  ]);

  const thirdWeekPr = getLooseNum(raw, [
    "-Third Week PR",
    "Third Week PR",
    "- Third Week PR",
  ]);

  const fourthWeekPr = getLooseNum(raw, [
    "-Fourth Week PR",
    "- Fourth Week PR",
    "Fourth Week PR",
  ]);

  const monthlyTotalPrDoneOld = getLooseNum(raw, [
    "Monthly Total PR Done + Old",
    "Monthly Total PR Done",
  ]);

  const actuallyMonthlyDone = getLooseNum(raw, [
    "Actually Monthly Done",
  ]);

  const monthlyTotalPrRequired = getLooseNum(raw, [
    "Monthly Total PR Required",
  ]);

  const completionRate = getLooseNum(raw, [
    "Completion Rate",
  ]);

  const totalOverdue = getLooseNum(raw, [
  "evidence_submitted",
]);

  return {
    coachId: String(raw?.case_owner_id ?? raw?.staff_id ?? raw?.case_owner ?? ""),
    coachName: String(raw?.case_owner ?? "Unknown"),

    todayMarking,
    yesterdayMarking,
    minus2Marking,
    minus3Marking,
    minus4Marking,
    minus5Marking,
    minus6Marking,
    minus7Marking,

    lastWeekPr,
    secondWeekPr,
    thirdWeekPr,
    fourthWeekPr,

    monthlyTotalPrDoneOld,
    actuallyMonthlyDone,
    monthlyTotalPrRequired,
    completionRate,

    totalOverdue,
  };
}

function CoachMarkingTable({ rows }: { rows: CoachMarkingRow[] }) {
  const [search, setSearch] = useState("");

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => row.coachName.toLowerCase().includes(q));
  }, [rows, search]);

  const handleExport = () => {
    const headers = [
      "Coach Name",
      "Today marking",
      "Yesterday marking",
      "-2 marking",
      "-3 marking",
      "-4 marking",
      "-5 marking",
      "-6 marking",
      "-7 marking",
      "Last Week PR",
      "-Second Week PR",
      "-Third Week PR",
      "-Fourth Week PR",
      "Monthly Total PR Done + Old",
      "Actually Monthly Done",
      "Monthly Total PR Required",
      "Completion Rate",
      "Total Overdue",
    ];

    const csvRows = filteredRows.map((row) => [
      row.coachName,
      row.todayMarking,
      row.yesterdayMarking,
      row.minus2Marking,
      row.minus3Marking,
      row.minus4Marking,
      row.minus5Marking,
      row.minus6Marking,
      row.minus7Marking,
      row.lastWeekPr,
      row.secondWeekPr,
      row.thirdWeekPr,
      row.fourthWeekPr,
      row.monthlyTotalPrDoneOld,
      row.actuallyMonthlyDone,
      row.monthlyTotalPrRequired,
      `${row.completionRate}%`,
      row.totalOverdue,
    ]);

    const csv = [headers, ...csvRows]
      .map((r) => r.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "coach-marking-overdue-raw.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search coach..."
          className="h-10 min-w-[240px] max-w-sm rounded-md border border-input bg-background px-3 text-sm"
        />

        <button
          onClick={handleExport}
          className="h-10 rounded-md border border-input bg-background px-4 text-sm"
        >
          Export CSV
        </button>
      </div>

      <div className="rounded-lg border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="text-left p-3 font-medium text-muted-foreground">Coach Name</th>
              <th className="text-right p-3 font-medium text-muted-foreground">Today marking</th>
              <th className="text-right p-3 font-medium text-muted-foreground">Yesterday marking</th>
              <th className="text-right p-3 font-medium text-muted-foreground">-2 marking</th>
              <th className="text-right p-3 font-medium text-muted-foreground">-3 marking</th>
              <th className="text-right p-3 font-medium text-muted-foreground">-4 marking</th>
              <th className="text-right p-3 font-medium text-muted-foreground">-5 marking</th>
              <th className="text-right p-3 font-medium text-muted-foreground">-6 marking</th>
              <th className="text-right p-3 font-medium text-muted-foreground">-7 marking</th>
              <th className="text-right p-3 font-medium text-muted-foreground">Last Week PR</th>
              <th className="text-right p-3 font-medium text-muted-foreground">-Second Week PR</th>
              <th className="text-right p-3 font-medium text-muted-foreground">-Third Week PR</th>
              <th className="text-right p-3 font-medium text-muted-foreground">-Fourth Week PR</th>
              <th className="text-right p-3 font-medium text-muted-foreground">Monthly Total PR Done + Old</th>
              <th className="text-right p-3 font-medium text-muted-foreground">Actually Monthly Done</th>
              <th className="text-right p-3 font-medium text-muted-foreground">Monthly Total PR Required</th>
              <th className="text-right p-3 font-medium text-muted-foreground">Completion Rate</th>
              <th className="text-right p-3 font-medium text-muted-foreground">Total Overdue</th>
            </tr>
          </thead>

          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.coachId} className="border-b last:border-b-0">
                <td className="p-3 font-medium text-foreground">{row.coachName}</td>
                <td className="p-3 text-right">{row.todayMarking}</td>
                <td className="p-3 text-right">{row.yesterdayMarking}</td>
                <td className="p-3 text-right">{row.minus2Marking}</td>
                <td className="p-3 text-right">{row.minus3Marking}</td>
                <td className="p-3 text-right">{row.minus4Marking}</td>
                <td className="p-3 text-right">{row.minus5Marking}</td>
                <td className="p-3 text-right">{row.minus6Marking}</td>
                <td className="p-3 text-right">{row.minus7Marking}</td>
                <td className="p-3 text-right">{row.lastWeekPr}</td>
                <td className="p-3 text-right">{row.secondWeekPr}</td>
                <td className="p-3 text-right">{row.thirdWeekPr}</td>
                <td className="p-3 text-right">{row.fourthWeekPr}</td>
                <td className="p-3 text-right">{row.monthlyTotalPrDoneOld}</td>
                <td className="p-3 text-right">{row.actuallyMonthlyDone}</td>
                <td className="p-3 text-right">{row.monthlyTotalPrRequired}</td>
                <td className="p-3 text-right">{row.completionRate}%</td>
                <td className="p-3 text-right font-semibold">{row.totalOverdue}</td>
              </tr>
            ))}

            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={18} className="p-8 text-center text-muted-foreground">
                  No coach marking data found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
/* ---------------- page ---------------- */

export default function Dashboard() {
  const [rows, setRows] = useState<UiCoach[]>([]);
  const [loading, setLoading] = useState(true);

  const [filters, setFilters] = useState<DashboardFilters>({
    coach: "All Coaches",
    rating: "All Ratings",
    programme: "All Programmes",
    risk: "All",
    organisation: "All Organizations",
    status: "All Statuses"
  });

  const [activeKpi, setActiveKpi] = useState<KpiCategory | null>(null);
  const [selectedLearner, setSelectedLearner] = useState<Learner | null>(null);
  const [bookedSessionTypeFilter, setBookedSessionTypeFilter] = useState<
    "All Session Types" | "Progress Review" | "MCM" | "Support Session"
  >("All Session Types");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchUiCoaches();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (activeKpi !== "coaching-booked") {
      setBookedSessionTypeFilter("All Session Types");
    }
  }, [activeKpi]);

  const filteredRows = useMemo(() => applyDashboardFilters(rows, filters), [rows, filters]);

  const activeLearners = useMemo<Learner[]>(() => {
    const out: Learner[] = [];

    for (const coach of filteredRows) {
      const raw = coach.raw as any;

      const prIndex = buildProgressReviewIndex(raw?.overall_progress_review);

      const attLearners = raw?.attendance?.learners ?? [];
      const attById = new Map<string, any>();
      const attByEmail = new Map<string, any>();

      for (const a of attLearners) {
        const id = normId(a?.id);
        const em = normEmail(a?.Email);
        if (id) attById.set(id, a);
        if (em) attByEmail.set(em, a);
      }

      const students = getStudentsFromRaw(raw);

      for (const s of students) {
        const id = normId((s as any)?.ID ?? (s as any)?.id);

        // IMPORTANT: learner email keys from learners_json (Email is correct in your screenshot)
        const emailRaw = pickFirstString(s as any, [
          "Email",
          "email",
          "emailAddress",
          "UserEmail",
          "LearnerEmail",
        ]);
        const email = emailRaw;
        const emailKey = normEmail(emailRaw);

        const fullName = pickFirstString(s as any, ["FullName", "fullName", "DisplayName", "displayName", "name"]);
        const { firstName, lastName } = splitName(fullName);

        const attRec = (id && attById.get(id)) || (emailKey && attByEmail.get(emailKey)) || null;
        const metrics = buildAttendanceMetrics(attRec?.Attendance);

        let priority: Learner["priority"] = priorityFromAttendance(metrics.missedInRow, metrics.absenceRatio);
        const riskCategories: KpiCategory[] = riskCatsFromAttendance(metrics.missedInRow, metrics.absenceRatio);

        const overdueItem =
          (emailKey && prIndex.overdueByEmail.get(emailKey)) || (id && prIndex.overdueById.get(id)) || null;

        const upcomingItem = !overdueItem
          ? (emailKey && prIndex.upcomingByEmail.get(emailKey)) || (id && prIndex.upcomingById.get(id)) || null
          : null;

        let nextProgressReviewDue = "N/A";
        const reviewFlag: "none" | "overdue" | "upcoming" =
          overdueItem ? "overdue" : upcomingItem ? "upcoming" : "none";

        // OTJ fields
        const progressVariance = toNum((s as any)?.ProgressVariance);
        const expectedOtj = toNum((s as any)?.Expected);
        const actualOtj = toNum((s as any)?.Completed);

        const plannedOtj = toNum((s as any)?.Planned);

        const lastProgressReviewDate = pickFirstString(s as any, [
          "Last Progress Review",
          "LastProgressReview",
          "last_progress_review",
        ]);

        const learnerStatusRaw = pickFirstString(s as any, [
          "Program-Status",
          "Program Status",
          "program_status",
          "Status",
          "status",
        ]);

        const learnerStatus: Learner["status"] =
          learnerStatusRaw === "Break in Learning" || learnerStatusRaw === "Withdrawn"
            ? learnerStatusRaw
            : "Active";

        const otjBehindBy = progressVariance != null && progressVariance < 0 ? Math.abs(progressVariance) : 0;

        if (otjBehindBy > 0) {
          if (!riskCategories.includes("otj-behind")) riskCategories.push("otj-behind");
          if (otjBehindBy >= 20) priority = "critical";
          else if (priority === "normal") priority = "high";
        }

        // Monthly coaching booking detection
        // If booking columns are empty for that coach row, bookedIndex.count will be 0
        const bookedMeta = getLearnerBookedMeta(raw, s, id, emailKey, fullName);

        const monthlyCoachingBooked = bookedMeta.booked;
        const monthlyCoachingHasData = bookedMeta.hasData;

        if (monthlyCoachingHasData && !monthlyCoachingBooked) {
          if (!riskCategories.includes("coaching-due")) riskCategories.push("coaching-due");
          if (priority === "normal") priority = "high";
        }

        if (overdueItem) {
          nextProgressReviewDue = String(overdueItem.earliestOverdue || "Overdue");
          if (!riskCategories.includes("review-due")) riskCategories.push("review-due");

          const prio = priorityFromReview(overdueItem.overdueReviews);
          if (prio === "critical" || (prio === "high" && priority === "normal")) priority = prio;
        } else if (upcomingItem) {
          nextProgressReviewDue = String(upcomingItem.nextDue || "Due soon");
          if (!riskCategories.includes("review-due")) riskCategories.push("review-due");

          const d = upcomingItem.nextDue ? parseDDMMYYYY(upcomingItem.nextDue) : null;
          if (d) {
            const diffDays = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            if (diffDays <= 7 && priority === "normal") priority = "high";
          }
        }

        const organisation = pickFirstString(s as any, [
          "OrganizationName",
          "OrganisationName",
          "Organization",
          "Organisation",
          "CompanyName",
          "company_name",
        ]);

        const programme = pickFirstString(s as any, [
          "Program Name",
          "Programme",
          "programme",
          "ProgramName",
          "program_name",
          "Programme Name",
        ]);

        const learner = {
          id: id || emailKey || `${coach.id}:${fullName}`,
          firstName,
          lastName,

          organisation: organisation || "Unknown",
          programme: programme || metrics.latestProgramme || "Unknown",

          coach: coach.name,
          email: emailKey ? emailKey : "Unknown",
          phone: pickFirstString(s as any, ["learner_phone", "Learner_phone", "phone", "Phone"]) || "N/A",

          status: learnerStatus,

          absenceRatio: metrics.absenceRatio,
          missedLast10Weeks: metrics.missedLast10Weeks,
          missedInRow: metrics.missedInRow,
          lastSessionDate: metrics.lastSessionDate,
          lastSessionStatus: metrics.lastSessionStatus,

          lastProgressReviewDate: lastProgressReviewDate || "",
          nextProgressReviewDue,
          progressReviewBooked: false,

          lastMonthlyMeetingDate: "N/A",
          // nextMonthlyMeetingDue: bookedIndex.count > 0 ? (monthlyCoachingBooked ? "Booked" : "Due") : "N/A",
          // monthlyMeetingBooked: bookedIndex.count > 0 ? monthlyCoachingBooked : false,

          plannedOtjHours: plannedOtj ?? 0,
          expectedOtjHours: expectedOtj ?? 0,
          actualOtjHours: actualOtj ?? 0,

          lineManagerName: pickFirstString(s as any, ["ManagerName"]) || "N/A",
          lineManagerEmail: pickFirstString(s as any, ["ManagerEmail"]) || "N/A",
          lineManagerPhone: pickFirstString(s as any, ["ManagerPhone"]) || "N/A",

          hrManagerName: "",
          hrManagerEmail: "",
          hrManagerPhone: "",

          priority,
          riskCategories,
        } as Learner;

        (learner as any).otjBehindBy = otjBehindBy;
        (learner as any).otjBehindPct =
          expectedOtj && expectedOtj > 0 ? Math.round(((expectedOtj - (actualOtj ?? 0)) / expectedOtj) * 100) : 0;

        (learner as any).monthlyCoachingBooked = monthlyCoachingBooked;
        (learner as any).monthlyCoachingHasData = monthlyCoachingHasData;

        (learner as any).monthlyCoachingSessionType = bookedMeta.sessionType;
        (learner as any).monthlyCoachingSessionDate = bookedMeta.sessionDate;

        (learner as any).__reviewFlag = reviewFlag;
        (learner as any).__reviewOverdue = reviewFlag === "overdue";

        out.push(learner);
      }
    }

    return out.filter((l) => l.status === "Active");
  }, [filteredRows]);

  const coachMarkingRows = useMemo<CoachMarkingRow[]>(() => {
    return filteredRows
      .map((coach) => {
        const raw = coach.raw as any;
        return getCoachMarkingSummary(raw);
      })
      .filter((row) => {
        return (
          row.totalOverdue > 0 ||
          row.todayMarking > 0 ||
          row.actuallyMonthlyDone > 0 ||
          row.monthlyTotalPrRequired > 0
        );
      })
      .sort((a, b) => b.totalOverdue - a.totalOverdue);
  }, [filteredRows]);

  const kpiCards = useMemo<KpiCardData[]>(() => {
    const total = activeLearners.length;

    const missed = activeLearners.filter(
      (l) => (l.missedInRow ?? 0) >= 2 || (l.absenceRatio ?? 0) >= 25
    ).length;

    const reviewDue = activeLearners.filter(
      (l) => (l as any).__reviewFlag && (l as any).__reviewFlag !== "none"
    ).length;

    const coachingDue = activeLearners.filter((l) => {
      const hasData = Boolean((l as any).monthlyCoachingHasData);
      const booked = Boolean((l as any).monthlyCoachingBooked);
      return hasData && !booked;
    }).length;

    const coachingBookedBase = activeLearners.filter((l) => {
      const hasData = Boolean((l as any).monthlyCoachingHasData);
      const booked = Boolean((l as any).monthlyCoachingBooked);
      return hasData && booked;
    });

    const coachingBooked =
      activeKpi === "coaching-booked" &&
        bookedSessionTypeFilter !== "All Session Types"
        ? coachingBookedBase.filter(
          (l) =>
            String((l as any).monthlyCoachingSessionType || "Unknown") ===
            bookedSessionTypeFilter
        ).length
        : coachingBookedBase.length;

    const otjBehind = activeLearners.filter(
      (l) => Number((l as any).otjBehindBy ?? 0) > 0
    ).length;

    const coachMarkingOverdue = coachMarkingRows.filter(
      (r) => r.totalOverdue > 0
    ).length;

    const coachMarkingTotal = filteredRows.length;

    const mk = (
      id: KpiCategory,
      title: string,
      count: number,
      totalValue = total
    ): KpiCardData =>
    ({
      id,
      title,
      count,
      total: totalValue,
      percentage: totalValue ? Math.round((count / totalValue) * 100) : 0,
      trend: 0,
      accentClass: kpiAccentClass[id],
    } as KpiCardData);

    return [
      mk("missed-session", "Missed Session", missed),
      mk("review-due", "Review Due", reviewDue),
      mk("coaching-due", "Monthly Meeting Due - Not Booked", coachingDue),
      mk("coaching-booked", "Monthly Meeting - Booked", coachingBooked),
      mk("otj-behind", "OTJ Behind", otjBehind),
      mk(
        "coach-marking-overdue",
        "Coach Marking - Overdue",
        coachMarkingOverdue,
        coachMarkingTotal
      ),
    ];
  }, [activeLearners, coachMarkingRows, activeKpi, bookedSessionTypeFilter]);

  const filteredLearners = useMemo(() => {
    if (!activeKpi) return [];

    if (activeKpi === "missed-session") {
      return activeLearners.filter((l) => (l.missedInRow ?? 0) >= 2 || (l.absenceRatio ?? 0) >= 25);
    }

    if (activeKpi === "review-due") {
      return activeLearners.filter((l) => (l as any).__reviewFlag && (l as any).__reviewFlag !== "none");
    }

    if (activeKpi === "coaching-due") {
      return activeLearners
        .filter((l) => Boolean((l as any).monthlyCoachingHasData) && !Boolean((l as any).monthlyCoachingBooked))
        .sort((a, b) => (a.coach || "").localeCompare(b.coach || ""));
    }

    if (activeKpi === "coaching-booked") {
      const base = activeLearners
        .filter((l) => Boolean((l as any).monthlyCoachingHasData) && Boolean((l as any).monthlyCoachingBooked))
        .sort((a, b) => (a.coach || "").localeCompare(b.coach || ""));

      if (bookedSessionTypeFilter === "All Session Types") {
        return base;
      }

      return base.filter(
        (l) =>
          String((l as any).monthlyCoachingSessionType || "Unknown") === bookedSessionTypeFilter
      );
    }

    if (activeKpi === "otj-behind") {
      return activeLearners
        .filter((l) => Number((l as any).otjBehindBy ?? 0) > 0)
        .sort((a, b) => Number((b as any).otjBehindBy ?? 0) - Number((a as any).otjBehindBy ?? 0));
    }

    return [];
  }, [activeLearners, activeKpi, bookedSessionTypeFilter]);

  // const coachingBookedHeaderCount = useMemo(() => {
  //   if (activeKpi !== "coaching-booked") return filteredLearners.length;

  //   if (bookedSessionTypeFilter === "All Session Types") {
  //     return filteredLearners.length;
  //   }

  //   return filteredLearners.filter(
  //     (l) =>
  //       String((l as any).monthlyCoachingSessionType || "Unknown") === bookedSessionTypeFilter
  //   ).length;
  // }, [activeKpi, filteredLearners, bookedSessionTypeFilter]);

  return (
    <AppLayout>
      <GlobalFilters rows={rows} loading={loading} filters={filters} onChange={setFilters} onRefresh={load} />

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {kpiCards.map((card, i) => (
            <div key={card.id} className="animate-fade-in" style={{ animationDelay: `${i * 80}ms` }}>
              <KpiCard
                data={card}
                active={activeKpi === card.id}
                onClick={() => setActiveKpi(activeKpi === card.id ? null : (card.id as KpiCategory))}
              />
            </div>
          ))}
        </div>

        {activeKpi === "coach-marking-overdue" && (
          <div>
            <h3 className="text-base font-semibold text-foreground mb-3">
              {kpiCards.find((c) => c.id === activeKpi)?.title} , {coachMarkingRows.length} coach
              {coachMarkingRows.length !== 1 ? "es" : ""}
            </h3>

            <CoachMarkingTable rows={coachMarkingRows} />
          </div>
        )}

        {activeKpi && activeKpi !== "coach-marking-overdue" && (
          <div>
            <h3 className="text-base font-semibold text-foreground mb-3">
              {kpiCards.find((c) => c.id === activeKpi)?.title} , {filteredLearners.length} learner
              {filteredLearners.length !== 1 ? "s" : ""}
            </h3>

            <LearnerTable
              learners={filteredLearners}
              kpiCategory={activeKpi}
              onSelectLearner={setSelectedLearner}
              sessionTypeFilter={bookedSessionTypeFilter}
              onSessionTypeFilterChange={setBookedSessionTypeFilter}
            />
          </div>
        )}

        {!activeKpi && (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-lg">Click a KPI card above to view learners requiring action</p>
            <p className="text-sm mt-1">Select a risk category to see the detailed learner list</p>
          </div>
        )}
      </div>

      <LearnerDrawer learner={selectedLearner} open={!!selectedLearner} onClose={() => setSelectedLearner(null)} />
    </AppLayout>
  );
}