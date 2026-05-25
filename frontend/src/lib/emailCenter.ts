import type { UiCoach } from "@/lib/adapters/kbcToUi";

type AnyObj = Record<string, any>;

export interface EmailRecipient {
  learnerName: string;
  learnerEmail: string;
  programme: string;
  coachName: string;
  coachEmail: string;
  lastSessionDate?: string;
  status?: string;
  riskCategories?: string[];

  hasAttendanceInWindow?: boolean;
  lastSessionStatus?: "Attended" | "Missed" | "Unknown";

  lineManagerEmail?: string;
  hrEmail?: string;

  dueDate?: string;
  bookingLink?: string;
  lineManagerName?: string;
  expectedHours?: string;
  actualHours?: string;
  behindPercent?: string;
}

type AttendanceSession = {
  value?: number;
  module?: string;
};

function safeArray<T = any>(value: any): T[] {
  if (Array.isArray(value)) return value;

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function cleanEmail(email?: string) {
  if (!email) return "";
  return String(email)
    .replace(/[\u202A-\u202E]/g, "")
    .trim()
    .toLowerCase();
}

function pickFirst(obj: AnyObj, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return fallback;
}

function getRiskCategories(student: AnyObj): string[] {
  const risks: string[] = [];

  const missedInRow =
    Number(student?.MissedInRow) ||
    Number(student?.missedInRow) ||
    Number(student?.missed_sessions) ||
    0;

  if (missedInRow >= 1) risks.push("missed-session");

  if (student?.reviewDue === true || student?.progressReviewDue === true) {
    risks.push("review-due");
  }

  if (student?.coachingDue === true || student?.monthlyCoachingDue === true) {
    risks.push("coaching-due");
  }

  if (student?.otjBehind === true || student?.otjStatus === "Behind") {
    risks.push("otj-behind");
  }

  return [...new Set(risks)];
}

function normalizeAttendanceEntries(attendance: Record<string, AttendanceSession | AttendanceSession[]>) {
  return Object.entries(attendance || {}).flatMap(([date, rawValue]) => {
    const values = Array.isArray(rawValue)
      ? rawValue
      : rawValue && typeof rawValue === "object"
        ? [rawValue]
        : [];

    return values.map((value) => ({
      date,
      value: value || {},
    }));
  });
}

function buildFromStudents(coach: UiCoach): EmailRecipient[] {
  const c = coach as AnyObj;
  const students = safeArray<AnyObj>(c?.students);

  return students.map((s) => ({
    learnerName: pickFirst(s, ["FullName", "fullName", "customerName", "name"]),
    learnerEmail: cleanEmail(pickFirst(s, ["Email", "email", "matched_student_email"])),
    programme: pickFirst(s, ["programme", "Program", "module", "Group"]),
    coachName: pickFirst(c, ["case_owner", "coachName", "name"]),
    coachEmail: cleanEmail(pickFirst(c, ["OwnerEmail", "coachEmail", "email"])),
    lastSessionDate: pickFirst(s, ["lastSessionDate"], pickFirst(c, ["last_sub_date"])),
    lineManagerEmail: cleanEmail(pickFirst(s, ["lineManagerEmail", "managerEmail"])),
    hrEmail: cleanEmail(pickFirst(s, ["hrEmail", "HRManagerEmail"])),
    status: pickFirst(s, ["status"], "Active"),
    riskCategories: getRiskCategories(s),
  }));
}

function buildFromLearnersJson(coach: UiCoach): EmailRecipient[] {
  const c = coach as AnyObj;
  const learners = safeArray<AnyObj>(c?.learners_json);

  return learners.map((l) => ({
    learnerName: pickFirst(l, ["FullName", "fullName", "customerName", "name"]),
    learnerEmail: cleanEmail(pickFirst(l, ["Email", "email", "matched_student_email"])),
    programme: pickFirst(l, ["programme", "Program", "module", "Group"]),
    coachName: pickFirst(c, ["case_owner", "coachName", "name"]),
    coachEmail: cleanEmail(pickFirst(c, ["OwnerEmail", "coachEmail", "email"])),
    lastSessionDate: pickFirst(l, ["lastSessionDate"], pickFirst(c, ["last_sub_date"])),
    lineManagerEmail: cleanEmail(pickFirst(l, ["lineManagerEmail", "managerEmail"])),
    hrEmail: cleanEmail(pickFirst(l, ["hrEmail", "HRManagerEmail"])),
    status: pickFirst(l, ["status"], "Active"),
    riskCategories: getRiskCategories(l),
  }));
}

function buildFromAttendance(coach: UiCoach): EmailRecipient[] {
  const c = coach as AnyObj;
  const learners = safeArray<AnyObj>(c?.attendance?.learners);

  return learners.map((l) => {
    const attendance = l?.Attendance || {};
    const sessions = normalizeAttendanceEntries(attendance);

    const missedCount = sessions.filter((s) => Number(s?.value?.value) === 0).length;

    const lastEntry = sessions.length ? sessions[sessions.length - 1] : null;
    const lastSessionStatus =
      lastEntry?.value?.value == null
        ? "Unknown"
        : Number(lastEntry.value.value) === 1
          ? "Attended"
          : "Missed";

    const risks: string[] = [];
    if (missedCount > 0) risks.push("missed-session");

    return {
      learnerName: pickFirst(l, ["FullName", "fullName", "customerName", "name"]),
      learnerEmail: cleanEmail(pickFirst(l, ["Email", "email"])),
      programme: pickFirst(l, ["programme", "Program", "module", "Group"]),
      coachName: pickFirst(c, ["case_owner", "coachName", "name"]),
      coachEmail: cleanEmail(pickFirst(c, ["OwnerEmail", "coachEmail", "email"])),
      lastSessionDate: lastEntry?.date || pickFirst(c, ["last_sub_date"]),
      lineManagerEmail: cleanEmail(pickFirst(l, ["lineManagerEmail", "managerEmail"])),
      hrEmail: cleanEmail(pickFirst(l, ["hrEmail", "HRManagerEmail"])),
      status: "Active",
      riskCategories: risks,
      hasAttendanceInWindow: sessions.length > 0,
      lastSessionStatus,
    };
  });
}

export function buildEmailRecipients(coaches: UiCoach[]): EmailRecipient[] {
  const all = coaches.flatMap((coach) => [
    ...buildFromStudents(coach),
    ...buildFromLearnersJson(coach),
    ...buildFromAttendance(coach),
  ]);

  const map = new Map<string, EmailRecipient>();

  for (const item of all) {
    const email = cleanEmail(item.learnerEmail);
    if (!email) continue;

    if (!map.has(email)) {
      map.set(email, { ...item, learnerEmail: email });
      continue;
    }

    const existing = map.get(email)!;

    map.set(email, {
      ...existing,
      ...item,
      learnerEmail: email,
      riskCategories: [
        ...new Set([
          ...(existing.riskCategories || []),
          ...(item.riskCategories || []),
        ]),
      ],
    });
  }

  return Array.from(map.values()).filter(
    (r) => r.riskCategories && r.riskCategories.length > 0
  );
}

export function renderTemplate(template: string, data: Record<string, any>) {
  return String(template || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const value = data[key];
    return value === undefined || value === null ? "" : String(value);
  });
}