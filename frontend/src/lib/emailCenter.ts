import type { UiCoach } from "@/lib/adapters/kbcToUi";

type AnyObj = Record<string, any>;

export type EmailRecipient = {
  learnerName: string;
  learnerEmail: string;
  programme?: string;
  coachName?: string;
  coachEmail?: string;
  lastSessionDate?: string;
  senderName?: string;
  lineManagerEmail?: string;
  hrEmail?: string;
  status?: string;
  riskCategories: string[];
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

  if (Array.isArray(student?.riskCategories)) {
    return student.riskCategories.filter(Boolean).map(String);
  }

  if (
    student?.missedSession === true ||
    student?.attendanceRisk === "missed-session" ||
    student?.kpiCategory === "missed-session"
  ) {
    risks.push("missed-session");
  }

  if (
    student?.reviewDue === true ||
    student?.progressReviewDue === true ||
    student?.kpiCategory === "review-due"
  ) {
    risks.push("review-due");
  }

  if (
    student?.coachingDue === true ||
    student?.monthlyCoachingDue === true ||
    student?.kpiCategory === "coaching-due"
  ) {
    risks.push("coaching-due");
  }

  if (
    student?.otjBehind === true ||
    student?.otjStatus === "Behind" ||
    student?.kpiCategory === "otj-behind"
  ) {
    risks.push("otj-behind");
  }

  return [...new Set(risks)];
}

function buildFromStudents(coach: UiCoach): EmailRecipient[] {
  const c = coach as AnyObj;
  const students = safeArray<AnyObj>(c?.students);

  return students.map((s) => ({
    learnerName: pickFirst(s, ["FullName", "fullName", "customerName", "name"]),
    learnerEmail: pickFirst(s, ["Email", "email", "matched_student_email"]),
    programme: pickFirst(s, ["programme", "Program", "module", "Group"]),
    coachName: pickFirst(c, ["case_owner", "coachName", "name"]),
    coachEmail: pickFirst(c, ["OwnerEmail", "coachEmail", "email"]),
    lastSessionDate: pickFirst(s, ["lastSessionDate"], pickFirst(c, ["last_sub_date"])),
    lineManagerEmail: pickFirst(s, ["lineManagerEmail", "managerEmail"]),
    hrEmail: pickFirst(s, ["hrEmail", "HRManagerEmail"]),
    status: pickFirst(s, ["status"], "Active"),
    riskCategories: getRiskCategories(s),
  }));
}

function buildFromLearnersJson(coach: UiCoach): EmailRecipient[] {
  const c = coach as AnyObj;
  const learners = safeArray<AnyObj>(c?.learners_json);

  return learners.map((l) => ({
    learnerName: pickFirst(l, ["FullName", "fullName", "customerName", "name"]),
    learnerEmail: pickFirst(l, ["Email", "email", "matched_student_email"]),
    programme: pickFirst(l, ["programme", "Program", "module", "Group"]),
    coachName: pickFirst(c, ["case_owner", "coachName", "name"]),
    coachEmail: pickFirst(c, ["OwnerEmail", "coachEmail", "email"]),
    lastSessionDate: pickFirst(l, ["lastSessionDate"], pickFirst(c, ["last_sub_date"])),
    lineManagerEmail: pickFirst(l, ["lineManagerEmail", "managerEmail"]),
    hrEmail: pickFirst(l, ["hrEmail", "HRManagerEmail"]),
    status: pickFirst(l, ["status"], "Active"),
    riskCategories: getRiskCategories(l),
  }));
}

function buildFromAttendance(coach: UiCoach): EmailRecipient[] {
  const c = coach as AnyObj;
  const learners = safeArray<AnyObj>(c?.attendance?.learners);

  return learners.map((l) => ({
    learnerName: pickFirst(l, ["FullName", "fullName", "customerName", "name"]),
    learnerEmail: pickFirst(l, ["Email", "email"]),
    programme: pickFirst(l, ["programme", "Program", "module", "Group"]),
    coachName: pickFirst(c, ["case_owner", "coachName", "name"]),
    coachEmail: pickFirst(c, ["OwnerEmail", "coachEmail", "email"]),
    lastSessionDate: pickFirst(c, ["last_sub_date"]),
    lineManagerEmail: pickFirst(l, ["lineManagerEmail", "managerEmail"]),
    hrEmail: pickFirst(l, ["hrEmail", "HRManagerEmail"]),
    status: "Active",
    riskCategories: getRiskCategories(l),
  }));
}

export function buildEmailRecipients(coaches: UiCoach[]): EmailRecipient[] {
  const all = coaches.flatMap((coach) => {
    const fromStudents = buildFromStudents(coach);
    const fromLearnersJson = buildFromLearnersJson(coach);
    const fromAttendance = buildFromAttendance(coach);

    return [...fromStudents, ...fromLearnersJson, ...fromAttendance];
  });

  const map = new Map<string, EmailRecipient>();

  for (const item of all) {
    const email = String(item.learnerEmail || "").trim().toLowerCase();
    if (!email) continue;

    if (!map.has(email)) {
      map.set(email, {
        ...item,
        learnerEmail: email,
      });
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

  return Array.from(map.values());
}

export function renderTemplate(template: string, data: Record<string, any>) {
  return String(template || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const value = data[key];
    return value === undefined || value === null ? "" : String(value);
  });
}