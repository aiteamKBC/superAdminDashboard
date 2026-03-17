import type { UiCoach } from "@/lib/adapters/kbcToUi";
import type { EmailRecipient } from "@/lib/emailCenter";

type AnyObj = Record<string, any>;

function cleanEmail(email?: string) {
    return String(email || "")
        .replace(/[\u202A-\u202E]/g, "")
        .trim()
        .toLowerCase();
}

function getCoachEmail(coach: UiCoach) {
    return cleanEmail((coach as any)?.raw?.OwnerEmail);
}

export function getMissedLearnersFromCoaches(coaches: UiCoach[]): EmailRecipient[] {
    const recipients: EmailRecipient[] = [];

    for (const coach of coaches) {
        const raw = coach.raw as AnyObj;

        const learners = raw?.attendance?.learners ?? [];

        for (const l of learners) {
            const attendance = l?.Attendance || {};
            type AttendanceSession = { value?: number; module?: string };

            const allSessions = Object.entries(attendance) as [string, AttendanceSession][];

            // آخر 7 أيام فقط
            const oneWeekAgo = new Date();
            oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

            const sessions = allSessions
                .filter(([date]) => new Date(date) >= oneWeekAgo)
                .map(([, session]) => session);
                
            // count missed sessions
            const missedCount = sessions.filter(
                (s: any) => Number(s?.value) === 0
            ).length;

            // missed in row (آخر جلسات)
            const missedInRow: number = [...sessions]
                .reverse()
                .reduce((acc: number, s: any) => {
                    if (Number(s?.value) === 0) return acc + 1;
                    if (acc > 0) return acc;
                    return 0;
                }, 0);

            // absence %
            const absenceRatio =
                sessions.length > 0
                    ? Math.round((missedCount / sessions.length) * 100)
                    : 0;

            // نفس شرط الداشبورد
            if (!(missedInRow >= 2 || absenceRatio >= 25)) continue;

            recipients.push({
                learnerName: l?.FullName || "Unknown",
                learnerEmail: cleanEmail(l?.Email),
                programme: "",
                coachName: coach.name,
                coachEmail: getCoachEmail(coach),
                lastSessionDate: "",
                status: "Active",
                riskCategories: ["missed-session"],
            });
        }
    }

    return recipients;
}