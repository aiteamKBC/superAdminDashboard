import type { UiCoach } from "@/lib/adapters/kbcToUi";
import type { EmailRecipient } from "@/lib/emailCenter";

type AnyObj = Record<string, any>;
type AbsenceWeeksFilter = "all" | 0 | 1 | 2 | 3;
type AttendanceSession = { value?: number; module?: string };

function cleanEmail(email?: string) {
  return String(email || "")
    .replace(/[\u202A-\u202E]/g, "")
    .trim()
    .toLowerCase();
}

function getCoachEmail(coach: UiCoach) {
  return cleanEmail((coach as any)?.raw?.OwnerEmail);
}

function parseAttendanceDate(raw: string): Date | null {
  const s = String(raw || "").trim();
  if (!s) return null;

  const match = s.match(/^(\d{4})[-/\s](\d{2})[-/\s](\d{2})/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const dt = new Date(year, month - 1, day);
  if (Number.isNaN(dt.getTime())) return null;

  dt.setHours(0, 0, 0, 0);
  return dt;
}

function formatDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function getExactWeekRange(weekIndex: 0 | 1 | 2 | 3) {
  const today = new Date();
  const day = today.getDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;

  const start = startOfDay(new Date(today));
  start.setDate(today.getDate() - daysSinceMonday - weekIndex * 7);

  const end = endOfDay(new Date(start));
  end.setDate(start.getDate() + 6);

  return { start, end };
}

function isDateInExactWeekBucket(date: Date, weekIndex: 0 | 1 | 2 | 3) {
  const { start, end } = getExactWeekRange(weekIndex);
  return date >= start && date <= end;
}

function parseProgrammeFromModule(moduleStr?: string) {
  const s = String(moduleStr || "").trim();
  if (!s) return "";

  const parts = s
    .split(" - ")
    .map((x) => x.trim())
    .filter(Boolean);

  return parts.length ? parts[parts.length - 1] : s;
}

function normalizeAttendanceEntries(
  attendance: Record<string, AttendanceSession | AttendanceSession[]>
) {
  return Object.entries(attendance || {})
    .flatMap(([rawKey, rawValue]) => {
      const parsed = parseAttendanceDate(rawKey);
      if (!parsed) return [];

      const values = Array.isArray(rawValue)
        ? rawValue
        : rawValue && typeof rawValue === "object"
          ? [rawValue]
          : [];

      return values.map((value, index) => ({
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

export function getMissedLearnersFromCoaches(
  coaches: UiCoach[],
  absenceWeeks: AbsenceWeeksFilter = 0
): EmailRecipient[] {
  const recipients: EmailRecipient[] = [];
  const seen = new Set<string>();

  for (const coach of coaches) {
    const raw = coach.raw as AnyObj;
    const learners = Array.isArray(raw?.attendance?.learners) ? raw.attendance.learners : [];

    for (const learner of learners) {
      const learnerEmail = cleanEmail(learner?.Email);
      if (!learnerEmail) continue;

      const attendance = learner?.Attendance || {};
      const allEntries = normalizeAttendanceEntries(attendance);

      if (!allEntries.length) continue;

      const filteredEntries =
        absenceWeeks === "all"
          ? allEntries
          : allEntries.filter((entry) => isDateInExactWeekBucket(entry.parsed, absenceWeeks));

      const hasAttendanceInWindow = filteredEntries.length > 0;
      if (!hasAttendanceInWindow) continue;

      const lastEntry = filteredEntries[filteredEntries.length - 1] || null;

      const lastSessionStatus: "Attended" | "Missed" | "Unknown" =
        lastEntry?.value?.value == null
          ? "Unknown"
          : Number(lastEntry.value.value) === 1
            ? "Attended"
            : "Missed";

      if (lastSessionStatus !== "Missed") continue;

      if (seen.has(learnerEmail)) continue;
      seen.add(learnerEmail);

      recipients.push({
        learnerName: String(learner?.FullName || "Unknown").trim(),
        learnerEmail,
        programme: parseProgrammeFromModule(lastEntry?.value?.module),
        coachName: coach.name,
        coachEmail: getCoachEmail(coach),
        lastSessionDate: lastEntry?.normalizedDate || "",
        status: "Active",
        riskCategories: ["missed-session"],
        hasAttendanceInWindow,
        lastSessionStatus,
      });
    }
  }

  return recipients;
}
