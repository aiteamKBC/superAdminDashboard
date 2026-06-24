// src/pages/Index.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3 } from "lucide-react";

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
import type { ProgressReviewSummaryRow } from "@/lib/types/kbc";

/* ---------------- helpers ---------------- */
const getLatestAttendanceModule = (attendance?: AttendanceInput) => {
  const entries = normalizeAttendanceEntries(attendance)
    .map((entry) => ({
      parsed: entry.parsed,
      sortIndex: entry.sortIndex,
      module: getModuleLabel(entry.value?.module),
    }))
    .filter((x) => x.module)
    .sort((a, b) => {
      const diff = a.parsed.getTime() - b.parsed.getTime();
      if (diff !== 0) return diff;
      return a.sortIndex - b.sortIndex;
    });

  return entries.length ? entries[entries.length - 1].module : "";
};

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
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
};

const safePct = (num: number, den: number) => {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return 0;
  return Math.round((num / den) * 100);
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

const parseAttendanceDate = (raw: string): Date | null => {
  const s = String(raw || "").trim();
  if (!s) return null;

  const m = s.match(/^(\d{4})[-/\s](\d{2})[-/\s](\d{2})/);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);

  const dt = new Date(year, month - 1, day);
  if (Number.isNaN(dt.getTime())) return null;

  dt.setHours(0, 0, 0, 0);
  return dt;
};

const formatDateKey = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const startOfDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

const getExactWeekRange = (weekIndex: 0 | 1 | 2 | 3) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Monday-based week: find Monday of current week
  const dayOfWeek = today.getDay(); // 0=Sun … 6=Sat
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const start = new Date(today);
  start.setDate(today.getDate() - daysToMonday - weekIndex * 7);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
};

const isDateInExactWeekBucket = (date: Date, weekIndex: 0 | 1 | 2 | 3) => {
  const { start, end } = getExactWeekRange(weekIndex);
  return date >= start && date <= end;
};

const formatUiDate = (date: Date) => {
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const getWeekLabel = (weekIndex: 0 | 1 | 2 | 3) => {
  const { start, end } = getExactWeekRange(weekIndex);
  return `${formatUiDate(start)} - ${formatUiDate(end)}`;
};

const normalizeAttendanceValue = (value: unknown): number | null => {
  if (value === 1 || value === true) return 1;
  if (value === 0 || value === false) return 0;

  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "present", "attended", "yes", "true"].includes(normalized)) return 1;
  if (["0", "absent", "missed", "no", "false"].includes(normalized)) return 0;

  return null;
};

function buildAttendanceMetricsFromRecords(
  records: Array<{ date: string | null; attendance: unknown; module: string }>,
  absenceWeeks: "all" | 0 | 1 | 2 | 3 = 0
) {
  const empty = {
    absenceRatio: 0, missedLast10Weeks: 0, missedInRow: 0,
    missedCountInWindow: 0, lastSessionDate: "N/A",
    lastSessionStatus: "Unknown" as Learner["lastSessionStatus"],
    latestProgramme: "Unknown", hasAttendanceInWindow: false,
  };
  if (!records.length) return empty;

  const sorted = [...records]
    .filter((r) => r.date != null)
    .sort((a, b) => a.date!.localeCompare(b.date!));

  if (!sorted.length) return empty;

  const filtered =
    absenceWeeks === "all"
      ? sorted
      : sorted.filter((r) => {
          const dt = parseBookedDate(r.date);
          return dt !== null && isDateInExactWeekBucket(dt, absenceWeeks);
        });

  const hasAttendanceInWindow = filtered.length > 0;
  const source = filtered.length > 0 ? filtered : sorted;
  const last = source[source.length - 1];
  const lastVal = normalizeAttendanceValue(last?.attendance);
  const lastStatus = (
    lastVal == null ? "Unknown" : lastVal === 1 ? "Attended" : "Missed"
  ) as Learner["lastSessionStatus"];

  const now = new Date();
  const tenWeeksAgo = startOfDay(new Date(now));
  tenWeeksAgo.setDate(tenWeeksAgo.getDate() - 69);
  const missedLast10Weeks = sorted.filter((r) => {
    const dt = parseBookedDate(r.date);
    return dt !== null && dt >= tenWeeksAgo && normalizeAttendanceValue(r.attendance) === 0;
  }).length;

  let missedInRow = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (normalizeAttendanceValue(sorted[i].attendance) === 0) missedInRow++;
    else break;
  }

  const total = filtered.length;
  const attended = filtered.filter((r) => normalizeAttendanceValue(r.attendance) === 1).length;
  const missedCountInWindow = total - attended;

  // Absence ratio based on all sessions in the learner's current module overall
  const latestModule = last?.module || "";
  const moduleRecords = latestModule
    ? sorted.filter((r) => r.module === latestModule)
    : sorted;
  const absenceRatio = safePct(
    moduleRecords.filter((r) => normalizeAttendanceValue(r.attendance) === 0).length,
    moduleRecords.length
  );
  const latestProgramme = last?.module ? parseProgrammeFromModule(last.module) : "Unknown";

  return {
    absenceRatio, missedLast10Weeks, missedInRow, missedCountInWindow,
    lastSessionDate: last?.date || "N/A", lastSessionStatus: lastStatus,
    latestProgramme, hasAttendanceInWindow,
  };
}

const getLatestAttendanceModuleFromRecords = (
  records: Array<{ date: string | null; attendance: unknown; module: string }>
) => {
  const entries = records
    .filter((record) => record.date && record.module)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return entries.length ? String(entries[entries.length - 1].module || "").trim() : "";
};

const getLastCompletedSessionDateFromRecords = (
  records: Array<{ date: string | null; attendance: unknown; module: string }>
) => {
  const completed = records
    .filter((record) => record.date && normalizeAttendanceValue(record.attendance) === 1)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return completed.length ? String(completed[completed.length - 1].date || "N/A") : "N/A";
};

const kpiAccentClass: Record<KpiCategory, string> = {
  "missed-session": "border-l-4 border-l-[#E05C68]",
  "review-due": "border-l-4 border-l-[#2D73D5]",
  "review-booked": "border-l-4 border-l-[#1C9B7A]",
  "coaching-due": "border-l-4 border-l-[#7A61D1]",
  "coaching-booked": "border-l-4 border-l-[#0E8EC7]",
  "otj-behind": "border-l-4 border-l-[#E4A11B]",
  "coach-marking-overdue": "border-l-4 border-l-[#31506F]",
  "status-view": "border-l-4 border-l-[#31506F]",
};

type PrOffset = number | "last12weeks";

