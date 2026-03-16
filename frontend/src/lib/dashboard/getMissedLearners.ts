import type { UiCoach } from "@/lib/adapters/kbcToUi";
import type { EmailRecipient } from "@/lib/emailCenter";

type AnyObj = Record<string, any>;

function cleanEmail(email?: string) {
  return String(email || "")
    .replace(/[\u202A-\u202E]/g, "")
    .trim()
    .toLowerCase();
}

export function getMissedLearnersFromCoaches(coaches: UiCoach[]): EmailRecipient[] {
  const recipients: EmailRecipient[] = [];

  for (const coach of coaches) {
    const raw = coach.raw as AnyObj;

    const learners = raw?.attendance?.learners ?? [];

    for (const l of learners) {
      const attendance = l?.Attendance || {};
      const sessions = Object.values(attendance);

      const missedInRow = [...sessions]
        .reverse()
        .reduce((acc: number, s: any) => {
          if (s?.value === 0) return acc + 1;
          if (acc > 0) return acc;
          return 0;
        }, 0);

      if (missedInRow === 0) continue;

      recipients.push({
        learnerName: l?.FullName || "Unknown",
        learnerEmail: cleanEmail(l?.Email),
        programme: "",
        coachName: coach.name,
        coachEmail: cleanEmail(coach.email),
        lastSessionDate: "",
        status: "Active",
        riskCategories: ["missed-session"],
      });
    }
  }

  return recipients;
}