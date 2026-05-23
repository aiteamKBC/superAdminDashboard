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

  const end = endOfDay(new Date(today));
  end.setDate(end.getDate() - weekIndex * 7);

  const start = startOfDay(new Date(end));
  start.setDate(start.getDate() - 6);

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
  return `${formatUiDate(start)} → ${formatUiDate(end)}`;
};

const kpiAccentClass: Record<KpiCategory, string> = {
  "missed-session": "border-l-4 border-l-[#80560F]",
  "review-due": "border-l-4 border-l-[#866CB6]",
  "review-booked": "border-l-4 border-l-[#b27715]",
  "coaching-due": "border-l-4 border-l-[#644D93]",
  "coaching-booked": "border-l-4 border-l-[#A88CD9]",
  "otj-behind": "border-l-4 border-l-[#B27715]",
  "coach-marking-overdue": "border-l-4 border-l-[#866CB6]",
};

const getPrMonthRange = (offset: number) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const getPrMonthLabel = (offset: number) => {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
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

const isTodayOrFuture = (value: unknown) => {
  const dt = parseBookedDate(value);
  if (!dt) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return dt.getTime() >= today.getTime();
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
      "Total Evidence",
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
          <p className="text-xs font-medium text-[#808080]">Total Evidence</p>
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
                <th className="text-left p-3 font-medium text-[#808080]">Coach Name</th>
                <th className="text-right p-3 font-medium text-[#808080]">Total Evidence</th>
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
                    <td className="p-3 font-medium text-[#4C4C4C]">{row.coachName}</td>
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
                  <td className="p-3 font-bold text-[#4C4C4C]">TOTAL</td>
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

export default function Dashboard() {
  const [rows, setRows] = useState<UiCoach[]>([]);
  const [loading, setLoading] = useState(true);
  const [absenceWeeks, setAbsenceWeeks] = useState<"all" | 0 | 1 | 2 | 3>(0);
  const [prMonthOffset, setPrMonthOffset] = useState(0);

  // PR
  const [progressReviewRows, setProgressReviewRows] = useState<ProgressReviewSummaryRow[]>([]);
  const [prBookedData, setPrBookedData] = useState<any[]>([]);

  const [filters, setFilters] = useState<DashboardFilters>({
    coach: "All Coaches",
    rating: "All Ratings",
    programme: "All Programmes",
    risk: "All",
    organisation: "All Organizations",
    status: "All Statuses",
  });

  const [activeKpi, setActiveKpi] = useState<KpiCategory | null>(null);
  const [selectedLearner, setSelectedLearner] = useState<Learner | null>(null);
  const [bookedSessionTypeFilter, setBookedSessionTypeFilter] = useState<
    "All Session Types" | "Progress Review" | "MCM" | "Support Session"
  >("All Session Types");

  const [contactActions, setContactActions] = useState<Record<string, ContactActionState>>({});

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

  const filteredRows = useMemo(() => applyDashboardFilters(rows, filters), [rows, filters]);

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

        const attRec =
          (id && attById.get(id)) ||
          (emailKey && attByEmail.get(emailKey)) ||
          attLearners.find((a: any) =>
            sameLooseName(a?.FullName || a?.fullName || a?.name, fullName)
          ) ||
          null;

        const metrics = buildAttendanceMetrics(attRec?.Attendance, absenceWeeks);

        let priority: Learner["priority"] = priorityFromAttendance(metrics.missedInRow);
        const riskCategories: KpiCategory[] = riskCatsFromAttendance(
          metrics.missedInRow,
          metrics.absenceRatio
        );

        const reviewRow =
          (id && prIndex.byId.get(id)) ||
          (emailKey && prIndex.byEmail.get(emailKey)) ||
          (emailKey && prIndex.byEmailLocal.get(getEmailLocalPart(emailKey))) ||
          (fullName && prIndex.byName.get(normName(fullName))) ||
          findBestProgressReviewMatch(
            {
              id,
              email: emailKey,
              fullName,
            },
            prIndex.rows
          ) ||
          null;

        if (!reviewRow) {
          console.log("PR NO MATCH", {
            learnerId: id,
            learnerEmail: emailKey,
            learnerName: fullName,
          });
        } else {
          console.log("PR MATCH OK", {
            learnerId: id,
            reviewId: reviewRow?.id,
            learnerEmail: emailKey,
            reviewEmail: reviewRow?.email,
            learnerName: fullName,
            reviewName: reviewRow?.fullName,
            nextReviewStatus: reviewRow?.nextReviewStatus,
            overduePrCount: reviewRow?.overduePrCount,
          });
        }

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

        const learnerStatusRaw = pickFirstString(s as any, [
          "Program-Status",
          "Program Status",
          "program_status",
          "Status",
          "status",
        ]);

        const INACTIVE_STATUSES = new Set([
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
        ]);
        const learnerStatus: Learner["status"] =
          INACTIVE_STATUSES.has(learnerStatusRaw) ? "Withdrawn" : "Active";

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

        const anyBookedMeta = getLearnerBookedMeta(raw, s, id, emailKey, fullName);
        const mcmBookedMeta = getLearnerBookedMetaByType(raw, s, id, emailKey, fullName, "MCM");
        const prBookedMeta = getLearnerBookedMetaByType(
          raw,
          s,
          id,
          emailKey,
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
            bookingMatchesLearner(student, id, emailKey, learnerNameNormForBooking)
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
          emailKey,
          fullName,
          "Support Session"
        );

        const monthlyCoachingBooked = mcmBookedMeta.booked;
        const monthlyCoachingHasData = mcmBookedMeta.hasData;

        if (monthlyCoachingHasData && !monthlyCoachingBooked) {
          if (!riskCategories.includes("coaching-due")) riskCategories.push("coaching-due");
          if (priority === "normal") priority = "high";
        }

        const latestAttendanceModule = getLatestAttendanceModule(attRec?.Attendance);

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
        const lastMonthlyMeetingDate = getLastCompletedSessionDate(attRec?.Attendance);
        const progressReviewBooked = prBookedMeta.booked;

        const attendanceEmail = normEmail(attRec?.Email || emailKey);
        const attendanceDate = metrics.lastSessionDate || "";
        const attendanceModule = latestAttendanceModule || "";
        const attendanceContactKey = `${attendanceEmail}||${attendanceDate}||${attendanceModule}`;

        const learner = {
          id: id || emailKey || `${coach.id}:${fullName}`,
          firstName,
          lastName,
          organisation: organisation || "Unknown",
          programme: programme || metrics.latestProgramme || "Unknown",
          coach: coach.name,
          email: emailKey ? emailKey : "Unknown",
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

        const matchesLearnerProgramme =
          filters.programme === "All Programmes" ||
          matchesAnyExactFilterValue([latestAttendanceModule], filters.programme);

        const matchesLearnerOrganisation =
          filters.organisation === "All Organizations" ||
          matchesAnyExactFilterValue([organisation], filters.organisation);

        const matchesLearnerStatus =
          filters.status === "All Statuses" ||
          matchesAnyExactFilterValue([learnerStatus], filters.status);

        if (!matchesLearnerProgramme || !matchesLearnerOrganisation || !matchesLearnerStatus) {
          continue;
        }

        out.push(learner);
      }
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

    return Array.from(deduped.values()).filter((l) => l.status === "Active");
  }, [filteredRows, absenceWeeks, filters, progressReviewIndex]);

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
      (l) =>
        Boolean((l as any).hasAttendanceInWindow) &&
        l.lastSessionStatus === "Missed"
    ).length;

    const dueEmails = new Set(
      progressReviewRows
        .filter((row: any) => Number(row.overduePrCount ?? 0) > 0)
        .map((row: any) => normEmail(row.email))
    );
    const reviewDue = activeLearners.filter((l) => dueEmails.has(normEmail(l.email))).length;

    const { start: prStart, end: prEnd } = getPrMonthRange(prMonthOffset);
    const bookedInMonthEmails = new Set(
      prBookedData
        .filter((row) =>
          (row.bookedDates || []).some((d: any) => {
            const dt = parseBookedDate(d.date);
            return dt !== null && dt >= prStart && dt <= prEnd;
          })
        )
        .map((row) => normEmail(row.email))
    );
    const reviewBooked = activeLearners.filter((l) =>
      bookedInMonthEmails.has(normEmail(l.email))
    ).length;

    const coachingDue = activeLearners.filter((l) => {
      const hasData = Boolean((l as any).monthlyCoachingHasData);
      const booked = Boolean((l as any).monthlyCoachingBooked);
      return hasData && !booked;
    }).length;

    const coachingBookedRows = buildBookedLearnerRows(
      activeLearners,
      bookedSessionTypeFilter
    );

    const coachingBooked = coachingBookedRows.length;

    const otjBehind = activeLearners.filter((l) => Boolean((l as any).hasOtjBehind)).length;

    const coachMarkingOverdue = coachMarkingRows.filter((r) => r.totalOverdue > 0).length;
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
      }) as KpiCardData;

    return [
      mk("missed-session", "Missed Session", missed),
      mk("review-due", "Progress Review Due", reviewDue),
      mk("review-booked", "Progress Review Booked", reviewBooked),
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
  }, [activeLearners, coachMarkingRows, activeKpi, bookedSessionTypeFilter, filteredRows.length, prMonthOffset, prBookedData, progressReviewRows]);

  const filteredLearners = useMemo(() => {
    if (!activeKpi) return [];

    let result: Learner[] = [];

    if (activeKpi === "missed-session") {
      result = activeLearners.filter(
        (l) =>
          Boolean((l as any).hasAttendanceInWindow) &&
          l.lastSessionStatus === "Missed"
      );
    } else if (activeKpi === "review-due") {
      const dueByEmail = new Map<string, any>(
        progressReviewRows
          .filter((row: any) => Number(row.overduePrCount ?? 0) > 0)
          .map((row: any) => [normEmail(row.email), row])
      );
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
    } else if (activeKpi === "review-booked") {
      const { start: prStart, end: prEnd } = getPrMonthRange(prMonthOffset);

      const bookedByEmail = new Map<string, string>();
      for (const row of prBookedData) {
        const email = normEmail(row.email);
        if (!email) continue;
        const matchDate = (row.bookedDates || []).find((d: any) => {
          const dt = parseBookedDate(d.date);
          return dt !== null && dt >= prStart && dt <= prEnd;
        });
        if (matchDate && !bookedByEmail.has(email)) {
          bookedByEmail.set(email, matchDate.date);
        }
      }

      result = activeLearners
        .filter((l) => bookedByEmail.has(normEmail(l.email)))
        .map((l) => ({
          ...l,
          bookedPrDate: bookedByEmail.get(normEmail(l.email)) || "",
        } as typeof l))
        .sort((a, b) => {
          const aDate = String((a as any).bookedPrDate || "");
          const bDate = String((b as any).bookedPrDate || "");
          return aDate.localeCompare(bDate);
        });
    } else if (activeKpi === "coaching-due") {
      result = activeLearners
        .filter(
          (l) =>
            Boolean((l as any).monthlyCoachingHasData) &&
            !Boolean((l as any).monthlyCoachingBooked)
        )
        .sort((a, b) => (a.coach || "").localeCompare(b.coach || ""));
    } else if (activeKpi === "coaching-booked") {
      result = buildBookedLearnerRows(activeLearners, bookedSessionTypeFilter);
    } else if (activeKpi === "otj-behind") {
      result = activeLearners
        .filter((l) => Boolean((l as any).hasOtjBehind))
        .sort(
          (a, b) =>
            Number((b as any).otjBehindPct ?? 0) -
            Number((a as any).otjBehindPct ?? 0)
        );
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
  }, [activeLearners, activeKpi, bookedSessionTypeFilter, contactActions, prMonthOffset, prBookedData, progressReviewRows]);

  useEffect(() => {
    setSelectedLearner((prev) => {
      if (!prev) return prev;
      const updated = filteredLearners.find((l) => l.id === prev.id);
      return updated ?? prev;
    });
  }, [filteredLearners]);

  return (
    <AppLayout>
      <div className="min-h-screen bg-[#F8F8F8] text-[#4C4C4C]">
        <div className="border-b border-[#E4E4E4] bg-white">
          <GlobalFilters
            rows={rows}
            loading={loading}
            filters={filters}
            onChange={setFilters}
            onRefresh={load}
            showPrMonthFilter={activeKpi === "review-booked"}
            prMonthOffset={prMonthOffset}
            onPrMonthOffsetChange={setPrMonthOffset}
            getPrMonthLabel={getPrMonthLabel}
          />
        </div>

        <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4 items-stretch">
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
            <div className="rounded-2xl border border-[#E4E4E4] bg-white p-4 sm:p-5 shadow-sm">
              <h3 className="mb-4 text-base sm:text-lg font-semibold text-[#4C4C4C]">
                {kpiCards.find((c) => c.id === activeKpi)?.title} , {coachMarkingRows.length} coach
                {coachMarkingRows.length !== 1 ? "es" : ""}
              </h3>

              <CoachMarkingTable rows={coachMarkingRows} />
            </div>
          )}

          {activeKpi && activeKpi !== "coach-marking-overdue" && (
            <div className="rounded-2xl border border-[#E4E4E4] bg-white p-4 sm:p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
                <h3 className="text-base sm:text-lg font-semibold text-[#4C4C4C]">
                  {kpiCards.find((c) => c.id === activeKpi)?.title} , {filteredLearners.length} learner
                  {filteredLearners.length !== 1 ? "s" : ""}
                </h3>

                {activeKpi === "missed-session" && (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <span className="text-sm text-[#808080]">Absence Window</span>
                    <select
                      value={absenceWeeks}
                      onChange={(e) => {
                        const v = e.target.value;
                        setAbsenceWeeks(v === "all" ? "all" : (Number(v) as 0 | 1 | 2 | 3));
                      }}
                      className="h-10 w-full sm:w-auto rounded-xl border border-[#E4E4E4] bg-white px-3 text-sm text-[#4C4C4C]"
                    >
                      <option value="all">All</option>
                      <option value={0}>This week , {getWeekLabel(0)}</option>
                      <option value={1}>Previous week , {getWeekLabel(1)}</option>
                      <option value={2}>2 weeks ago , {getWeekLabel(2)}</option>
                      <option value={3}>3 weeks ago , {getWeekLabel(3)}</option>
                    </select>
                  </div>
                )}

              </div>

              <div className="overflow-hidden rounded-2xl border border-[#E4E4E4] bg-white">
                <LearnerTable
                  key={`${activeKpi}-${bookedSessionTypeFilter}-${absenceWeeks}`}
                  learners={filteredLearners}
                  kpiCategory={activeKpi}
                  onSelectLearner={setSelectedLearner}
                  sessionTypeFilter={bookedSessionTypeFilter}
                  onSessionTypeFilterChange={setBookedSessionTypeFilter}
                  onUpdateContactAction={updateContactAction}
                />
              </div>
            </div>
          )}

          {!activeKpi && (
            <div className="rounded-2xl border border-dashed border-[#E4E4E4] bg-white px-4 py-12 sm:px-6 sm:py-16 text-center shadow-sm">
              <p className="text-base sm:text-lg font-medium text-[#4C4C4C]">
                Click a KPI card above to view learners requiring action
              </p>
              <p className="mt-1 text-sm text-[#808080]">
                Select a risk category to see the detailed learner list
              </p>
            </div>
          )}
        </div>

        <LearnerDrawer
          learner={selectedLearner}
          open={!!selectedLearner}
          onClose={() => setSelectedLearner(null)}
          onUpdateContactAction={updateContactAction}
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