const getPrQuarterRange = (offset: number) => {
  const now = new Date();
  const currentQ = Math.floor(now.getMonth() / 3);
  const targetQ = currentQ + offset;
  const yearShift = Math.floor(targetQ / 4);
  const normQ = ((targetQ % 4) + 4) % 4;
  const year = now.getFullYear() + yearShift;
  const startMonth = normQ * 3;
  const start = new Date(year, startMonth, 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(year, startMonth + 3, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const getPrDateRange = (offset: PrOffset): { start: Date; end: Date } => {
  if (offset === "last12weeks") {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    // Align start to the Monday of the current week, then go back 12 weeks
    const dow = end.getDay(); // 0=Sun, 1=Mon … 6=Sat
    const start = new Date(end);
    start.setDate(end.getDate() - 7 * 12 + 1);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }
  return getPrQuarterRange(offset);
};

// kept same name so GlobalFilters prop interface doesn't change
const getPrMonthRange = getPrQuarterRange;

const getMcrMonthRange = (offset: number): { start: Date; end: Date } => {
  const now = new Date();
  if (offset === -1) {
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(end.getDate() - 30);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const getPrMonthLabel = (offset: PrOffset): string => {
  if (offset === "last12weeks") return "Last 12 Weeks";
  const now = new Date();
  const currentQ = Math.floor(now.getMonth() / 3);
  const targetQ = currentQ + offset;
  const yearShift = Math.floor(targetQ / 4);
  const normQ = ((targetQ % 4) + 4) % 4;
  const year = now.getFullYear() + yearShift;
  return `Q${normQ + 1} ${year}`;
};

const getMcrPeriodLabel = (offset: number): string => {
  if (offset === -1) return "Last 30 days";
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  if (offset === 0) return `This Month - ${d.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`;
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
};

type AttendanceDayEntry = { value?: number; module?: string };
type AttendanceInput =
  | Record<string, AttendanceDayEntry | AttendanceDayEntry[]>
  | undefined;

function normalizeAttendanceEntries(att?: AttendanceInput) {
  const entries = Object.entries(att || {});
  if (!entries.length) return [];

  return entries
    .flatMap(([rawKey, rawValue]) => {
      const parsed = parseAttendanceDate(rawKey);
      if (!parsed) return [];

      const values = Array.isArray(rawValue)
        ? rawValue
        : rawValue && typeof rawValue === "object"
          ? [rawValue]
          : [];

      return values.map((value, index) => ({
        rawKey,
        parsed,
        normalizedDate: formatDateKey(parsed),
        value: value || {},
        sortIndex: index,
      }));
    })
    .sort((a, b) => {
      const diff = a.parsed.getTime() - b.parsed.getTime();
      if (diff !== 0) return diff;
      return a.sortIndex - b.sortIndex;
    });
}

function buildAttendanceMetrics(
  att?: AttendanceInput,
  absenceWeeks: "all" | 0 | 1 | 2 | 3 = 0
) {
  const allEntries = normalizeAttendanceEntries(att);

  if (!allEntries.length) {
    return {
      absenceRatio: 0,
      missedLast10Weeks: 0,
      missedInRow: 0,
      missedCountInWindow: 0,
      lastSessionDate: "N/A",
      lastSessionStatus: "Unknown" as Learner["lastSessionStatus"],
      latestProgramme: "Unknown",
      hasAttendanceInWindow: false,
    };
  }

  const filteredEntries =
    absenceWeeks === "all"
      ? allEntries
      : allEntries.filter((item) => isDateInExactWeekBucket(item.parsed, absenceWeeks));

  const hasAttendanceInWindow = filteredEntries.length > 0;

  const sourceEntriesForLastSession =
    filteredEntries.length > 0 ? filteredEntries : allEntries;

  const lastEntry = sourceEntriesForLastSession[sourceEntriesForLastSession.length - 1] || null;
  const lastVal = lastEntry?.value?.value ?? null;

  const lastStatus = (
    lastVal == null ? "Unknown" : lastVal === 1 ? "Attended" : "Missed"
  ) as Learner["lastSessionStatus"];

  // آخر 10 أسابيع من تاريخ اليوم
  const now = new Date();
  const tenWeeksAgo = startOfDay(new Date(now));
  tenWeeksAgo.setDate(tenWeeksAgo.getDate() - 69);

  const entriesLast10Weeks = allEntries.filter((item) => item.parsed >= tenWeeksAgo);

  const missedLast10Weeks = entriesLast10Weeks.reduce(
    (acc, item) => acc + ((item.value?.value ?? 0) === 0 ? 1 : 0),
    0
  );

  // streak من آخر session حقيقي ورا بعض
  let missedInRow = 0;
  for (let i = allEntries.length - 1; i >= 0; i--) {
    const v = allEntries[i]?.value?.value;
    if (v === 0) {
      missedInRow++;
    } else {
      break;
    }
  }

  const total = filteredEntries.length;
  const attended = filteredEntries.reduce(
    (acc, item) => acc + ((item.value?.value ?? 0) === 1 ? 1 : 0),
    0
  );

  const missedCountInWindow = filteredEntries.reduce(
    (acc, item) => acc + ((item.value?.value ?? 0) === 0 ? 1 : 0),
    0
  );

  const absenceRatio = safePct(total - attended, total);

  const mod = lastEntry?.value?.module;
  const latestProgramme = mod ? parseProgrammeFromModule(mod) : "Unknown";

  return {
    absenceRatio,
    missedLast10Weeks,
    missedInRow,
    missedCountInWindow,
    lastSessionDate: lastEntry?.normalizedDate || "N/A",
    lastSessionStatus: lastStatus,
    latestProgramme,
    hasAttendanceInWindow,
  };
}

function priorityFromAttendance(missedInRow: number): Learner["priority"] {
  if (missedInRow > 2) return "critical";
  if (missedInRow >= 1) return "high";
  return "normal";
}

function riskCatsFromAttendance(missedInRow: number, absenceRatio: number): KpiCategory[] {
  const cats: KpiCategory[] = [];
  if (missedInRow >= 2 || absenceRatio >= 25) cats.push("missed-session");
  return cats;
}

const getLastCompletedSessionDate = (attendance?: AttendanceInput) => {
  const entries = normalizeAttendanceEntries(attendance);

  if (!entries.length) return "N/A";

  const completed = entries.filter((x) => (x.value?.value ?? 0) === 1);
  if (!completed.length) return "N/A";

  return completed[completed.length - 1].normalizedDate;
};

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

const lowerText = (v: unknown) => String(v ?? "").trim().toLowerCase();

const matchesExactFilterValue = (candidate: unknown, selected: string) => {
  return lowerText(candidate) === lowerText(selected);
};

const matchesAnyExactFilterValue = (candidates: unknown[], selected: string) =>
  candidates.some((candidate) => matchesExactFilterValue(candidate, selected));

const BOOKED_TYPE_LABELS = {
  booked_students_PR: "Progress Review",
  booked_students_MCM: "MCM",
  booked_students_StSupport: "Support Session",
} as const;

type SessionType = (typeof BOOKED_TYPE_LABELS)[keyof typeof BOOKED_TYPE_LABELS] | "Unknown";

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

const getBookedStudentField = (student: any, keys: string[]) => {
  return pickFirstString(student, keys) || "N/A";
};

const normName = (v: unknown) =>
  String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const sameLooseName = (a: unknown, b: unknown) => {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
};

const getModuleLabel = (moduleStr: unknown) => String(moduleStr ?? "").trim();

/*date filter*/
const parseBookedDate = (value: unknown): Date | null => {
  const s = String(value || "").trim();
  if (!s) return null;

  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;

  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(dt.getTime())) return null;

  dt.setHours(0, 0, 0, 0);
  return dt;
};

const parseMcmStatusDate = (status: unknown): Date | null => {
  const match = String(status || "").match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (!match) return null;
  const year = match[3].length === 2 ? Number(`20${match[3]}`) : Number(match[3]);
  const dt = new Date(year, Number(match[2]) - 1, Number(match[1]));
  if (Number.isNaN(dt.getTime())) return null;
  dt.setHours(0, 0, 0, 0);
  return dt;
};

const getMcmScopeDate = (entry: any): Date | null => {
  const statusLower = String(entry?.status || "").toLowerCase();
  const statusDate = statusLower.includes("not scheduled") ? null : parseMcmStatusDate(entry?.status);
  return statusDate || parseBookedDate(entry?.date);
};

const isTodayOrFuture = (value: unknown) => {
  const dt = parseBookedDate(value);
  if (!dt) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return dt.getTime() >= today.getTime();
};

const isDateWithinRange = (
  dt: Date | null,
  start: Date,
  end: Date,
  excludeStart = false
) => {
  if (dt === null || dt > end) return false;
  return excludeStart ? dt > start : dt >= start;
};

const getProgressReviewMatchInRange = (
  row: any,
  start: Date,
  end: Date,
  includeCompleted: boolean,
  beforeDate?: Date
) => {
  const dates = (row?.plannedDates || []) as Array<{
    date: string;
    completed: boolean;
    isPast?: boolean;
    status?: string;
  }>;

  const matchesRange = (dt: Date | null) => dt !== null && dt >= start && dt <= end;

  if (dates.length > 0) {
    return dates.find((d) => {
      if (!includeCompleted && d.completed) return false;
      const dt = parseBookedDate(d.date);
      if (!matchesRange(dt)) return false;
      if (beforeDate && dt && dt >= beforeDate) return false;
      return true;
    });
  }

  const dt = parseBookedDate(row?.nextPrDate);
  if (!matchesRange(dt) || (beforeDate && dt && dt >= beforeDate)) return undefined;

  return {
    date: row?.nextPrDate || "",
    completed: false,
    status: row?.nextPrState || "",
  };
};

const getProgressReviewStatusLabel = (status: unknown) => {
  const s = String(status || "").trim();
  if (!s) return "";
  const m = s.match(/\(([^)]+)\)\s*$/);
  return (m?.[1] || s).trim();
};

const formatProgressReviewReason = (match: { date?: string; status?: string } | undefined) => {
  if (!match?.date) return "N/A";
  const status = getProgressReviewStatusLabel(match.status);
  return status ? `${match.date} (${status})` : match.date;
};

const isPastProgressReviewDate = (
  item: { isPast?: boolean },
  dt: Date | null,
  beforeDate?: Date
) => {
  if (beforeDate) return dt !== null && dt < beforeDate;
  if (typeof item.isPast === "boolean") return item.isPast;
  return true;
};

const isBookedProgressReviewStatus = (status: unknown) => {
  const s = String(status || "").trim().toLowerCase();
  if (!s || s.includes("not scheduled")) return false;
  return (
    s.includes("scheduled") ||
    s.includes("in progress") ||
    s.includes("awaiting signature") ||
    s.includes("completed")
  );
};

const getBookedProgressReviewMatchInRange = (
  row: any,
  start: Date,
  end: Date,
  beforeDate?: Date
) => {
  const dates = (row?.plannedDates || []) as Array<{
    date: string;
    completed: boolean;
    isPast?: boolean;
    status?: string;
  }>;

  return dates.find((d) => {
    const dt = parseBookedDate(d.date);
    if (dt === null || dt < start || dt > end) return false;
    if (!isPastProgressReviewDate(d, dt, beforeDate)) return false;
    return isBookedProgressReviewStatus(d.status);
  });
};

/*Bring all the data*/
const getLearnerIdentityCandidates = (learner: any, fullName: string, emailKey: string, id: string) => {
  const learnerEmail = normEmail(
    emailKey ||
    pickFirstString(learner, ["Email", "email", "emailAddress", "UserEmail", "LearnerEmail"])
  );

  const learnerNameNorm = normName(
    fullName ||
    pickFirstString(learner, ["FullName", "fullName", "DisplayName", "displayName", "name"])
  );

  const learnerId = normId(id || learner?.ID || learner?.id);

  return { learnerEmail, learnerNameNorm, learnerId };
};

const bookingMatchesLearner = (
  student: any,
  learnerId: string,
  learnerEmail: string,
  learnerNameNorm: string
) => {
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
    (learnerEmail && bookedEmail && learnerEmail === bookedEmail) ||
    (learnerNameNorm && bookedName && sameLooseName(learnerNameNorm, bookedName))
  );
};

/*Date of the session*/
const getLearnerBookedMetaByType = (
  raw: any,
  learner: any,
  learnerId: string,
  learnerEmailKey: string,
  learnerFullName: string,
  targetType: SessionType
): {
  booked: boolean;
  hasData: boolean;
  sessionType: SessionType;
  sessionDate: string;
  serviceName: string;
  groupName: string;
} => {
  const bookedEntries = getBookedEntriesFromRaw(raw).filter(
    (entry) =>
      entry.sessionType === targetType &&
      isTodayOrFuture(
        pickFirstString(entry.student, ["dayDate", "DayDate", "date", "sessionDate"])
      )
  );

  if (!bookedEntries.length) {
    return {
      booked: false,
      hasData: false,
      sessionType: targetType,
      sessionDate: "N/A",
      serviceName: "N/A",
      groupName: "N/A",
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
      sessionType: targetType,
      sessionDate: "N/A",
      serviceName: "N/A",
      groupName: "N/A",
    };
  }

  const student = matchedBooking.student || {};

  return {
    booked: true,
    hasData: true,
    sessionType: matchedBooking.sessionType,
    sessionDate:
      pickFirstString(student, ["dayDate", "DayDate", "date", "sessionDate"]) || "N/A",
    serviceName:
      pickFirstString(student, ["serviceName", "ServiceName"]) || "N/A",
    groupName:
      pickFirstString(student, ["Group", "group"]) || "N/A",
  };
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
  serviceName: string;
  groupName: string;
} => {
  const bookedEntries = getBookedEntriesFromRaw(raw).filter((entry) =>
    isTodayOrFuture(
      pickFirstString(entry.student, ["dayDate", "DayDate", "date", "sessionDate"])
    )
  );

  if (!bookedEntries.length) {
    return {
      booked: false,
      hasData: false,
      sessionType: "Unknown",
      sessionDate: "N/A",
      serviceName: "N/A",
      groupName: "N/A",
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
      serviceName: "N/A",
      groupName: "N/A",
    };
  }

  const student = matchedBooking.student || {};

  return {
    booked: true,
    hasData: true,
    sessionType: matchedBooking.sessionType,
    sessionDate:
      pickFirstString(student, ["dayDate", "DayDate", "date", "sessionDate"]) || "N/A",
    serviceName:
      pickFirstString(student, ["serviceName", "ServiceName"]) || "N/A",
    groupName:
      pickFirstString(student, ["Group", "group"]) || "N/A",
  };
};

type ReviewListItem = {
  ID?: string;
  Email?: string;
  FullName?: string;
  overdueReviews?: number;
  earliestOverdue?: string;
  nextPrDate?: string;
};

const getReviewDate = (item: any) =>
  pickFirstString(item, [
    "nextPrDate",
    "NextPrDate",
    "next_pr_date",
    "nextReviewDate",
    "NextReviewDate",
    "reviewDate",
    "ReviewDate",
    "earliestOverdue",
  ]) || "N/A";

function buildProgressReviewIndex(overall: unknown) {
  const o = overall as any;

  const overdue: ReviewListItem[] = o?.overall?.lists?.overdueLearners ?? [];
  const upcoming: ReviewListItem[] = o?.overall?.lists?.upcomingLearners ?? [];

  const overdueByEmail = new Map<string, ReviewListItem>();
  const overdueById = new Map<string, ReviewListItem>();

  const upcomingByEmail = new Map<string, ReviewListItem>();
  const upcomingById = new Map<string, ReviewListItem>();

  for (const it of overdue) {
    const e = normEmail(it?.Email);
    const id = normId(it?.ID);

    if (e) overdueByEmail.set(e, it);
    if (id) overdueById.set(id, it);
  }

  for (const it of upcoming) {
    const e = normEmail(it?.Email);
    const id = normId(it?.ID);

    if (e) upcomingByEmail.set(e, it);
    if (id) upcomingById.set(id, it);
  }

  return {
    overdueByEmail,
    overdueById,
    upcomingByEmail,
    upcomingById,
  };
}

function priorityFromReview(overdueReviews: number | undefined): Learner["priority"] {
  const n = Number(overdueReviews ?? 1);
  if (n >= 2) return "critical";
  return "high";
}

const toNum = (v: any): number | null => {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replace(/[%+,]/g, ""));
  return Number.isFinite(n) ? n : null;
};

type OtjPriority = "normal" | "need-attention" | "at-risk";

const getOtjPriority = (behindPct: number): OtjPriority => {
  const pct = Math.max(0, Math.abs(Number(behindPct) || 0));

  if (pct > 40) return "at-risk";
  if (pct > 20) return "need-attention";
  return "normal";
};

const getOtjPriorityLabel = (priority: OtjPriority) => {
  switch (priority) {
    case "at-risk":
      return "At Risk";
    case "need-attention":
      return "Need Attention";
    default:
      return "Normal";
  }
};

const stripLeadingMinus = (v: unknown) =>
  String(v ?? "")
    .trim()
    .replace(/^\s*-\s*/, "")
    .trim();

const hasLeadingMinus = (v: unknown) => /^\s*-/.test(String(v ?? "").trim());

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

  const lastWeekPr = getLooseNum(raw, ["Last Week PR", "-Last Week PR"]);
  const secondWeekPr = getLooseNum(raw, ["-Second Week PR", "Second Week PR", "- Second Week PR"]);
  const thirdWeekPr = getLooseNum(raw, ["-Third Week PR", "Third Week PR", "- Third Week PR"]);
  const fourthWeekPr = getLooseNum(raw, ["-Fourth Week PR", "- Fourth Week PR", "Fourth Week PR"]);

  const monthlyTotalPrDoneOld = getLooseNum(raw, [
    "Monthly Total PR Done + Old",
    "Monthly Total PR Done",
  ]);

  const actuallyMonthlyDone = getLooseNum(raw, ["Actually Monthly Done"]);
  const monthlyTotalPrRequired = getLooseNum(raw, ["Monthly Total PR Required"]);
  const completionRate = getLooseNum(raw, ["Completion Rate"]);
  const totalOverdue = toNum(raw?.evidence_submitted) ?? 0;

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

const getWeeklyMarkedTotal = (row: CoachMarkingRow) =>
  row.todayMarking +
  row.yesterdayMarking +
  row.minus2Marking +
  row.minus3Marking +
  row.minus4Marking +
  row.minus5Marking +
  row.minus6Marking +
  row.minus7Marking;

const getWeeklyCorrectionRate = (row: CoachMarkingRow) => {
  const weeklyMarked = getWeeklyMarkedTotal(row);
  const overdue = Math.max(0, Number(row.totalOverdue || 0));
  const denominator = weeklyMarked + overdue;

  if (denominator <= 0) return 0;
  return Math.round((weeklyMarked / denominator) * 100);
};

function CoachMarkingTable({ rows }: { rows: CoachMarkingRow[] }) {
  const [search, setSearch] = useState("");

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => row.coachName.toLowerCase().includes(q));
  }, [rows, search]);

  const totals = useMemo(() => {
    const base = {
      totalEvidence: 0,
      todayMarking: 0,
      yesterdayMarking: 0,
      minus2Marking: 0,
      minus3Marking: 0,
      minus4Marking: 0,
      minus5Marking: 0,
      minus6Marking: 0,
      minus7Marking: 0,
      weeklyMarkedTotal: 0,
      avgWeeklyCorrectionRate: 0,
    };

    if (!filteredRows.length) return base;

    const summed = filteredRows.reduce(
      (acc, row) => {
        acc.totalEvidence += row.totalOverdue;
        acc.todayMarking += row.todayMarking;
        acc.yesterdayMarking += row.yesterdayMarking;
        acc.minus2Marking += row.minus2Marking;
        acc.minus3Marking += row.minus3Marking;
        acc.minus4Marking += row.minus4Marking;
        acc.minus5Marking += row.minus5Marking;
        acc.minus6Marking += row.minus6Marking;
        acc.minus7Marking += row.minus7Marking;
        acc.weeklyMarkedTotal += getWeeklyMarkedTotal(row);
        return acc;
      },
      { ...base }
    );

    const denominator = summed.weeklyMarkedTotal + summed.totalEvidence;
    const avgWeeklyCorrectionRate =
      denominator > 0
        ? Math.round((summed.weeklyMarkedTotal / denominator) * 100)
        : 0;

    return {
      ...summed,
      avgWeeklyCorrectionRate,
    };
  }, [filteredRows]);

  const progressRows = useMemo(() => {
    return filteredRows
      .map((row) => {
        const weeklyMarked = getWeeklyMarkedTotal(row);
        const correctionRate = getWeeklyCorrectionRate(row);

        return {
          coachId: row.coachId,
          coachName: row.coachName,
          totalEvidence: row.totalOverdue,
          weeklyMarked,
          correctionRate,
        };
      })
      .sort((a, b) => {
        if (b.correctionRate !== a.correctionRate) {
          return b.correctionRate - a.correctionRate;
        }
        if (b.weeklyMarked !== a.weeklyMarked) {
          return b.weeklyMarked - a.weeklyMarked;
        }
        return b.totalEvidence - a.totalEvidence;
      });
  }, [filteredRows]);

  const handleExport = () => {
    const headers = [
      "Coach Name",
      "Pending Evidence",
      "Today marking",
      "Yesterday marking",
      "-2 marking",
      "-3 marking",
      "-4 marking",
      "-5 marking",
      "-6 marking",
      "-7 marking",
      "Weekly Marked Total",
      "Weekly Correction Rate %",
    ];

    const csvRows = filteredRows.map((row) => {
      const weeklyMarked = getWeeklyMarkedTotal(row);
      const correctionRate = getWeeklyCorrectionRate(row);

      return [
        row.coachName,
        row.totalOverdue,
        row.todayMarking,
        row.yesterdayMarking,
        row.minus2Marking,
        row.minus3Marking,
        row.minus4Marking,
        row.minus5Marking,
        row.minus6Marking,
        row.minus7Marking,
        weeklyMarked,
        `${correctionRate}%`,
      ];
    });

    csvRows.push([
      "TOTAL",
      totals.totalEvidence,
      totals.todayMarking,
      totals.yesterdayMarking,
      totals.minus2Marking,
      totals.minus3Marking,
      totals.minus4Marking,
      totals.minus5Marking,
      totals.minus6Marking,
      totals.minus7Marking,
      totals.weeklyMarkedTotal,
      `${totals.avgWeeklyCorrectionRate}%`,
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
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search coach..."
          className="h-11 w-full sm:max-w-sm rounded-xl border border-[#E4E4E4] bg-white px-3 text-sm text-[#4C4C4C] outline-none"
        />

        <button
          onClick={handleExport}
          className="h-11 w-full sm:w-auto rounded-xl border border-[#E4E4E4] bg-[#FCF3FF] px-4 text-sm font-medium text-[#866CB6]"
        >
          Export CSV
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-[#E4E4E4] bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-[#808080]">Pending Evidence</p>
          <p className="mt-2 text-2xl font-bold text-[#4C4C4C]">{totals.totalEvidence}</p>
        </div>

        <div className="rounded-2xl border border-[#E4E4E4] bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-[#808080]">Weekly Marked Total</p>
          <p className="mt-2 text-2xl font-bold text-[#4C4C4C]">{totals.weeklyMarkedTotal}</p>
        </div>

        <div className="rounded-2xl border border-[#E4E4E4] bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-[#808080]">Weekly Correction Rate</p>
          <p className="mt-2 text-2xl font-bold text-[#644D93]">
            {totals.avgWeeklyCorrectionRate}%
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#E4E4E4] bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[1350px] w-full text-sm">
            <thead>
              <tr className="border-b border-[#EDEDED] bg-[#FCF3FF]">
                <th className="sticky left-0 z-10 bg-[#FCF3FF] text-left p-3 font-medium text-[#808080] border-r border-[#EDEDED]">Coach Name</th>
                <th className="text-right p-3 font-medium text-[#808080]">Pending Evidence</th>
                <th className="text-right p-3 font-medium text-[#808080]">Today marking</th>
                <th className="text-right p-3 font-medium text-[#808080]">Yesterday marking</th>
                <th className="text-right p-3 font-medium text-[#808080]">-2 marking</th>
                <th className="text-right p-3 font-medium text-[#808080]">-3 marking</th>
                <th className="text-right p-3 font-medium text-[#808080]">-4 marking</th>
                <th className="text-right p-3 font-medium text-[#808080]">-5 marking</th>
                <th className="text-right p-3 font-medium text-[#808080]">-6 marking</th>
                <th className="text-right p-3 font-medium text-[#808080]">-7 marking</th>
                <th className="text-right p-3 font-medium text-[#808080]">Weekly Marked</th>
                <th className="text-right p-3 font-medium text-[#808080]">Correction Rate</th>
              </tr>
            </thead>

            <tbody>
              {filteredRows.map((row) => {
                const weeklyMarked = getWeeklyMarkedTotal(row);
                const correctionRate = getWeeklyCorrectionRate(row);

                return (
                  <tr key={row.coachId} className="border-b border-[#F1F1F1] last:border-b-0">
                    <td className="sticky left-0 z-10 bg-white p-3 font-medium text-[#4C4C4C] border-r border-[#F1F1F1]">{row.coachName}</td>
                    <td className="p-3 text-right font-semibold text-[#644D93]">{row.totalOverdue}</td>
                    <td className="p-3 text-right">{row.todayMarking}</td>
                    <td className="p-3 text-right">{row.yesterdayMarking}</td>
                    <td className="p-3 text-right">{row.minus2Marking}</td>
                    <td className="p-3 text-right">{row.minus3Marking}</td>
                    <td className="p-3 text-right">{row.minus4Marking}</td>
                    <td className="p-3 text-right">{row.minus5Marking}</td>
                    <td className="p-3 text-right">{row.minus6Marking}</td>
                    <td className="p-3 text-right">{row.minus7Marking}</td>
                    <td className="p-3 text-right font-semibold text-[#4C4C4C]">{weeklyMarked}</td>
                    <td className="p-3 text-right font-semibold text-[#B27715]">
                      {correctionRate}%
                    </td>
                  </tr>
                );
              })}

              {filteredRows.length > 0 && (
                <tr className="border-t-2 border-[#E4E4E4] bg-[#FFF8EE]">
                  <td className="sticky left-0 z-10 bg-[#FFF8EE] p-3 font-bold text-[#4C4C4C] border-r border-[#E4E4E4]">TOTAL</td>
                  <td className="p-3 text-right font-bold text-[#644D93]">{totals.totalEvidence}</td>
                  <td className="p-3 text-right font-bold">{totals.todayMarking}</td>
                  <td className="p-3 text-right font-bold">{totals.yesterdayMarking}</td>
                  <td className="p-3 text-right font-bold">{totals.minus2Marking}</td>
                  <td className="p-3 text-right font-bold">{totals.minus3Marking}</td>
                  <td className="p-3 text-right font-bold">{totals.minus4Marking}</td>
                  <td className="p-3 text-right font-bold">{totals.minus5Marking}</td>
                  <td className="p-3 text-right font-bold">{totals.minus6Marking}</td>
                  <td className="p-3 text-right font-bold">{totals.minus7Marking}</td>
                  <td className="p-3 text-right font-bold">{totals.weeklyMarkedTotal}</td>
                  <td className="p-3 text-right font-bold text-[#B27715]">
                    {totals.avgWeeklyCorrectionRate}%
                  </td>
                </tr>
              )}

              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={12} className="p-8 text-center text-[#808080]">
                    No coach marking data found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-[#E4E4E4] bg-white p-4 shadow-sm">
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-[#4C4C4C]">Coach Progress Overview</h4>
          <p className="text-xs text-[#808080]">
            Weekly correction rate based on the last 7 days marking versus current overdue evidence
          </p>
        </div>

        <div className="space-y-3">
          {progressRows.map((row) => (
            <div
              key={row.coachId}
              className="grid grid-cols-1 gap-2 md:grid-cols-[220px_1fr_70px_180px] md:items-center"
            >
              <div className="text-sm font-medium text-[#4C4C4C]">{row.coachName}</div>

              <div className="h-3 overflow-hidden rounded-full bg-[#EFEFEF]">
                <div
                  className="h-full rounded-full bg-[#866CB6]"
                  style={{ width: `${row.correctionRate}%` }}
                />
              </div>

              <div className="text-sm font-semibold text-[#644D93] md:text-right">
                {row.correctionRate}%
              </div>

              <div className="text-xs text-[#808080] md:text-right">
                Weekly Marked {row.weeklyMarked} , Evidence {row.totalEvidence}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- page ---------------- */

type ContactActionState = {
  called: boolean;
  emailed: boolean;
  resolved: boolean;
  note: string;
};

function buildBookedLearnerRows(
  learners: Learner[],
  bookedSessionTypeFilter: "All Session Types" | "Progress Review" | "MCM" | "Support Session"
): Learner[] {
  const rows: Learner[] = [];

  for (const learner of learners) {
    const learnerAny = learner as any;
    const raw = learnerAny._rawCoachData;
    if (!raw) continue;

    const bookedEntries = getBookedEntriesFromRaw(raw).filter(({ student, sessionType }) => {
      const bookingDate = pickFirstString(student, ["dayDate", "DayDate", "date", "sessionDate"]);
      const matchesDate = isTodayOrFuture(bookingDate);

      const matchesType =
        bookedSessionTypeFilter === "All Session Types" ||
        sessionType === bookedSessionTypeFilter;

      return matchesDate && matchesType;
    });

    const { learnerEmail, learnerNameNorm, learnerId } = getLearnerIdentityCandidates(
      learnerAny.__rawStudent,
      `${learner.firstName} ${learner.lastName}`.trim(),
      learner.email,
      learner.id
    );

    for (const entry of bookedEntries) {
      const student = entry.student || {};

      if (!bookingMatchesLearner(student, learnerId, learnerEmail, learnerNameNorm)) {
        continue;
      }

      const sessionDate =
        pickFirstString(student, ["dayDate", "DayDate", "date", "sessionDate"]) || "N/A";

      const serviceName =
        pickFirstString(student, ["serviceName", "ServiceName"]) || "N/A";

      const groupName =
        pickFirstString(student, ["Group", "group"]) || "N/A";

      rows.push({
        ...learner,
        id: `${learner.id}::${entry.sessionType}::${sessionDate}::${serviceName}`,
        anyBooked: true,
        anyBookedHasData: true,
        anyBookedSessionType: entry.sessionType,
        anyBookedSessionDate: sessionDate,
        anyBookedServiceName: serviceName,
        anyBookedGroupName: groupName,
      } as Learner);
    }
  }

  return rows.sort((a, b) => {
    const ad = String((a as any).anyBookedSessionDate || "");
    const bd = String((b as any).anyBookedSessionDate || "");
    return ad.localeCompare(bd);
  });
}

// Unique key 
const getLearnerUniqueKey = (learner: Learner) => {
  const anyLearner = learner as any;

  const email = String(learner.email || "").trim().toLowerCase();
  const rawId = String(learner.id || "").trim();
  const fullName = `${learner.firstName || ""} ${learner.lastName || ""}`.trim().toLowerCase();
  const organisation = String(learner.organisation || "").trim().toLowerCase();
  const programme = String(learner.programme || "").trim().toLowerCase();

  return (
    email ||
    rawId ||
    `${fullName}||${organisation}||${programme}` ||
    String(anyLearner.attendanceContactKey || "")
  );
};

const getLearnerPersonKey = (learner: Learner) => {
  const name = normName(`${learner.firstName || ""} ${learner.lastName || ""}`);
  const email = normEmail(learner.email);
  const rawId = String(learner.id || "").trim().toLowerCase();

  return name || email || rawId;
};

const uniqueLearnersByPerson = <T extends Learner>(learners: T[]): T[] => {
  const deduped = new Map<string, T>();

  for (const learner of learners) {
    const key = getLearnerPersonKey(learner);
    if (!key || deduped.has(key)) continue;
    deduped.set(key, learner);
  }

  return Array.from(deduped.values());
};

const mergeLearnerRows = (existing: Learner, incoming: Learner): Learner => {
  const e: any = existing;
  const i: any = incoming;

  const existingRisks = Array.isArray(existing.riskCategories) ? existing.riskCategories : [];
  const incomingRisks = Array.isArray(incoming.riskCategories) ? incoming.riskCategories : [];

  const mergedRiskCategories = Array.from(new Set([...existingRisks, ...incomingRisks]));

  const priorityRank: Record<string, number> = {
    normal: 0,
    high: 1,
    critical: 2,
  };

  const strongerPriority =
    (priorityRank[incoming.priority || "normal"] ?? 0) >
      (priorityRank[existing.priority || "normal"] ?? 0)
      ? incoming.priority
      : existing.priority;

  const pick = <T,>(a: T, b: T) => {
    const aStr = String(a ?? "").trim();
    const bStr = String(b ?? "").trim();
    return bStr && bStr !== "N/A" && bStr !== "Unknown" ? b : a;
  };

  const merged = {
    ...existing,
    ...incoming,

    id: pick(existing.id, incoming.id),
    email: pick(existing.email, incoming.email),
    phone: pick(existing.phone, incoming.phone),
    organisation: pick(existing.organisation, incoming.organisation),
    programme: pick(existing.programme, incoming.programme),
    coach: pick(existing.coach, incoming.coach),

    lastSessionDate: pick(existing.lastSessionDate, incoming.lastSessionDate),
    lastSessionStatus:
      i.lastSessionStatus && i.lastSessionStatus !== "Unknown"
        ? i.lastSessionStatus
        : e.lastSessionStatus,

    lastProgressReviewDate: pick(existing.lastProgressReviewDate, incoming.lastProgressReviewDate),
    nextProgressReviewDue: pick(e.nextProgressReviewDue, i.nextProgressReviewDue),

    priority: strongerPriority,
    riskCategories: mergedRiskCategories,
  } as Learner;

  (merged as any).hasAttendanceInWindow =
    Boolean(e.hasAttendanceInWindow) || Boolean(i.hasAttendanceInWindow);

  (merged as any).hasOtjBehind =
    Boolean(e.hasOtjBehind) || Boolean(i.hasOtjBehind);

  (merged as any).otjBehindPct = Math.max(
    Number(e.otjBehindPct ?? 0),
    Number(i.otjBehindPct ?? 0)
  );

  (merged as any).otjBehindBy = Math.max(
    Number(e.otjBehindBy ?? 0),
    Number(i.otjBehindBy ?? 0)
  );

  (merged as any).requiredHoursToSubmit =
    pick(e.requiredHoursToSubmit, i.requiredHoursToSubmit);

  (merged as any).otjPriority =
    Number(i.otjBehindPct ?? 0) > Number(e.otjBehindPct ?? 0)
      ? i.otjPriority
      : e.otjPriority;

  (merged as any).targetNow = Math.max(
    Number(e.targetNow ?? 0),
    Number(i.targetNow ?? 0)
  );

  (merged as any).monthlyCoachingBooked =
    Boolean(e.monthlyCoachingBooked) || Boolean(i.monthlyCoachingBooked);

  (merged as any).monthlyCoachingHasData =
    Boolean(e.monthlyCoachingHasData) || Boolean(i.monthlyCoachingHasData);

  (merged as any).monthlyCoachingSessionDate =
    pick(e.monthlyCoachingSessionDate, i.monthlyCoachingSessionDate);

  (merged as any).progressReviewBooked =
    Boolean(e.progressReviewBooked) || Boolean(i.progressReviewBooked);

  (merged as any).progressReviewHasData =
    Boolean(e.progressReviewHasData) || Boolean(i.progressReviewHasData);

  (merged as any).progressReviewSessionDate =
    pick(e.progressReviewSessionDate, i.progressReviewSessionDate);

  (merged as any).anyBooked =
    Boolean(e.anyBooked) || Boolean(i.anyBooked);

  (merged as any).anyBookedHasData =
    Boolean(e.anyBookedHasData) || Boolean(i.anyBookedHasData);

  (merged as any).anyBookedSessionType =
    pick(e.anyBookedSessionType, i.anyBookedSessionType);

  (merged as any).anyBookedSessionDate =
    pick(e.anyBookedSessionDate, i.anyBookedSessionDate);

  (merged as any).anyBookedServiceName =
    pick(e.anyBookedServiceName, i.anyBookedServiceName);

  (merged as any).attendanceEmail =
    pick(e.attendanceEmail, i.attendanceEmail);

  (merged as any).attendanceDate =
    pick(e.attendanceDate, i.attendanceDate);

  (merged as any).attendanceModule =
    pick(e.attendanceModule, i.attendanceModule);

  (merged as any).attendanceContactKey =
    pick(e.attendanceContactKey, i.attendanceContactKey);

  (merged as any).programStatusRaw =
    pick(e.programStatusRaw, i.programStatusRaw);

  (merged as any).aptemProgramStatusRaw =
    pick(e.aptemProgramStatusRaw, i.aptemProgramStatusRaw);

  (merged as any).hasAptemLearnerRow =
    Boolean(e.hasAptemLearnerRow) || Boolean(i.hasAptemLearnerRow);

  (merged as any)._rawCoachData = i._rawCoachData || e._rawCoachData;
  (merged as any)._rawStudent = i._rawStudent || e._rawStudent;

  // review fields
  (merged as any).overduePrCount = Math.max(
    Number(e.overduePrCount ?? 0),
    Number(i.overduePrCount ?? 0)
  );

  (merged as any).reviewStatusLabel =
    pick(e.reviewStatusLabel, i.reviewStatusLabel);

  (merged as any).reviewStatusTone =
    pick(e.reviewStatusTone, i.reviewStatusTone);

  (merged as any).nextPrDate =
    pick(e.nextPrDate, i.nextPrDate);

  (merged as any).nextPrState =
    pick(e.nextPrState, i.nextPrState);

  (merged as any).nextReviewStatusRaw =
    pick(e.nextReviewStatusRaw, i.nextReviewStatusRaw);

  (merged as any).bookedPrDate =
    pick(i.bookedPrDate, e.bookedPrDate);

  return merged;
};

// review State
const getReviewStatusLabel = (overdueCount: number) => {
  if (overdueCount <= 0) {
    return {
      label: "Ahead",
      tone: "ahead",
    } as const;
  }

  if (overdueCount > 12) {
    return {
      label: "Due",
      tone: "due",
    } as const;
  }

  if (overdueCount > 10) {
    return {
      label: "At Risk",
      tone: "at-risk",
    } as const;
  }

  return {
    label: "Normal",
    tone: "normal",
  } as const;
};

// bring the email of the student
const getEmailLocalPart = (email: unknown) => {
  const e = normEmail(email);
  if (!e.includes("@")) return e;
  return e.split("@")[0].trim();
};

const tokenizeName = (value: unknown) =>
  normName(value)
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean);

const sameLooseNameTokens = (a: unknown, b: unknown) => {
  const ax = tokenizeName(a);
  const bx = tokenizeName(b);

  if (!ax.length || !bx.length) return false;

  const aJoined = ax.join(" ");
  const bJoined = bx.join(" ");

  if (aJoined === bJoined) return true;
  if (aJoined.includes(bJoined) || bJoined.includes(aJoined)) return true;

  const overlap = ax.filter((t) => bx.includes(t)).length;
  const minLen = Math.min(ax.length, bx.length);

  return minLen > 0 && overlap >= minLen;
};

const findBestProgressReviewMatch = (
  learner: {
    id?: string;
    email?: string;
    fullName?: string;
  },
  rows: ProgressReviewSummaryRow[]
): ProgressReviewSummaryRow | null => {
  const learnerId = normId(learner.id);
  const learnerEmail = normEmail(learner.email);
  const learnerLocal = getEmailLocalPart(learnerEmail);
  const learnerName = normName(learner.fullName);

  if (!learnerId && !learnerEmail && !learnerName) return null;

  for (const row of rows) {
    const rowId = normId(row?.id);
    const rowEmail = normEmail(row?.email);
    const rowLocal = getEmailLocalPart(rowEmail);
    const rowName = normName(row?.fullName);

    if (learnerId && rowId && learnerId === rowId) return row;
    if (learnerEmail && rowEmail && learnerEmail === rowEmail) return row;
    if (learnerLocal && rowLocal && learnerLocal === rowLocal && learnerName && rowName && sameLooseNameTokens(learnerName, rowName)) {
      return row;
    }
    if (learnerName && rowName && sameLooseNameTokens(learnerName, rowName)) {
      return row;
    }
  }

  return null;
};

const getNextPrDateFromRow = (row: any) =>
  pickFirstString(row, [
    "nextPrDate",
    "next_pr_date",
    "NextPrDate",
    "Next PR",
    "nextReviewDate",
    "NextReviewDate",
    "nextReviewStatus",
    "reviewDate",
    "ReviewDate",
    "earliestOverdue",
    "next_progress_review",
    "nextProgressReview",
  ]) || "N/A";

const getReviewNumber = (row: any, keys: string[]) => {
  for (const key of keys) {
    const value = row?.[key];
    if (value == null || value === "") continue;

    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return 0;
};

const getReviewString = (row: any, keys: string[]) => {
  for (const key of keys) {
    const value = row?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const getOverduePrCountFromRow = (row: any) =>
  getReviewNumber(row, [
    "overduePrCount",
    "overduePRCount",
    "overdueReviews",
    "overdue_reviews",
    "overdue_pr_count",
    "overdueCount",
    "No. of overdue PR",
    "noOfOverduePr",
  ]);

const getReviewStatusFromRow = (row: any) =>
  getReviewString(row, [
    "reviewStatus",
    "review_status",
    "Review Status",
    "status",
  ]) || "Ahead";

const getLastProgressReviewFromRow = (row: any) =>
  getReviewString(row, [
    "lastProgressReview",
    "last_progress_review",
    "Last Progress Review",
    "lastPrDate",
    "last_pr_date",
  ]);

const getLearnerProgramStatus = (learner: Learner) =>
  String((learner as any).aptemProgramStatusRaw || (learner as any).programStatusRaw || "").trim();

const INACTIVE_PROGRAM_STATUSES = new Set(
  [
    "Withdrawn",
    "Break in Learning",
    "OnBreak",
    "On Break",
    "OnBoarding",
    "On Boarding",
    "Onboarding",
    "On Bording",
    "ReadyToEnrol",
    "UnderReview",
  ].map((status) => status.toLowerCase())
);

const toLearnerStatus = (statusRaw: unknown): Learner["status"] => {
  const normalized = String(statusRaw || "").trim().toLowerCase();
  if (normalized === "break in learning") return "Break in Learning";
  return INACTIVE_PROGRAM_STATUSES.has(normalized) ? "Withdrawn" : "Active";
};

const DEFAULT_DASHBOARD_FILTERS: DashboardFilters = {
  coach: "All Coaches",
  rating: "All Ratings",
  programme: "All Programmes",
  risk: "All",
  organisation: "All Organizations",
  status: "Active",
};

export default function Dashboard() {
  const [rows, setRows] = useState<UiCoach[]>([]);
  const [loading, setLoading] = useState(true);
  const [absenceWeeks, setAbsenceWeeks] = useState<"all" | 0 | 1 | 2 | 3>(0);
  const [prMonthOffset, setPrMonthOffset] = useState<PrOffset>(0);
  const [prStatusFilter, setPrStatusFilter] = useState<string>("All");
  const [prOverdueFilter, setPrOverdueFilter] = useState(false);
  const [mcrOverdueFilter, setMcrOverdueFilter] = useState(false);
  const [mcrMonthOffset, setMcrMonthOffset] = useState(0);

  // PR
  const [progressReviewRows, setProgressReviewRows] = useState<ProgressReviewSummaryRow[]>([]);
  const [prBookedData, setPrBookedData] = useState<any[]>([]);
  const [mcrData, setMcrData] = useState<any[]>([]);
  const [otjAtRiskData, setOtjAtRiskData] = useState<any[]>([]);
  const [aptemLearnersData, setAptemLearnersData] = useState<any[]>([]);
  const [requireMarkingData, setRequireMarkingData] = useState<any[]>([]);
  const [kbcAttendanceData, setKbcAttendanceData] = useState<any[]>([]);

  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_DASHBOARD_FILTERS);

  const [activeKpi, setActiveKpi] = useState<KpiCategory | null>(null);
  const [selectedLearner, setSelectedLearner] = useState<Learner | null>(null);
  const [bookedSessionTypeFilter, setBookedSessionTypeFilter] = useState<
    "All Session Types" | "Progress Review" | "MCM" | "Support Session"
  >("All Session Types");

  const [contactActions, setContactActions] = useState<Record<string, ContactActionState>>({});

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const data = await fetchUiCoaches();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setRows([]);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (activeKpi !== "coaching-booked") {
      setBookedSessionTypeFilter("All Session Types");
    }
    if (activeKpi !== "review-due") {
      setPrOverdueFilter(false);
    }
    if (activeKpi !== "coaching-due") {
      setMcrOverdueFilter(false);
    }
  }, [activeKpi]);

  const loadContactActions = useCallback(async () => {
    try {
      const res = await fetch("/api/learner-contact-actions/");
      if (!res.ok) throw new Error("Failed to load contact actions");

      const data = await res.json();

      const mapped: Record<string, ContactActionState> = {};

      for (const item of data || []) {
        const key =
          item.contact_key ||
          `${String(item.email || "").trim().toLowerCase()}||${item.date || ""}||${item.module || ""}`;

        mapped[key] = {
          called: Boolean(item.called),
          emailed: Boolean(item.emailed),
          resolved: Boolean(item.resolved),
          note: String(item.note || "").trim(),
        };
      }

      setContactActions(mapped);
    } catch (error) {
      console.error(error);
      setContactActions({});
    }
  }, []);

  const loadProgressReviewSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/progress-review-summary/");
      if (!res.ok) throw new Error("Failed to load progress review summary");

      const data = await res.json();
      setProgressReviewRows(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      setProgressReviewRows([]);
    }
  }, []);

  const loadPrBookedData = useCallback(async () => {
    try {
      const res = await fetch("/api/progress-review-booked/");
      if (!res.ok) throw new Error("Failed to load progress review booked data");
      const data = await res.json();
      setPrBookedData(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      setPrBookedData([]);
    }
  }, []);

  useEffect(() => {
    void loadContactActions();
  }, [loadContactActions]);

  useEffect(() => {
    void loadProgressReviewSummary();
  }, [loadProgressReviewSummary]);

  useEffect(() => {
    void loadPrBookedData();
  }, [loadPrBookedData]);

  const loadMcrData = useCallback(async () => {
    try {
      const res = await fetch("/api/mcr-summary/");
      if (!res.ok) throw new Error("Failed to load MCR data");
      const data = await res.json();
      setMcrData(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      setMcrData([]);
    }
  }, []);

  useEffect(() => {
    void loadMcrData();
  }, [loadMcrData]);

  const loadOtjAtRiskData = useCallback(async () => {
    try {
      const res = await fetch("/api/otj-at-risk/");
      if (!res.ok) throw new Error("Failed to load OTJH at risk data");
      const data = await res.json();
      setOtjAtRiskData(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      setOtjAtRiskData([]);
    }
  }, []);

  useEffect(() => {
    void loadOtjAtRiskData();
  }, [loadOtjAtRiskData]);

  const loadAptemLearnersData = useCallback(async () => {
    try {
      const res = await fetch("/api/aptem-learners/", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load Aptem learners data");
      const data = await res.json();
      setAptemLearnersData(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      setAptemLearnersData([]);
    }
  }, []);

  useEffect(() => {
    void loadAptemLearnersData();
  }, [loadAptemLearnersData]);

  const loadRequireMarkingData = useCallback(async () => {
    try {
      const res = await fetch("/api/require-marking/");
      if (!res.ok) throw new Error("Failed to load require marking data");
      const data = await res.json();
      setRequireMarkingData(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      setRequireMarkingData([]);
    }
  }, []);

  useEffect(() => {
    void loadRequireMarkingData();
  }, [loadRequireMarkingData]);

  const loadKbcAttendanceData = useCallback(async () => {
    try {
      const res = await fetch("/api/kbc-attendance/", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load KBC attendance data");
      const data = await res.json();
      setKbcAttendanceData(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      setKbcAttendanceData([]);
    }
  }, []);

  useEffect(() => {
    void loadKbcAttendanceData();
  }, [loadKbcAttendanceData]);

  const updateContactAction = useCallback(
    async (payload: {
      contactKey: string;
      email: string;
      date: string;
      module: string;
      called: boolean;
      emailed: boolean;
      resolved: boolean;
      note: string;
    }) => {
      const nextState: ContactActionState = {
        called: payload.called,
        emailed: payload.emailed,
        resolved: payload.resolved,
        note: payload.note,
      };

      setContactActions((prev) => ({
        ...prev,
        [payload.contactKey]: nextState,
      }));

      setSelectedLearner((prev) => {
        if (!prev) return prev;

        const prevKey = String((prev as any).attendanceContactKey || "");
        if (prevKey !== payload.contactKey) return prev;

        return {
          ...prev,
          called: payload.called,
          emailed: payload.emailed,
          isResolved: payload.resolved,
          note: payload.note,
        } as Learner;
      });

      try {
        const res = await fetch("/api/learner-contact-actions/", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: payload.email,
            date: payload.date,
            module: payload.module,
            called: payload.called,
            emailed: payload.emailed,
            resolved: payload.resolved,
            note: payload.note,
          }),
        });

        if (!res.ok) {
          throw new Error("Failed to update contact action");
        }
      } catch (error) {
        console.error(error);
        await loadContactActions();
      }
    },
    [loadContactActions]
  );

  const coachRowFilters = useMemo<DashboardFilters>(
    () => ({ ...filters, status: "All Statuses" }),
    [filters]
  );

  const filteredRows = useMemo(
    () => applyDashboardFilters(rows, coachRowFilters),
    [rows, coachRowFilters]
  );

  const kbcAttMetrics = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildAttendanceMetricsFromRecords>>();
    for (const rec of kbcAttendanceData) {
      const email = normEmail(rec.email);
      if (!email) continue;
      map.set(email, buildAttendanceMetricsFromRecords(rec.records || [], absenceWeeks));
    }
    return map;
  }, [kbcAttendanceData, absenceWeeks]);

  const kbcAttendanceRecordsByEmail = useMemo(() => {
    const map = new Map<
      string,
      Array<{ date: string | null; attendance: unknown; module: string }>
    >();

    for (const rec of kbcAttendanceData) {
      const email = normEmail(rec.email);
      if (!email) continue;
      map.set(email, Array.isArray(rec.records) ? rec.records : []);
    }

    return map;
  }, [kbcAttendanceData]);

  const progressReviewIndex = useMemo(() => {
    const byEmail = new Map<string, ProgressReviewSummaryRow>();
    const byId = new Map<string, ProgressReviewSummaryRow>();
    const byName = new Map<string, ProgressReviewSummaryRow>();
    const byEmailLocal = new Map<string, ProgressReviewSummaryRow>();

    for (const row of progressReviewRows) {
      const email = String(row?.email || "").trim().toLowerCase();
      const emailLocal = getEmailLocalPart(email);
      const id = String(row?.id || "").trim();
      const fullName = normName(String(row?.fullName || "").trim());

      if (email) byEmail.set(email, row);
      if (emailLocal) byEmailLocal.set(emailLocal, row);
      if (id) byId.set(id, row);
      if (fullName) byName.set(fullName, row);
    }

    return { byEmail, byId, byName, byEmailLocal, rows: progressReviewRows };
  }, [progressReviewRows]);

  const aptemLearnerIndex = useMemo(() => {
    const byEmail = new Map<string, any>();
    const byId = new Map<string, any>();
    const byName = new Map<string, any>();

    for (const row of aptemLearnersData) {
      const email = normEmail(row?.email);
      const id = normId(row?.id);
      const fullName = normName(row?.fullName);

      if (email) byEmail.set(email, row);
      if (id) byId.set(id, row);
      if (fullName) byName.set(fullName, row);
    }

    return { byEmail, byId, byName };
  }, [aptemLearnersData]);

  const prStatusOptions = ["All", "Scheduled", "Awaiting Signature", "In Progress", "Not Scheduled"];

  const handlePrStatusFilterChange = (v: string) => {
    setPrStatusFilter(v);
    if (v !== "All") setActiveKpi("review-due");
  };

  const activeLearners = useMemo<Learner[]>(() => {
    const out: Learner[] = [];

    for (const coach of filteredRows) {
      const raw = coach.raw as any;
      const prIndex = progressReviewIndex;

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

        const emailRaw = pickFirstString(s as any, [
          "Email",
          "email",
          "emailAddress",
          "UserEmail",
          "LearnerEmail",
        ]);
        const emailKey = normEmail(emailRaw);

        const fullName = pickFirstString(s as any, [
          "FullName",
          "fullName",
          "DisplayName",
          "displayName",
          "name",
        ]);
        const { firstName, lastName } = splitName(fullName);
        const aptemLearnerRow =
          (id && aptemLearnerIndex.byId.get(id)) ||
          (fullName && aptemLearnerIndex.byName.get(normName(fullName))) ||
          (emailKey && aptemLearnerIndex.byEmail.get(emailKey)) ||
          null;
        const aptemProgramStatusRaw = pickFirstString(aptemLearnerRow, [
          "programStatus",
          "Program-Status",
          "Program Status",
          "program_status",
          "Status",
          "status",
        ]);
        const displayEmailKey = normEmail(aptemLearnerRow?.email) || emailKey;
        const kbcAttendanceRecords =
          (displayEmailKey && kbcAttendanceRecordsByEmail.get(displayEmailKey)) ||
          (emailKey && kbcAttendanceRecordsByEmail.get(emailKey)) ||
          [];

        const attRec =
          (id && attById.get(id)) ||
          (displayEmailKey && attByEmail.get(displayEmailKey)) ||
          (emailKey && attByEmail.get(emailKey)) ||
          attLearners.find((a: any) =>
            sameLooseName(a?.FullName || a?.fullName || a?.name, fullName)
          ) ||
          null;

        const metrics = kbcAttendanceRecords.length
          ? buildAttendanceMetricsFromRecords(kbcAttendanceRecords, absenceWeeks)
          : buildAttendanceMetrics(attRec?.Attendance, absenceWeeks);

        let priority: Learner["priority"] = priorityFromAttendance(metrics.missedInRow);
        const riskCategories: KpiCategory[] = riskCatsFromAttendance(
          metrics.missedInRow,
          metrics.absenceRatio
        );

        const reviewRow =
          (id && prIndex.byId.get(id)) ||
          (displayEmailKey && prIndex.byEmail.get(displayEmailKey)) ||
          (emailKey && prIndex.byEmail.get(emailKey)) ||
          (displayEmailKey && prIndex.byEmailLocal.get(getEmailLocalPart(displayEmailKey))) ||
          (emailKey && prIndex.byEmailLocal.get(getEmailLocalPart(emailKey))) ||
          (fullName && prIndex.byName.get(normName(fullName))) ||
          findBestProgressReviewMatch(
            {
              id,
              email: displayEmailKey || emailKey,
              fullName,
            },
            prIndex.rows
          ) ||
          null;

        const overduePrCount = getOverduePrCountFromRow(reviewRow);
        const reviewFlag: "none" | "overdue" = overduePrCount > 0 ? "overdue" : "none";

        if (overduePrCount > 0) {
          if (!riskCategories.includes("review-due")) {
            riskCategories.push("review-due");
          }

          const prio = priorityFromReview(overduePrCount);
          if (prio === "critical" || (prio === "high" && priority === "normal")) {
            priority = prio;
          }
        }

        const reviewStatusValue = getReviewStatusFromRow(reviewRow);

        const reviewStatus = {
          label: reviewStatusValue,
          tone:
            reviewStatusValue.toLowerCase() === "due"
              ? "due"
              : reviewStatusValue.toLowerCase() === "at risk"
                ? "at-risk"
                : reviewStatusValue.toLowerCase() === "normal"
                  ? "normal"
                  : "ahead",
        } as const;

        const progressVariance = toNum((s as any)?.ProgressVariance);

        const progressHoursRaw =
          pickFirstString(s as any, ["Progress_Hours"]) || "";

        const requiredHoursToSubmit = progressHoursRaw
          ? stripLeadingMinus(progressHoursRaw)
          : "N/A";

        const expectedOtj = toNum((s as any)?.Expected);
        const actualOtj = toNum((s as any)?.Completed);
        const plannedOtj = toNum((s as any)?.Planned);

        const totalDays = toNum(
          getLooseRawValue(s as any, ["Total Days", "TotalDays", "total_days"])
        );

        const elapsedDays = toNum(
          getLooseRawValue(s as any, ["Elapsed-Days", "Elapsed Days", "elapsed_days"])
        );

        const targetNow =
          plannedOtj && totalDays && elapsedDays
            ? Math.round((elapsedDays / totalDays) * plannedOtj)
            : 0;

        const otjBehindPct =
          progressVariance != null && progressVariance < 0 ? Math.abs(progressVariance) : 0;

        const hasOtjBehind = otjBehindPct > 0 || hasLeadingMinus(progressHoursRaw);
        const otjPriority = getOtjPriority(otjBehindPct);

        const lastProgressReviewDate =
          getLastProgressReviewFromRow(reviewRow) ||
          pickFirstString(s as any, [
            "Last Progress Review",
            "LastProgressReview",
            "last_progress_review",
            "Last_PR_Date",
            "last_pr_date",
            "Last PR Date",
          ]);

        const learnerStatusRaw =
          aptemProgramStatusRaw ||
          pickFirstString(s as any, [
            "Program-Status",
            "Program Status",
            "program_status",
            "programStatus",
            "Status",
            "status",
          ]);

        const learnerStatus: Learner["status"] = toLearnerStatus(learnerStatusRaw);

        const otjBehindBy = otjBehindPct;

        if (hasOtjBehind) {
          if (!riskCategories.includes("otj-behind")) {
            riskCategories.push("otj-behind");
          }

          if (otjPriority === "at-risk") {
            priority = "critical";
          } else if (otjPriority === "need-attention" && priority === "normal") {
            priority = "high";
          }
        }

        const learnerMatchEmail = displayEmailKey || emailKey;
        const anyBookedMeta = getLearnerBookedMeta(raw, s, id, learnerMatchEmail, fullName);
        const mcmBookedMeta = getLearnerBookedMetaByType(raw, s, id, learnerMatchEmail, fullName, "MCM");
        const prBookedMeta = getLearnerBookedMetaByType(
          raw,
          s,
          id,
          learnerMatchEmail,
          fullName,
          "Progress Review"
        );

        const bookedPrDate =
          prBookedMeta.booked && prBookedMeta.sessionDate !== "N/A"
            ? prBookedMeta.sessionDate
            : "";

        const learnerNameNormForBooking = normName(fullName);
        const prBookingDates = getBookedEntriesFromRaw(raw)
          .filter((entry) => entry.sessionType === "Progress Review")
          .filter(({ student }) =>
            bookingMatchesLearner(student, id, learnerMatchEmail, learnerNameNormForBooking)
          )
          .map(({ student }) =>
            pickFirstString(student, ["dayDate", "DayDate", "date", "sessionDate"])
          )
          .filter(Boolean) as string[];

        const rawNextReviewStatus = String(reviewRow?.nextReviewStatus || "").trim();

        const nextPrDate =
          String((reviewRow as any)?.nextPrDate || "").trim() ||
          getNextPrDateFromRow(reviewRow);

        const supportBookedMeta = getLearnerBookedMetaByType(
          raw,
          s,
          id,
          learnerMatchEmail,
          fullName,
          "Support Session"
        );

        const monthlyCoachingBooked = mcmBookedMeta.booked;
        const monthlyCoachingHasData = mcmBookedMeta.hasData;

        if (monthlyCoachingHasData && !monthlyCoachingBooked) {
          if (!riskCategories.includes("coaching-due")) riskCategories.push("coaching-due");
          if (priority === "normal") priority = "high";
        }

        const latestAttendanceModule = kbcAttendanceRecords.length
          ? getLatestAttendanceModuleFromRecords(kbcAttendanceRecords)
          : getLatestAttendanceModule(attRec?.Attendance);

        const organisation = pickFirstString(s as any, [
          "OrganizationName",
          "OrganisationName",
          "Organization",
          "Organisation",
          "CompanyName",
          "company_name",
          "Employer",
          "EmployerName",
          "employer_name",
        ]);

        const programmeFromStudent = pickFirstString(s as any, [
          "Program Name",
          "Programme",
          "programme",
          "ProgramName",
          "program_name",
          "Programme Name",
          "CourseName",
          "course_name",
        ]);

        const programme =
          latestAttendanceModule ||
          programmeFromStudent ||
          metrics.latestProgramme ||
          "Unknown";

        const coachPhone = pickFirstString(raw as any, ["owner_phone"]) || "";
        const coachEmail = pickFirstString(s as any, ["OwnerEmail", "case_owner_email"]) || "";
        const lastMonthlyMeetingDate = kbcAttendanceRecords.length
          ? getLastCompletedSessionDateFromRecords(kbcAttendanceRecords)
          : getLastCompletedSessionDate(attRec?.Attendance);
        const progressReviewBooked = prBookedMeta.booked;

        const attendanceEmail = normEmail(attRec?.Email || displayEmailKey || emailKey);
        const attendanceDate = metrics.lastSessionDate || "";
        const attendanceModule = latestAttendanceModule || "";
        const attendanceContactKey = `${attendanceEmail}||${attendanceDate}||${attendanceModule}`;

        const learner = {
          id: id || learnerMatchEmail || `${coach.id}:${fullName}`,
          firstName,
          lastName,
          organisation: organisation || "Unknown",
          programme: programme || metrics.latestProgramme || "Unknown",
          coach: coach.name,
          email: displayEmailKey || emailKey || "Unknown",
          phone:
            pickFirstString(s as any, [
              "learner_phone",
              "Learner_phone",
              "Learner Phone",
              "learnerPhone",
              "phone",
              "Phone",
            ]) || "N/A",
          status: learnerStatus,
          absenceRatio: metrics.absenceRatio,
          missedLast10Weeks: metrics.missedLast10Weeks,
          missedInRow: metrics.missedInRow,
          lastSessionDate: metrics.lastSessionDate,
          lastSessionStatus: metrics.lastSessionStatus,
          lastProgressReviewDate: lastProgressReviewDate || "",
          nextProgressReviewDue: nextPrDate,
          progressReviewBooked: false,
          lastMonthlyMeetingDate: "N/A",
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

        (learner as any).hasAttendanceInWindow = (metrics as any).hasAttendanceInWindow;
        (learner as any).hasOtjBehind = hasOtjBehind;
        (learner as any).otjBehindBy = otjBehindBy;
        (learner as any).otjBehindPct = otjBehindPct;
        (learner as any).requiredHoursToSubmit = requiredHoursToSubmit;
        (learner as any).otjPriority = otjPriority;
        (learner as any).otjPriorityLabel = getOtjPriorityLabel(otjPriority);
        (learner as any).targetNow = targetNow;

        (learner as any).monthlyCoachingBooked = monthlyCoachingBooked;
        (learner as any).monthlyCoachingHasData = monthlyCoachingHasData;
        (learner as any).anyBookedSessionType = anyBookedMeta.sessionType;
        (learner as any).monthlyCoachingSessionDate = mcmBookedMeta.sessionDate;

        (learner as any).progressReviewBooked = progressReviewBooked;
        (learner as any).progressReviewHasData = prBookedMeta.hasData;
        (learner as any).progressReviewSessionType = prBookedMeta.sessionType;
        (learner as any).progressReviewSessionDate = prBookedMeta.sessionDate;

        (learner as any).anyBooked = anyBookedMeta.booked;
        (learner as any).anyBookedHasData = anyBookedMeta.hasData;
        (learner as any).anyBookedSessionType = anyBookedMeta.sessionType;
        (learner as any).anyBookedSessionDate = anyBookedMeta.sessionDate;

        /*Booking session metadata*/
        (learner as any).anyBookedServiceName = anyBookedMeta.serviceName;
        // (learner as any).anyBookedGroupName = anyBookedMeta.groupName;

        (learner as any)._rawCoachData = raw;
        (learner as any)._rawStudent = s;

        (learner as any).mcmBookedSessionDate = mcmBookedMeta.sessionDate;
        (learner as any).supportSessionBooked = supportBookedMeta.booked;
        (learner as any).supportSessionHasData = supportBookedMeta.hasData;
        (learner as any).supportSessionSessionType = supportBookedMeta.sessionType;
        (learner as any).supportSessionSessionDate = supportBookedMeta.sessionDate;

        (learner as any).__reviewFlag = reviewFlag;
        (learner as any).__reviewOverdue = reviewFlag === "overdue";

        // PR
        (learner as any).overduePrCount = overduePrCount;
        (learner as any).reviewStatusLabel = reviewStatus.label;
        (learner as any).reviewStatusTone = reviewStatus.tone;
        (learner as any).nextReviewStatusRaw = rawNextReviewStatus;
        (learner as any).nextPrDate = nextPrDate;
        (learner as any).nextPrState = String((reviewRow as any)?.nextPrState || "").trim();

        (learner as any).bookedPrDate = bookedPrDate || "N/A";
        (learner as any).prBookingDates = prBookingDates;

        (learner as any).coachPhone = coachPhone;
        (learner as any).coachEmail = coachEmail;
        (learner as any).lineManagerName =
          pickFirstString(s as any, ["ManagerName", "Manager Name"]) || "N/A";
        (learner as any).lineManagerEmail =
          pickFirstString(s as any, ["ManagerEmail", "Manager Email"]) || "No email on file";

        (learner as any).lastMonthlyMeetingDate = lastMonthlyMeetingDate;
        (learner as any).latestAttendanceModule = latestAttendanceModule;
        (learner as any).attendanceEmail = attendanceEmail;
        (learner as any).attendanceDate = attendanceDate;
        (learner as any).attendanceModule = attendanceModule;
        (learner as any).attendanceContactKey = attendanceContactKey;
        (learner as any).programStatusRaw = learnerStatusRaw;
        (learner as any).aptemProgramStatusRaw = aptemProgramStatusRaw;
        (learner as any).hasAptemLearnerRow = Boolean(aptemLearnerRow);

        const matchesLearnerProgramme =
          filters.programme === "All Programmes" ||
          matchesAnyExactFilterValue([latestAttendanceModule], filters.programme);

        const matchesLearnerOrganisation =
          filters.organisation === "All Organizations" ||
          matchesAnyExactFilterValue([organisation], filters.organisation);

        if (!matchesLearnerProgramme || !matchesLearnerOrganisation) {
          continue;
        }

        out.push(learner);
      }
    }

    const prIndex = progressReviewIndex;
    for (const row of aptemLearnersData) {
      const id = normId(row?.id);
      const emailKey = normEmail(row?.email);
      const fullName =
        pickFirstString(row, ["fullName", "FullName", "name", "DisplayName"]) || "";

      if (!id && !emailKey && !fullName) continue;

      const aptemProgramStatusRaw = pickFirstString(row, [
        "programStatus",
        "Program-Status",
        "Program Status",
        "program_status",
        "Status",
        "status",
      ]);
      const statusLower = aptemProgramStatusRaw.trim().toLowerCase();

      if (
        filters.status !== "All Statuses" &&
        statusLower !== filters.status.trim().toLowerCase()
      ) {
        continue;
      }

      const coachName =
        pickFirstString(row, ["ownerName", "OwnerName", "caseOwner", "CaseOwner", "coach"]) ||
        "Unknown";
      if (filters.coach !== "All Coaches" && !matchesExactFilterValue(coachName, filters.coach)) {
        continue;
      }

      const organisation =
        pickFirstString(row, [
          "organizationName",
          "OrganizationName",
          "organisationName",
          "OrganisationName",
          "Organization",
          "Organisation",
          "CompanyName",
          "EmployerName",
        ]) || "Unknown";
      if (
        filters.organisation !== "All Organizations" &&
        !matchesExactFilterValue(organisation, filters.organisation)
      ) {
        continue;
      }

      if (filters.rating !== "All Ratings") {
        const ratingCandidates = [
          row?.coachRag,
          row?.ksbStatus,
          row?.compStatus,
          row?.otjHoursStatus,
        ];
        if (!matchesAnyExactFilterValue(ratingCandidates, filters.rating)) continue;
      }

      if (filters.risk !== "All") {
        const riskCandidates = [
          row?.coachRag,
          row?.ksbStatus,
          row?.compStatus,
          row?.otjHoursStatus,
        ];
        if (!matchesAnyExactFilterValue(riskCandidates, filters.risk)) continue;
      }

      const kbcAttendanceRecords =
        (emailKey && kbcAttendanceRecordsByEmail.get(emailKey)) || [];
      const metrics = kbcAttendanceRecords.length
        ? buildAttendanceMetricsFromRecords(kbcAttendanceRecords, absenceWeeks)
        : buildAttendanceMetrics(undefined, absenceWeeks);
      const latestAttendanceModule = kbcAttendanceRecords.length
        ? getLatestAttendanceModuleFromRecords(kbcAttendanceRecords)
        : "";

      const programmeFromAptem = pickFirstString(row, [
        "programName",
        "Program Name",
        "Programme",
        "programme",
        "ProgramName",
        "program_name",
      ]);
      const programme =
        latestAttendanceModule ||
        programmeFromAptem ||
        metrics.latestProgramme ||
        "Unknown";

      if (
        filters.programme !== "All Programmes" &&
        !matchesAnyExactFilterValue(
          [programme, programmeFromAptem, latestAttendanceModule],
          filters.programme
        )
      ) {
        continue;
      }

      const { firstName, lastName } = splitName(fullName);
      const reviewRow =
        (id && prIndex.byId.get(id)) ||
        (emailKey && prIndex.byEmail.get(emailKey)) ||
        (emailKey && prIndex.byEmailLocal.get(getEmailLocalPart(emailKey))) ||
        (fullName && prIndex.byName.get(normName(fullName))) ||
        findBestProgressReviewMatch({ id, email: emailKey, fullName }, prIndex.rows) ||
        null;

      const overduePrCount = getOverduePrCountFromRow(reviewRow);
      let priority: Learner["priority"] = priorityFromAttendance(metrics.missedInRow);
      const riskCategories: KpiCategory[] = riskCatsFromAttendance(
        metrics.missedInRow,
        metrics.absenceRatio
      );

      if (overduePrCount > 0) {
        riskCategories.push("review-due");
        const prio = priorityFromReview(overduePrCount);
        if (prio === "critical" || (prio === "high" && priority === "normal")) {
          priority = prio;
        }
      }

      const progressVariance = toNum(row?.progressVariance);
      const progressHoursRaw = String(row?.progressHours || "").trim();
      const hasOtjBehind =
        (progressVariance != null && progressVariance < 0) || hasLeadingMinus(progressHoursRaw);
      const otjBehindPct =
        progressVariance != null && progressVariance < 0 ? Math.abs(progressVariance) : 0;
      const otjPriority = getOtjPriority(otjBehindPct);

      if (hasOtjBehind) {
        riskCategories.push("otj-behind");
        if (otjPriority === "at-risk") {
          priority = "critical";
        } else if (otjPriority === "need-attention" && priority === "normal") {
          priority = "high";
        }
      }

      const plannedOtj = toNum(row?.otjPlanned);
      const expectedOtj = toNum(row?.otjExpected);
      const actualOtj = toNum(row?.otjCompleted);
      const totalDays = toNum(row?.totalDays);
      const elapsedDays = toNum(row?.elapsedDays);
      const targetNow =
        plannedOtj && totalDays && elapsedDays
          ? Math.round((elapsedDays / totalDays) * plannedOtj)
          : 0;

      const attendanceEmail = emailKey;
      const attendanceDate = metrics.lastSessionDate || "";
      const attendanceModule = latestAttendanceModule || "";
      const attendanceContactKey =
        attendanceEmail && attendanceDate && attendanceDate !== "N/A" && attendanceModule
          ? `${attendanceEmail}||${attendanceDate}||${attendanceModule}`
          : "";

      const reviewStatusValue = getReviewStatusFromRow(reviewRow);
      const reviewStatus = {
        label: reviewStatusValue,
        tone:
          reviewStatusValue.toLowerCase() === "due"
            ? "due"
            : reviewStatusValue.toLowerCase() === "at risk"
              ? "at-risk"
              : reviewStatusValue.toLowerCase() === "normal"
                ? "normal"
                : "ahead",
      } as const;

      const learner = {
        id: id || emailKey || `aptem:${normName(fullName)}`,
        firstName,
        lastName,
        organisation,
        programme,
        coach: coachName,
        email: emailKey || "Unknown",
        phone: pickFirstString(row, ["learnerPhone", "Learner Phone", "phone", "Phone"]) || "N/A",
        status: toLearnerStatus(aptemProgramStatusRaw),
        absenceRatio: metrics.absenceRatio,
        missedLast10Weeks: metrics.missedLast10Weeks,
        missedInRow: metrics.missedInRow,
        lastSessionDate: metrics.lastSessionDate,
        lastSessionStatus: metrics.lastSessionStatus,
        lastProgressReviewDate: getLastProgressReviewFromRow(reviewRow) || "",
        nextProgressReviewDue: getNextPrDateFromRow(reviewRow),
        progressReviewBooked: false,
        lastMonthlyMeetingDate: "N/A",
        plannedOtjHours: plannedOtj ?? 0,
        expectedOtjHours: expectedOtj ?? 0,
        actualOtjHours: actualOtj ?? 0,
        lineManagerName: row?.managerName || "N/A",
        lineManagerEmail: row?.managerEmail || "N/A",
        lineManagerPhone: row?.managerPhone || "N/A",
        hrManagerName: "",
        hrManagerEmail: "",
        hrManagerPhone: "",
        priority,
        riskCategories: Array.from(new Set(riskCategories)),
      } as Learner;

      (learner as any).hasAttendanceInWindow = metrics.hasAttendanceInWindow;
      (learner as any).hasOtjBehind = hasOtjBehind;
      (learner as any).otjBehindBy = otjBehindPct;
      (learner as any).otjBehindPct = otjBehindPct;
      (learner as any).requiredHoursToSubmit = progressHoursRaw
        ? stripLeadingMinus(progressHoursRaw)
        : "N/A";
      (learner as any).otjPriority = otjPriority;
      (learner as any).otjPriorityLabel = getOtjPriorityLabel(otjPriority);
      (learner as any).targetNow = targetNow;

      (learner as any).overduePrCount = overduePrCount;
      (learner as any).reviewStatusLabel = reviewStatus.label;
      (learner as any).reviewStatusTone = reviewStatus.tone;
      (learner as any).nextReviewStatusRaw = String((reviewRow as any)?.nextReviewStatus || "").trim();
      (learner as any).nextPrDate = getNextPrDateFromRow(reviewRow);
      (learner as any).nextPrState = String((reviewRow as any)?.nextPrState || "").trim();
      (learner as any).bookedPrDate = "N/A";

      (learner as any).coachEmail = row?.ownerEmail || "";
      (learner as any).lineManagerName = row?.managerName || "N/A";
      (learner as any).lineManagerEmail = row?.managerEmail || "No email on file";
      (learner as any).latestAttendanceModule = latestAttendanceModule;
      (learner as any).attendanceEmail = attendanceEmail;
      (learner as any).attendanceDate = attendanceDate;
      (learner as any).attendanceModule = attendanceModule;
      (learner as any).attendanceContactKey = attendanceContactKey;
      (learner as any).programStatusRaw = aptemProgramStatusRaw;
      (learner as any).aptemProgramStatusRaw = aptemProgramStatusRaw;
      (learner as any).hasAptemLearnerRow = true;
      (learner as any)._rawStudent = row;

      out.push(learner);
    }

    const deduped = new Map<string, Learner>();

    for (const learner of out) {
      const key = getLearnerUniqueKey(learner);
      if (!key) continue;

      const existing = deduped.get(key);

      if (!existing) {
        deduped.set(key, learner);
      } else {
        deduped.set(key, mergeLearnerRows(existing, learner));
      }
    }

    const statusFilter =
      filters.status && filters.status !== "All Statuses"
        ? filters.status.toLowerCase()
        : null;
    return Array.from(deduped.values()).filter((l) => {
      const programStatusRaw = getLearnerProgramStatus(l);
      const hasAptemProgramStatus = Boolean(String((l as any).aptemProgramStatusRaw || "").trim());
      const programStatusLower = programStatusRaw.toLowerCase();

      if (statusFilter) {
        if (programStatusLower !== statusFilter) return false;
        return statusFilter === "active" ? hasAptemProgramStatus : true;
      }

      return programStatusLower === "active" && hasAptemProgramStatus;
    });
  }, [filteredRows, aptemLearnersData, absenceWeeks, filters, progressReviewIndex, aptemLearnerIndex, kbcAttendanceRecordsByEmail]);

  const coachMarkingRows = useMemo<CoachMarkingRow[]>(() => {
    const grouped = new Map<string, CoachMarkingRow>();

    const EXCLUDED_OWNERS = new Set(["default owner", "enrolment team"]);

    for (const row of requireMarkingData) {
      const caseOwner = String(row.caseOwner || "").trim();
      if (!caseOwner) continue;
      if (EXCLUDED_OWNERS.has(caseOwner.toLowerCase())) continue;

      if (filters.coach !== "All Coaches" && caseOwner !== filters.coach) continue;

      const existing = grouped.get(caseOwner);
      const n = (v: unknown) => Number(v) || 0;

      if (!existing) {
        grouped.set(caseOwner, {
          coachId: String(row.caseOwnerId || caseOwner),
          coachName: caseOwner,
          totalOverdue: n(row.countEvidencePending),
          todayMarking: n(row.todayCount),
          yesterdayMarking: n(row.yesterdayCount),
          minus2Marking: n(row.day2Count),
          minus3Marking: n(row.day3Count),
          minus4Marking: n(row.day4Count),
          minus5Marking: n(row.day5Count),
          minus6Marking: n(row.day6Count),
          minus7Marking: n(row.day7Count),
          lastWeekPr: 0,
          secondWeekPr: 0,
          thirdWeekPr: 0,
          fourthWeekPr: 0,
          monthlyTotalPrDoneOld: 0,
          actuallyMonthlyDone: 0,
          monthlyTotalPrRequired: 0,
          completionRate: 0,
        });
      } else {
        existing.totalOverdue += n(row.countEvidencePending);
        existing.todayMarking += n(row.todayCount);
        existing.yesterdayMarking += n(row.yesterdayCount);
        existing.minus2Marking += n(row.day2Count);
        existing.minus3Marking += n(row.day3Count);
        existing.minus4Marking += n(row.day4Count);
        existing.minus5Marking += n(row.day5Count);
        existing.minus6Marking += n(row.day6Count);
        existing.minus7Marking += n(row.day7Count);
      }
    }

    return Array.from(grouped.values()).sort((a, b) => b.totalOverdue - a.totalOverdue);
  }, [requireMarkingData, filters.coach]);

  const kpiCards = useMemo<KpiCardData[]>(() => {
    const activeOnly = activeLearners.filter((l) => l.status === "Active");
    const total = activeOnly.length;

    const activeEmailSet = new Set(activeOnly.map((l) => normEmail(l.email)));
    const missed = [...kbcAttMetrics.entries()].filter(
      ([email, m]) =>
        activeEmailSet.has(email) && m.hasAttendanceInWindow && m.lastSessionStatus === "Missed"
    ).length;
    const countMissedForAbsenceBucket = (bucket: "all" | 0 | 1 | 2 | 3): number => {
      if (bucket === "all") return missed;
      let count = 0;
      for (const rec of kbcAttendanceData) {
        const email = normEmail(rec.email);
        if (!email || !activeEmailSet.has(email)) continue;
        const metrics = buildAttendanceMetricsFromRecords(rec.records || [], bucket);
        if (metrics.hasAttendanceInWindow && metrics.lastSessionStatus === "Missed") count++;
      }
      return count;
    };
    const previousMissed =
      absenceWeeks === "all" || absenceWeeks === 3
        ? null
        : countMissedForAbsenceBucket(((absenceWeeks as number) + 1) as 0 | 1 | 2 | 3);

    const { start: prStart, end: prEnd } = getPrDateRange(prMonthOffset);
    const allStatuses = prMonthOffset === "last12weeks";
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const requiredCutoff = new Date(todayStart);
    requiredCutoff.setDate(todayStart.getDate() + 1);
    const bookedCutoff = new Date(todayStart);
    bookedCutoff.setDate(todayStart.getDate() + 1);
    const countReviewDueForRange = (
      start: Date,
      end: Date,
      useAllStatuses: boolean,
      todayCutoff?: Date
    ): number => {
      const emails = new Set(
        progressReviewRows
          .filter((row: any) => {
            if (prStatusFilter !== "All") {
              const state = String(row.nextPrState || "").trim().toLowerCase();
              if (prStatusFilter === "Not Scheduled") { if (state !== "" && state !== "not scheduled") return false; }
              else if (state !== prStatusFilter.toLowerCase()) return false;
            }
            return Boolean(getProgressReviewMatchInRange(row, start, end, useAllStatuses, todayCutoff));
          })
          .map((row: any) => normEmail(row.email))
      );
      return activeOnly.filter((l) => emails.has(normEmail(l.email))).length;
    };
    const dueEmails = new Set(
      progressReviewRows
        .filter((row: any) => {
          if (prStatusFilter !== "All") {
            const state = String(row.nextPrState || "").trim().toLowerCase();
            if (prStatusFilter === "Not Scheduled") { if (state !== "" && state !== "not scheduled") return false; }
            else if (state !== prStatusFilter.toLowerCase()) return false;
          }
          return Boolean(
            getProgressReviewMatchInRange(
              row,
              prStart,
              prEnd,
              allStatuses,
              allStatuses ? requiredCutoff : undefined
            )
          );
        })
        .map((row: any) => normEmail(row.email))
    );
    const reviewDue = activeOnly.filter((l) => dueEmails.has(normEmail(l.email))).length;
    const previousPrRange =
      prMonthOffset === "last12weeks"
        ? (() => {
            const end = new Date(prStart);
            end.setMilliseconds(-1);
            const start = new Date(prStart);
            start.setDate(start.getDate() - 7 * 12);
            return { start, end };
          })()
        : getPrDateRange((prMonthOffset as number) - 1);
    const previousReviewDue = countReviewDueForRange(
      previousPrRange.start,
      previousPrRange.end,
      allStatuses
    );

    const buildBookedEmailsForRange = (start: Date, end: Date, cutoff?: Date): string[] => {
      const emails = new Set<string>();
      for (const row of progressReviewRows as any[]) {
        const e = normEmail(row.email);
        if (!e || emails.has(e)) continue;
        const match = getBookedProgressReviewMatchInRange(row, start, end, cutoff);
        if (match) emails.add(e);
      }
      return [...emails];
    };
    const countReviewBookedForRange = (start: Date, end: Date, cutoff?: Date) => {
      const emails = new Set(
        prMonthOffset === "last12weeks"
          ? buildBookedEmailsForRange(start, end, cutoff)
          : prBookedData
              .filter((row) => {
                const dt = parseBookedDate(row.nextBookedDate);
                return dt !== null && dt >= start && dt <= end;
              })
              .map((row) => normEmail(row.email))
      );
      return activeOnly.filter((l) => emails.has(normEmail(l.email))).length;
    };

    const bookedInMonthEmails = new Set(
      prMonthOffset === "last12weeks"
        ? buildBookedEmailsForRange(prStart, prEnd, bookedCutoff)
        : prBookedData
            .filter((row) => {
              const dt = parseBookedDate(row.nextBookedDate);
              return dt !== null && dt >= prStart && dt <= prEnd;
            })
            .map((row) => normEmail(row.email))
    );
    const reviewBooked = activeOnly.filter((l) =>
      bookedInMonthEmails.has(normEmail(l.email))
    ).length;
    const previousReviewBooked = countReviewBookedForRange(
      previousPrRange.start,
      previousPrRange.end
    );

    const { start: mcrStart, end: mcrEnd } = getMcrMonthRange(mcrMonthOffset);
    const mcrToday = new Date();
    mcrToday.setHours(0, 0, 0, 0);
    const isPastMonth = mcrMonthOffset < 0;
    const excludeMcrStart = mcrMonthOffset === -1;
    const previousMcrRange =
      mcrMonthOffset === -1
        ? (() => {
            const end = new Date(mcrStart);
            end.setHours(23, 59, 59, 999);
            const start = new Date(mcrStart);
            start.setDate(start.getDate() - 30);
            return { start, end };
          })()
        : getMcrMonthRange(mcrMonthOffset - 1);
    const countMcrDueForRange = (
      start: Date,
      end: Date,
      pastPeriod: boolean,
      excludeStart = false
    ) => {
      const emails = new Set(
        mcrData
          .filter((row: any) =>
            (row.mcmDates || []).some((d: any) => {
              const dt = getMcmScopeDate(d);
              if (!isDateWithinRange(dt, start, end, excludeStart)) return false;
              if (pastPeriod) return true;
              if (d.completed) return false;
              const statusLower = String(d.status || "").toLowerCase();
              const isScheduled = statusLower.includes("scheduled") && !statusLower.includes("not");
              if (dt > mcrToday && isScheduled) return false;
              return true;
            })
          )
          .map((row: any) => normEmail(row.email))
      );
      return activeOnly.filter((l) => emails.has(normEmail(l.email))).length;
    };
    const countMcrBookedForRange = (
      start: Date,
      end: Date,
      pastPeriod: boolean,
      excludeStart = false
    ) => {
      const emails = new Set(
        mcrData
          .filter((row: any) =>
            (row.mcmDates || []).some((d: any) => {
              const dt = getMcmScopeDate(d);
              if (!isDateWithinRange(dt, start, end, excludeStart)) return false;
              const statusLower = String(d.status || "").toLowerCase();
              if (pastPeriod) {
                return (
                  statusLower.includes("completed") ||
                  (statusLower.includes("scheduled") && !statusLower.includes("not")) ||
                  statusLower.includes("in progress")
                );
              }
              return statusLower.includes("scheduled") && !statusLower.includes("not");
            })
          )
          .map((row: any) => normEmail(row.email))
      );
      return uniqueLearnersByPerson(
        activeOnly.filter((l) => emails.has(normEmail(l.email)))
      ).length;
    };
    const mcrDueEmails = new Set(
      mcrData
        .filter((row: any) =>
          (row.mcmDates || []).some((d: any) => {
            const dt = getMcmScopeDate(d);
            if (!isDateWithinRange(dt, mcrStart, mcrEnd, excludeMcrStart)) return false;
            // Past months: include all statuses (Completed, In Progress, Awaiting Signature, Scheduled)
            if (isPastMonth) return true;
            // Current/future months: only show pending/due meetings
            if (d.completed) return false;
            const statusLower = String(d.status || "").toLowerCase();
            const isScheduled = statusLower.includes("scheduled") && !statusLower.includes("not");
            if (dt > mcrToday && isScheduled) return false;
            return true;
          })
        )
        .map((row: any) => normEmail(row.email))
    );
    const coachingDue = activeOnly.filter((l) =>
      mcrDueEmails.has(normEmail(l.email))
    ).length;
    const previousCoachingDue = countMcrDueForRange(
      previousMcrRange.start,
      previousMcrRange.end,
      true,
      excludeMcrStart
    );

    const mcrBookedEmails = new Set(
      mcrData
        .filter((row: any) =>
          (row.mcmDates || []).some((d: any) => {
            const dt = getMcmScopeDate(d);
            if (!isDateWithinRange(dt, mcrStart, mcrEnd, excludeMcrStart)) return false;
            const statusLower = String(d.status || "").toLowerCase();
            if (isPastMonth) {
              return (
                statusLower.includes("completed") ||
                (statusLower.includes("scheduled") && !statusLower.includes("not")) ||
                statusLower.includes("in progress")
              );
            }
            return statusLower.includes("scheduled") && !statusLower.includes("not");
          })
        )
        .map((row: any) => normEmail(row.email))
    );
    const coachingBooked = activeOnly.filter((l) =>
      mcrBookedEmails.has(normEmail(l.email))
    );
    const coachingBookedCount = uniqueLearnersByPerson(coachingBooked).length;
    const previousCoachingBooked = countMcrBookedForRange(
      previousMcrRange.start,
      previousMcrRange.end,
      true,
      excludeMcrStart
    );

    const otjAtRiskEmails = new Set(
      otjAtRiskData.map((row: any) => normEmail(row.email))
    );
    const otjBehind = activeOnly.filter((l) =>
      otjAtRiskEmails.has(normEmail(l.email))
    ).length;

    const coachMarkingOverdue = coachMarkingRows.filter((r) => r.totalOverdue > 0).length;
    const coachMarkingTotal = coachMarkingRows.length;

    const mk = (
      id: KpiCategory,
      title: string,
      count: number,
      totalValue = total,
      previousCount: number | null = null
    ): KpiCardData =>
      ({
        id,
        title,
        count,
        total: totalValue,
        percentage: totalValue ? Math.round((count / totalValue) * 100) : 0,
        trend: previousCount == null ? null : count - previousCount,
        accentClass: kpiAccentClass[id],
      }) as KpiCardData;

    return [
      mk("missed-session", "Attendance (Missed Session)", missed, total, previousMissed),
      mk("review-due", "Progress Review Required", reviewDue, total, previousReviewDue),
      mk("review-booked", "Progress Review Scheduled", reviewBooked, total, previousReviewBooked),
      mk("coaching-due", "Monthly Coaching Meeting Required", coachingDue, total, previousCoachingDue),
      mk("coaching-booked", "Monthly Coaching Meeting Scheduled", coachingBookedCount, total, previousCoachingBooked),
      mk("otj-behind", "OTJH Behind", otjBehind),
      mk(
        "coach-marking-overdue",
        "Coach Marking - Overdue",
        coachMarkingOverdue,
        coachMarkingTotal
      ),
      ...(filters.status && filters.status !== "All Statuses" ? (() => {
        const selectedStatus = filters.status.toLowerCase();
        const statusCount = activeLearners.filter((l) =>
          getLearnerProgramStatus(l).toLowerCase() === selectedStatus
        ).length;
        return [mk("status-view", filters.status, statusCount, statusCount)];
      })() : []),
    ];
  }, [activeLearners, coachMarkingRows, kbcAttMetrics, kbcAttendanceData, absenceWeeks, prMonthOffset, prStatusFilter, prBookedData, progressReviewRows, mcrData, mcrMonthOffset, otjAtRiskData, filters.status]);

  const filteredLearners = useMemo(() => {
    if (!activeKpi) return [];

    let result: Learner[] = [];

    if (activeKpi === "missed-session") {
      result = activeLearners
        .filter((l) => {
          const m = kbcAttMetrics.get(normEmail(l.email));
          return m?.hasAttendanceInWindow && m?.lastSessionStatus === "Missed";
        })
        .map((l) => {
          const m = kbcAttMetrics.get(normEmail(l.email));
          if (!m) return l;
          return {
            ...l,
            absenceRatio: m.absenceRatio,
            missedLast10Weeks: m.missedLast10Weeks,
            missedInRow: m.missedInRow,
            lastSessionDate: m.lastSessionDate,
            lastSessionStatus: m.lastSessionStatus,
          };
        });
    } else if (activeKpi === "review-due") {
      const { start: prDueStart, end: prDueEnd } = getPrDateRange(prMonthOffset);
      const allStatusesDue = prMonthOffset === "last12weeks";
      const todayStartDue = new Date();
      todayStartDue.setHours(0, 0, 0, 0);
      const requiredCutoffDue = new Date(todayStartDue);
      requiredCutoffDue.setDate(todayStartDue.getDate() + 1);
      const dueByEmail = new Map<string, any>();
      for (const row of progressReviewRows as any[]) {
          if (prStatusFilter !== "All") {
            const state = String(row.nextPrState || "").trim().toLowerCase();
            if (prStatusFilter === "Not Scheduled") {
              if (state !== "" && state !== "not scheduled") continue;
            } else if (state !== prStatusFilter.toLowerCase()) {
              continue;
            }
          }
          const match = getProgressReviewMatchInRange(
            row,
            prDueStart,
            prDueEnd,
            allStatusesDue,
            allStatusesDue ? requiredCutoffDue : undefined
          );
          if (match) {
            dueByEmail.set(normEmail(row.email), {
              ...row,
              prMatchReason: formatProgressReviewReason(match),
            });
          }
        }
      result = activeLearners
        .filter((l) => dueByEmail.has(normEmail(l.email)))
        .map((l) => {
          const prRow = dueByEmail.get(normEmail(l.email));
          return {
            ...l,
            overduePrCount: prRow?.overduePrCount ?? (l as any).overduePrCount,
            reviewStatusLabel: prRow?.reviewStatus ?? (l as any).reviewStatusLabel,
            nextPrDate: prRow?.nextPrDate ?? (l as any).nextPrDate,
            nextPrState: prRow?.nextPrState ?? (l as any).nextPrState,
            prMatchReason: prRow?.prMatchReason ?? "N/A",
            lastProgressReviewDate: prRow?.lastProgressReview ?? (l as any).lastProgressReviewDate,
            bookedPrDate: (l as any).bookedPrDate ?? "N/A",
          } as typeof l;
        })
        .sort((a, b) => {
          const aCount = Number((a as any).overduePrCount ?? 0);
          const bCount = Number((b as any).overduePrCount ?? 0);
          if (bCount !== aCount) return bCount - aCount;
          const aDate = String((a as any).nextPrDate || "");
          const bDate = String((b as any).nextPrDate || "");
          return aDate.localeCompare(bDate);
        });
      if (prOverdueFilter) {
        result = result.filter((l) => Number((l as any).overduePrCount ?? 0) >= 1);
      }
    } else if (activeKpi === "review-booked") {
      const { start: prStart, end: prEnd } = getPrDateRange(prMonthOffset);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const bookedCutoff = new Date(todayStart);
      bookedCutoff.setDate(todayStart.getDate() + 1);

      const bookedByEmail = new Map<string, { date: string; status: string }>();
      if (prMonthOffset === "last12weeks") {
        // Last 12 Weeks: past activity only — In Progress, Awaiting Signature, Completed
        for (const row of progressReviewRows as any[]) {
          const email = normEmail(row.email);
          if (!email || bookedByEmail.has(email)) continue;
          const match = getBookedProgressReviewMatchInRange(row, prStart, prEnd, bookedCutoff);
          if (match) {
            bookedByEmail.set(email, {
              date: match.date,
              status: getProgressReviewStatusLabel(match.status),
            });
          }
        }
      } else {
        for (const row of prBookedData) {
          const email = normEmail(row.email);
          if (!email) continue;
          const dt = parseBookedDate(row.nextBookedDate);
          if (dt !== null && dt >= prStart && dt <= prEnd) {
            bookedByEmail.set(email, { date: row.nextBookedDate, status: "Scheduled" });
          }
        }
      }

      result = activeLearners
        .filter((l) => bookedByEmail.has(normEmail(l.email)))
        .map((l) => {
          const entry = bookedByEmail.get(normEmail(l.email));
          return {
            ...l,
            bookedPrDate: entry?.date || "",
            bookedPrStatus: entry?.status || "",
          } as typeof l;
        })
        .sort((a, b) => {
          const aDate = String((a as any).bookedPrDate || "");
          const bDate = String((b as any).bookedPrDate || "");
          return aDate.localeCompare(bDate);
        });
    } else if (activeKpi === "coaching-due") {
      const { start: mcrStart, end: mcrEnd } = getMcrMonthRange(mcrMonthOffset);
      const mcrTodayFL = new Date();
      mcrTodayFL.setHours(0, 0, 0, 0);
      const isPastMonthFL = mcrMonthOffset < 0;
      const excludeMcrStartFL = mcrMonthOffset === -1;
      if (isPastMonthFL) {
        const mcrDueByEmail = new Map<string, any>();

        for (const row of mcrData) {
          const email = normEmail(row.email);
          if (!email) continue;
          if (mcrDueByEmail.has(email)) continue;

          const matchDate = (row.mcmDates || []).find((d: any) => {
            const dt = getMcmScopeDate(d);
            return isDateWithinRange(dt, mcrStart, mcrEnd, excludeMcrStartFL);
          });

          if (matchDate) {
            const overdueNotScheduledCount = (row.mcmDates || []).filter((d: any) => {
              const dt = parseBookedDate(d.date);
              const statusLower = String(d.status || "").toLowerCase();
              return (
                isDateWithinRange(dt, mcrStart, mcrEnd, excludeMcrStartFL) &&
                dt !== null &&
                dt < mcrTodayFL &&
                !d.completed &&
                statusLower.includes("not scheduled")
              );
            }).length;

            mcrDueByEmail.set(email, {
              ...row,
              matchedDate: formatDateKey(getMcmScopeDate(matchDate) || parseBookedDate(matchDate.date)!),
              matchedStatus: matchDate.status,
              overdueNotScheduledCount,
              accumulatedOverdue: 0,
            });
          }
        }

        result = activeLearners
          .filter((l) => mcrDueByEmail.has(normEmail(l.email)))
          .map((l) => {
            const mcr = mcrDueByEmail.get(normEmail(l.email));
            return {
              ...l,
              nextMonthlyMeetingDue: mcr?.matchedDate ?? (l as any).nextMonthlyMeetingDue,
              nextMonthlyMeetingStatus: mcr?.matchedStatus ?? "",
              overdueNotScheduledMcmCount: mcr?.overdueNotScheduledCount ?? 0,
              overdueMcmCount: 0,
            } as typeof l;
          })
          .sort((a, b) => {
          const aDate = String((a as any).nextMonthlyMeetingDue || "");
          const bDate = String((b as any).nextMonthlyMeetingDue || "");
          return aDate.localeCompare(bDate);
        });
      } else {
      const mcrDueByEmail = new Map<string, any>();
      for (const row of mcrData) {
        const email = normEmail(row.email);
        if (!email) continue;
        const matchDate = (row.mcmDates || []).find((d: any) => {
          const dt = getMcmScopeDate(d);
          if (!isDateWithinRange(dt, mcrStart, mcrEnd, excludeMcrStartFL)) return false;
          if (isPastMonthFL) return true;
          if (d.completed) return false;
          const statusLower = String(d.status || "").toLowerCase();
          const isScheduled = statusLower.includes("scheduled") && !statusLower.includes("not");
          if (dt > mcrTodayFL && isScheduled) return false;
          return true;
        });
        if (matchDate && !mcrDueByEmail.has(email)) {
          const accumulatedOverdue = (row.mcmDates || []).filter((d: any) => {
            const dt = parseBookedDate(d.date);
            return dt !== null && dt < mcrTodayFL && !d.completed;
          }).length;
          const overdueNotScheduledCount = (row.mcmDates || []).filter((d: any) => {
            const dt = parseBookedDate(d.date);
            const statusLower = String(d.status || "").toLowerCase();
            return (
              isDateWithinRange(dt, mcrStart, mcrEnd, excludeMcrStartFL) &&
              dt !== null &&
              dt < mcrTodayFL &&
              !d.completed &&
              statusLower.includes("not scheduled")
            );
          }).length;

          mcrDueByEmail.set(email, {
            ...row,
            matchedDate: formatDateKey(getMcmScopeDate(matchDate) || parseBookedDate(matchDate.date)!),
            matchedStatus: matchDate.status,
            overdueNotScheduledCount,
            accumulatedOverdue,
          });
        }
      }
      result = activeLearners
        .filter((l) => mcrDueByEmail.has(normEmail(l.email)))
        .map((l) => {
          const mcr = mcrDueByEmail.get(normEmail(l.email));
          const accumulatedOverdue = mcr?.accumulatedOverdue ?? 0;
          const mcmPriority: Learner["priority"] =
            accumulatedOverdue > 6 ? "critical" : accumulatedOverdue > 3 ? "high" : "normal";
          return {
            ...l,
            priority: mcmPriority,
            nextMonthlyMeetingDue: mcr?.matchedDate ?? mcr?.nextDueDate ?? (l as any).nextMonthlyMeetingDue,
            nextMonthlyMeetingStatus: mcr?.matchedStatus ?? "",
            overdueNotScheduledMcmCount: mcr?.overdueNotScheduledCount ?? 0,
            overdueMcmCount: accumulatedOverdue,
          } as typeof l;
        })
        .sort((a, b) =>
          Number((b as any).overdueMcmCount ?? 0) - Number((a as any).overdueMcmCount ?? 0)
        );
      }
      if (mcrOverdueFilter) {
        result = result.filter(
          (l) => Number((l as any).overdueMcmCount ?? 0) >= 1
        );
      }
    } else if (activeKpi === "coaching-booked") {
      const { start: mcrStartB, end: mcrEndB } = getMcrMonthRange(mcrMonthOffset);
      const isPastMonthBooked = mcrMonthOffset < 0;
      const excludeMcrStartBooked = mcrMonthOffset === -1;
      const mcrBookedByEmail = new Map<string, any>();
      for (const row of mcrData) {
        const email = normEmail(row.email);
        if (!email) continue;
        const matchDate = (row.mcmDates || []).find((d: any) => {
          const dt = getMcmScopeDate(d);
          if (!isDateWithinRange(dt, mcrStartB, mcrEndB, excludeMcrStartBooked)) return false;
          const statusLower = String(d.status || "").toLowerCase();
          if (isPastMonthBooked) {
            return (
              statusLower.includes("completed") ||
              (statusLower.includes("scheduled") && !statusLower.includes("not")) ||
              statusLower.includes("in progress")
            );
          }
          return statusLower.includes("scheduled") && !statusLower.includes("not");
        });
        if (matchDate && !mcrBookedByEmail.has(email)) {
          mcrBookedByEmail.set(email, {
            ...row,
            matchedDate: formatDateKey(getMcmScopeDate(matchDate) || parseBookedDate(matchDate.date)!),
            matchedStatus: matchDate.status,
          });
        }
      }
      result = activeLearners
        .filter((l) => mcrBookedByEmail.has(normEmail(l.email)))
        .map((l) => {
          const mcr = mcrBookedByEmail.get(normEmail(l.email));
          return {
            ...l,
            bookedMcmDate: mcr?.matchedDate ?? "",
            bookedMcmStatus: mcr?.matchedStatus ?? "",
          } as typeof l;
        })
        .sort((a, b) => {
          const aDate = String((a as any).bookedMcmDate || "");
          const bDate = String((b as any).bookedMcmDate || "");
          return aDate.localeCompare(bDate);
        });
      result = uniqueLearnersByPerson(result);
    } else if (activeKpi === "otj-behind") {
      const otjByEmail = new Map<string, any>();
      for (const row of otjAtRiskData) {
        const email = normEmail(row.email);
        if (email) otjByEmail.set(email, row);
      }
      result = activeLearners
        .filter((l) => otjByEmail.has(normEmail(l.email)))
        .map((l) => {
          const aptem = otjByEmail.get(normEmail(l.email));
          const progressVariance = toNum(aptem?.progressVariance);
          const otjBehindPct =
            progressVariance !== null && progressVariance < 0
              ? Math.abs(progressVariance)
              : 0;
          const aptemPlanned = Number(aptem?.otjPlanned ?? 0);
          const aptemTotalDays = Number(aptem?.totalDays ?? 0);
          const aptemElapsedDays = Number(aptem?.elapsedDays ?? 0);
          const aptemTargetNow =
            aptemPlanned && aptemTotalDays && aptemElapsedDays
              ? Math.round((aptemElapsedDays / aptemTotalDays) * aptemPlanned)
              : Number((l as any).targetNow || 0);
          return {
            ...l,
            plannedOtjHours: aptem?.otjPlanned ?? (l as any).plannedOtjHours,
            actualOtjHours: aptem?.otjCompleted ?? (l as any).actualOtjHours,
            expectedOtjHours: aptem?.otjExpected ?? (l as any).expectedOtjHours,
            targetNow: aptemTargetNow,
            otjBehindPct,
            otjHoursStatus: aptem?.otjHoursStatus ?? "",
            requiredHoursToSubmit: aptem?.progressHours
              ? String(aptem.progressHours).replace(/^\s*-\s*/, "").trim()
              : (l as any).requiredHoursToSubmit,
            otjPriority: getOtjPriority(otjBehindPct),
          } as typeof l;
        })
        .sort(
          (a, b) =>
            Number((b as any).otjBehindPct ?? 0) -
            Number((a as any).otjBehindPct ?? 0)
        );
    } else if (activeKpi === "status-view") {
      const selectedStatus = filters.status;
      result = activeLearners.filter((l) => {
        const raw = getLearnerProgramStatus(l).toLowerCase();
        return raw === selectedStatus.toLowerCase();
      });
    }

    return result.map((l) => {
      const contactKey = String((l as any).attendanceContactKey || "");

      return {
        ...l,
        isResolved: contactActions[contactKey]?.resolved ?? false,
        called: contactActions[contactKey]?.called ?? false,
        emailed: contactActions[contactKey]?.emailed ?? false,
        note: contactActions[contactKey]?.note ?? "",
      };
    });
  }, [activeLearners, activeKpi, contactActions, kbcAttMetrics, prMonthOffset, prStatusFilter, prOverdueFilter, prBookedData, progressReviewRows, mcrData, mcrMonthOffset, mcrOverdueFilter, otjAtRiskData]);

  useEffect(() => {
    setSelectedLearner((prev) => {
      if (!prev) return prev;
      const updated = filteredLearners.find((l) => l.id === prev.id);
      return updated ?? prev;
    });
  }, [filteredLearners]);

  const activeCardTitle = activeKpi ? kpiCards.find((c) => c.id === activeKpi)?.title || "" : "";
  const learnerStatusOptions = useMemo(() => {
    const statuses = aptemLearnersData
      .map((row) =>
        pickFirstString(row, [
          "programStatus",
          "Program-Status",
          "Program Status",
          "program_status",
          "Status",
          "status",
        ])
      )
      .filter(Boolean);

    return Array.from(new Set(statuses)).sort((a, b) => a.localeCompare(b));
  }, [aptemLearnersData]);

  const detailContext = (() => {
    if (!activeKpi) return null;

    const chips: string[] = [];
    const rules: string[] = [];

    if (filters.coach !== "All Coaches") chips.push(`Coach: ${filters.coach}`);
    if (filters.programme !== "All Programmes") chips.push(`Programme: ${filters.programme}`);
    if (filters.organisation !== "All Organizations") chips.push(`Organisation: ${filters.organisation}`);
    if (filters.status !== "All Statuses") chips.push(`Status: ${filters.status}`);

    if (activeKpi === "review-due" || activeKpi === "review-booked") {
      if (prMonthOffset !== 0) chips.push(`PR Period: ${getPrMonthLabel(prMonthOffset)}`);
      if (activeKpi === "review-due" && prStatusFilter !== "All") {
        chips.push(`PR Status: ${prStatusFilter}`);
      }
      if (prMonthOffset === "last12weeks") {
        rules.push("Excludes Personal Support Plan and Gateway Review");
        rules.push("Future meetings after today are excluded from Last 12 Weeks");
      }
    }

    if (activeKpi === "coaching-due" || activeKpi === "coaching-booked") {
      if (mcrMonthOffset !== 0) chips.push(`MCM Period: ${getMcrPeriodLabel(mcrMonthOffset)}`);
      if (mcrMonthOffset === -1) rules.push("Start boundary excluded; today included");
    }

    if (activeKpi === "missed-session") {
      if (absenceWeeks !== 0) {
        chips.push(`Attendance: ${absenceWeeks === "all" ? "All" : getWeekLabel(absenceWeeks)}`);
      }
    }

    return { chips, rules };
  })();

  const attendanceHistorySyncUntilRef = useRef(0);
  const lastAttendanceHistorySyncAtRef = useRef(0);

  const refreshDashboardData = useCallback(async () => {
    await Promise.all([
      load(),
      loadContactActions(),
      loadProgressReviewSummary(),
      loadPrBookedData(),
      loadMcrData(),
      loadOtjAtRiskData(),
      loadAptemLearnersData(),
      loadRequireMarkingData(),
      loadKbcAttendanceData(),
    ]);
  }, [
    load,
    loadContactActions,
    loadProgressReviewSummary,
    loadPrBookedData,
    loadMcrData,
    loadOtjAtRiskData,
    loadAptemLearnersData,
    loadRequireMarkingData,
    loadKbcAttendanceData,
  ]);

  const refreshAttendanceData = useCallback(async () => {
    await Promise.all([load(false), loadKbcAttendanceData()]);
  }, [load, loadKbcAttendanceData]);

  const syncAttendanceHistoryDashboard = useCallback((force = false) => {
    const now = Date.now();
    const historySyncActive = now <= attendanceHistorySyncUntilRef.current;
    const attendanceKpiOpen = activeKpi === "missed-session";

    if (!force && !historySyncActive && !attendanceKpiOpen) return;
    if (document.visibilityState !== "visible") return;
    if (!force && now - lastAttendanceHistorySyncAtRef.current < 2500) return;

    lastAttendanceHistorySyncAtRef.current = now;
    void refreshAttendanceData();
  }, [activeKpi, refreshAttendanceData]);

  const handleAttendanceHistoryOpened = useCallback(() => {
    attendanceHistorySyncUntilRef.current = Date.now() + 5 * 60 * 1000;
    lastAttendanceHistorySyncAtRef.current = 0;
    syncAttendanceHistoryDashboard(true);
  }, [syncAttendanceHistoryDashboard]);

  useEffect(() => {
    const handleFocus = () => syncAttendanceHistoryDashboard();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") syncAttendanceHistoryDashboard();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [syncAttendanceHistoryDashboard]);

  useEffect(() => {
    const intervalId = window.setInterval(syncAttendanceHistoryDashboard, 3000);
    return () => window.clearInterval(intervalId);
  }, [syncAttendanceHistoryDashboard]);

  return (
    <AppLayout>
      <div className="min-h-screen bg-[#F4F8FC] text-[#20344D]">
        <GlobalFilters
          rows={rows}
          loading={loading}
          filters={filters}
          onChange={setFilters}
          onRefresh={refreshDashboardData}
          learnerStatusOptions={learnerStatusOptions}
          showPrMonthFilter={activeKpi === "review-booked" || activeKpi === "review-due"}
          prMonthOffset={prMonthOffset}
          onPrMonthOffsetChange={setPrMonthOffset}
          getPrMonthLabel={getPrMonthLabel}
          showPrStatusFilter={activeKpi === "review-due"}
          prStatusFilter={prStatusFilter}
          onPrStatusFilterChange={handlePrStatusFilterChange}
          prStatusOptions={prStatusOptions}
          showMcrMonthFilter={activeKpi === "coaching-due" || activeKpi === "coaching-booked"}
          mcrMonthOffset={mcrMonthOffset}
          onMcrMonthOffsetChange={setMcrMonthOffset}
          showAbsenceFilter={activeKpi === "missed-session"}
          absenceWeeks={absenceWeeks}
          onAbsenceWeeksChange={setAbsenceWeeks}
          getWeekLabel={getWeekLabel}
        />

        <div className="w-full space-y-4 p-3 sm:p-4 lg:space-y-5 lg:p-6">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-3 items-stretch">
            {kpiCards.map((card, i) => (
              <div
                key={card.id}
                className="min-w-0 animate-fade-in"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <KpiCard
                  data={card}
                  active={activeKpi === card.id}
                  onClick={() =>
                    setActiveKpi(activeKpi === card.id ? null : (card.id as KpiCategory))
                  }
                />
              </div>
            ))}
          </div>

          {activeKpi === "coach-marking-overdue" && (
            <div className="rounded-lg border border-[#DDE7F0] bg-white p-4 shadow-[0_10px_28px_rgba(20,38,74,0.06)] sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase text-[#1E6ACB]">Coach evidence</p>
                  <h3 className="mt-1 text-base font-bold text-[#14264A] sm:text-lg">
                    {kpiCards.find((c) => c.id === activeKpi)?.title}
                  </h3>
                </div>
                <span className="rounded-full bg-[#EEF7FF] px-3 py-1 text-xs font-bold text-[#184D91]">
                  {coachMarkingRows.length} coach{coachMarkingRows.length !== 1 ? "es" : ""}
                </span>
              </div>

              <CoachMarkingTable rows={coachMarkingRows} />
            </div>
          )}

          {activeKpi && activeKpi !== "coach-marking-overdue" && (
            <div className="rounded-lg border border-[#DDE7F0] bg-white p-4 shadow-[0_10px_28px_rgba(20,38,74,0.06)] sm:p-5">
              <div className="mb-4 space-y-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase text-[#1E6ACB]">Learner detail</p>
                    <h3 className="mt-1 text-base font-bold text-[#14264A] sm:text-lg">
                      {activeCardTitle}
                    </h3>
                    <p className="text-sm text-[#71849A]">
                      {filteredLearners.length} learner{filteredLearners.length !== 1 ? "s" : ""} match the current filters
                    </p>
                  </div>
                </div>

                {detailContext && (detailContext.chips.length > 0 || detailContext.rules.length > 0 || activeKpi === "review-due" || activeKpi === "coaching-due") && (
                  <div className="rounded-lg border border-[#DDE7F0] bg-[#F8FBFE] px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      {detailContext.chips.map((chip) => (
                        <span
                          key={chip}
                          className="inline-flex min-h-9 items-center justify-center rounded-full bg-white px-4 py-2 text-sm font-semibold leading-none text-[#184D91] ring-1 ring-[#B8D7F2]"
                        >
                          {chip}
                        </span>
                      ))}
                      {activeKpi === "review-due" && (
                        <button
                          onClick={() => setPrOverdueFilter((v) => !v)}
                          className={`inline-flex min-h-9 items-center rounded-full px-4 py-2 text-sm font-bold ring-2 transition-colors ${
                            prOverdueFilter
                              ? "bg-[#B42332] text-white ring-[#B42332]"
                              : "bg-[#14264A] text-white ring-[#14264A] hover:bg-[#1E3A6E]"
                          }`}
                        >
                          Overdue
                        </button>
                      )}
                      {activeKpi === "coaching-due" && (
                        <button
                          onClick={() => setMcrOverdueFilter((v) => !v)}
                          className={`inline-flex min-h-9 items-center rounded-full px-4 py-2 text-sm font-bold ring-2 transition-colors ${
                            mcrOverdueFilter
                              ? "bg-[#B42332] text-white ring-[#B42332]"
                              : "bg-[#14264A] text-white ring-[#14264A] hover:bg-[#1E3A6E]"
                          }`}
                        >
                          Overdue
                        </button>
                      )}
                      {detailContext.rules.map((rule) => (
                        <span
                          key={rule}
                          className="inline-flex min-h-9 items-center justify-center rounded-full bg-[#FFF8E8] px-4 py-2 text-sm font-semibold leading-none text-[#94610A] ring-1 ring-[#F1D79D]"
                        >
                          {rule}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <LearnerTable
                key={`${activeKpi}-${absenceWeeks}`}
                learners={filteredLearners}
                kpiCategory={activeKpi}
                onSelectLearner={setSelectedLearner}
                sessionTypeFilter={bookedSessionTypeFilter}
                onSessionTypeFilterChange={setBookedSessionTypeFilter}
                onUpdateContactAction={updateContactAction}
                isPastMcrMonth={mcrMonthOffset < 0}
              />
            </div>
          )}

          {!activeKpi && (
            <div className="rounded-lg border border-dashed border-[#B8D7F2] bg-white px-4 py-10 text-center shadow-[0_8px_22px_rgba(20,38,74,0.05)] sm:px-6 sm:py-12">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-[#EEF7FF] text-[#184D91]">
                <BarChart3 className="h-5 w-5" />
              </div>
              <p className="text-base font-bold text-[#14264A] sm:text-lg">
                KPI details are ready
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm text-[#71849A]">
                Open any KPI card above to load the matching learner list, actions, and export tools.
              </p>
            </div>
          )}
        </div>

        <LearnerDrawer
          learner={selectedLearner}
          open={!!selectedLearner}
          onClose={() => setSelectedLearner(null)}
          onUpdateContactAction={updateContactAction}
          otjAtRiskData={otjAtRiskData}
          mcrData={mcrData}
          progressReviewRows={progressReviewRows}
          prBookedData={prBookedData}
          onAttendanceHistoryOpened={handleAttendanceHistoryOpened}
          onResolve={({ contactKey, email, date, module, resolved, note }) => {
            void updateContactAction({
              contactKey,
              email,
              date,
              module,
              resolved,
              called: contactActions[contactKey]?.called ?? false,
              emailed: contactActions[contactKey]?.emailed ?? false,
              note: note ?? contactActions[contactKey]?.note ?? "",
            });
          }}
        />
      </div>
    </AppLayout>
  );
}
