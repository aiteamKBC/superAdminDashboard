import { Coordinator, CoordinatorPerformance, LearnerAssignment } from "@/types/admin";
import { KpiCategory, Learner } from "@/types/dashboard";

type ContactLogRow = Record<string, any>;

type LmsLearnerRow = {
  id: number;
  fullName: string;
  email: string;
  phone: string;
  programStatus: string;
  current: boolean;
  coach: string;
  coachEmail: string;
  programme: string;
  cohort: string;
  group: string;
  organisation: string;
  managerName: string;
  plannedOtjHours: number;
  targetOtjHours: number;
  completedOtjHours: number;
  otjhStatus: string;
  startDate: string;
  endDate: string;
  lastProgressReviewDate: string;
  nextProgressReviewDue: string;
  progressReviewBooked: boolean;
  lastMonthlyMeetingDate: string;
  nextMonthlyMeetingDue: string;
  monthlyMeetingBooked: boolean;
  lastSessionStatus: string;
  lastSessionDate: string;
  missedLast10Weeks: number;
};

type LmsAdminResponse = {
  asOf: string;
  learners: LmsLearnerRow[];
  totals: { all: number; current: number };
};

export type AdminRealData = {
  totals: { all: number; current: number };
  learners: Learner[];
  coordinators: Coordinator[];
  assignments: LearnerAssignment[];
  performance: CoordinatorPerformance[];
  contactLogs: ContactLogRow[];
  lastContactByLearner: Record<string, string | null>;
  nextFollowUpByLearner: Record<string, string | null>;
};

export type AdminPerformanceRange = "today" | "7days" | "30days";

const kpiKeys: KpiCategory[] = ["missed-session", "review-due", "coaching-due", "otj-behind"];

const normEmail = (value: unknown) => String(value || "").trim().toLowerCase();
const normName = (value: unknown) => String(value || "").trim().replace(/\s+/g, " ");

const splitName = (fullName: string) => {
  const parts = normName(fullName).split(" ").filter(Boolean);
  if (!parts.length) return { firstName: "Unknown", lastName: "Learner" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ") || "",
  };
};

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "unassigned";

const dateOnly = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  return d.toISOString().slice(0, 10);
};

const addDays = (dateString: string | null, days: number) => {
  if (!dateString) return null;
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const fetchJson = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  return res.json();
};

const emptyBreakdown = (): Record<KpiCategory, number> =>
  ({
    "missed-session": 0,
    "review-due": 0,
    "review-booked": 0,
    "coaching-due": 0,
    "coaching-booked": 0,
    "otj-behind": 0,
    "coach-marking-overdue": 0,
    "status-view": 0,
  });

const isLogInRange = (createdAt: unknown, dateRange: AdminPerformanceRange) => {
  const created = new Date(String(createdAt || ""));
  if (Number.isNaN(created.getTime())) return false;

  const now = new Date();
  const start = new Date(now);

  if (dateRange === "today") {
    start.setHours(0, 0, 0, 0);
  } else if (dateRange === "7days") {
    start.setDate(now.getDate() - 6);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(now.getDate() - 29);
    start.setHours(0, 0, 0, 0);
  }

  return created >= start && created <= now;
};

export const buildAdminPerformance = (
  coordinators: Coordinator[],
  learners: Learner[],
  assignments: LearnerAssignment[],
  contactLogs: ContactLogRow[],
  dateRange: AdminPerformanceRange = "7days"
): CoordinatorPerformance[] => {
  const assignmentByLearner = new Map(assignments.map((a) => [a.learnerId, a.coordinatorId]));
  const learnersByCoordinator = new Map<string, Learner[]>();
  const logsInRange = contactLogs.filter((log) => isLogInRange(log.createdAt, dateRange));

  for (const learner of learners) {
    const coordId = assignmentByLearner.get(learner.id) || "coord-unassigned";
    const list = learnersByCoordinator.get(coordId) || [];
    list.push(learner);
    learnersByCoordinator.set(coordId, list);
  }

  return coordinators.filter((c) => c.active).map((coord) => {
    const assigned = learnersByCoordinator.get(coord.id) || [];
    const assignedEmails = new Set(assigned.map((learner) => normEmail(learner.email)));
    const coordLogs = logsInRange.filter((log) => assignedEmails.has(normEmail(log.learnerEmail)));

    const callsMade = coordLogs.filter((log) => String(log.actionType || "").toLowerCase().includes("call")).length;
    const emailsSent = coordLogs.filter((log) => String(log.actionType || "").toLowerCase().includes("email")).length;
    const escalations = coordLogs.filter((log) => String(log.outcome || "").toLowerCase().includes("escalat")).length;
    const appointmentsBooked = coordLogs.filter((log) => String(log.outcome || "").toLowerCase().includes("book")).length;
    const resolutionCount = coordLogs.filter((log) => String(log.outcome || "").toLowerCase().includes("resolved")).length;
    const noAnswer = coordLogs.filter((log) => String(log.outcome || "").toLowerCase().includes("no answer")).length;
    const answeredCalls = Math.max(0, callsMade - noAnswer);

    const health = {
      missedSession: assigned.filter((l) => l.riskCategories.includes("missed-session")).length,
      reviewDue: assigned.filter((l) => l.riskCategories.includes("review-due")).length,
      coachingDue: assigned.filter((l) => l.riskCategories.includes("coaching-due")).length,
      otjBehind: assigned.filter((l) => l.riskCategories.includes("otj-behind")).length,
      highPriority: assigned.filter((l) => l.priority === "high" || l.priority === "critical").length,
    };

    return {
      coordinatorId: coord.id,
      coordinatorName: coord.name,
      assignedCaseload: assigned.length,
      callsMade,
      answeredCalls,
      notAnswered: noAnswer,
      emailsSent,
      escalationsLM: escalations,
      escalationsHR: 0,
      appointmentsBooked,
      resolutionCount,
      resolutionRate: assigned.length ? Math.round((resolutionCount / assigned.length) * 100) : 0,
      slaCompliance: assigned.length
        ? Math.round((new Set(coordLogs.map((log) => normEmail(log.learnerEmail))).size / assigned.length) * 100)
        : 100,
      avgTimeToFirstContact: 0,
      avgTimeToResolution: 0,
      outcomeBreakdown: {
        bookedAppointment: appointmentsBooked,
        emailedDetails: emailsSent,
        escalated: escalations,
        noAnswer,
        other: Math.max(0, coordLogs.length - appointmentsBooked - emailsSent - escalations - noAnswer),
      },
      caseloadHealth: health,
      ageingBuckets: {
        "0-2": 0,
        "3-7": 0,
        "8-14": 0,
        "15+": health.highPriority,
      },
    };
  });
};

export async function loadAdminRealData(): Promise<AdminRealData> {
  const [lms, contactLogs] = await Promise.all([
    fetchJson<LmsAdminResponse>("/api/lms-admin-learners/"),
    fetchJson<ContactLogRow[]>("/api/contact-log/").catch(() => []),
  ]);
  if (!Array.isArray(lms.learners) || !lms.totals) throw new Error("Invalid LMS admin response");
  const latestLogByEmail = new Map<string, ContactLogRow>();

  for (const log of contactLogs) {
    const email = normEmail(log.learnerEmail);
    if (!email) continue;
    const prev = latestLogByEmail.get(email);
    if (!prev || String(log.createdAt || "") > String(prev.createdAt || "")) {
      latestLogByEmail.set(email, log);
    }
  }

  const coordinatorNames = new Set<string>();
  const learners: Learner[] = lms.learners
    .filter((row) => row.current)
    .map((row) => {
      const email = normEmail(row.email);
      const fullName = normName(row.fullName);
      const { firstName, lastName } = splitName(fullName);
      const riskCategories: KpiCategory[] = [];

      if (row.lastSessionStatus === "absent") riskCategories.push("missed-session");
      if (row.nextProgressReviewDue && row.nextProgressReviewDue <= lms.asOf && !row.progressReviewBooked) {
        riskCategories.push("review-due");
      }
      if (row.nextMonthlyMeetingDue && row.nextMonthlyMeetingDue <= lms.asOf && !row.monthlyMeetingBooked) {
        riskCategories.push("coaching-due");
      }
      if (["at risk", "need attention"].includes(row.otjhStatus.trim().toLowerCase())) {
        riskCategories.push("otj-behind");
      }

      const uniqueRisks = [...new Set(riskCategories)];
      const priority: Learner["priority"] =
        uniqueRisks.length >= 3 ? "critical" : uniqueRisks.length >= 2 ? "high" : "normal";
      const coordinatorName = normName(row.coach);
      coordinatorNames.add(coordinatorName);

      return {
        id: String(row.id),
        firstName,
        lastName,
        email,
        phone: row.phone,
        whatsapp: row.phone,
        organisation: row.organisation,
        programme: row.programme || row.group,
        coach: coordinatorName,
        cohort: row.cohort,
        status: row.programStatus.trim().toLowerCase() === "delivery" ? "Delivery" : "Active",
        lineManagerName: row.managerName,
        lineManagerPhone: "",
        lineManagerEmail: "",
        hrManagerName: "",
        hrManagerPhone: "",
        hrManagerEmail: "",
        startDate: row.startDate,
        expectedEndDate: row.endDate,
        plannedOtjHours: row.plannedOtjHours,
        expectedOtjHours: row.targetOtjHours,
        actualOtjHours: row.completedOtjHours,
        lastSessionDate: row.lastSessionDate,
        lastSessionStatus: row.lastSessionStatus === "absent" ? "Missed" : row.lastSessionStatus === "present" ? "Attended" : undefined,
        lastProgressReviewDate: row.lastProgressReviewDate,
        nextProgressReviewDue: row.nextProgressReviewDue,
        progressReviewBooked: row.progressReviewBooked,
        lastMonthlyMeetingDate: row.lastMonthlyMeetingDate,
        nextMonthlyMeetingDue: row.nextMonthlyMeetingDue,
        monthlyMeetingBooked: row.monthlyMeetingBooked,
        absenceRatio: 0,
        missedLast10Weeks: row.missedLast10Weeks,
        missedInRow: row.lastSessionStatus === "absent" ? 1 : 0,
        riskCategories: uniqueRisks,
        priority,
      };
    });

  const sortedCoordinatorNames = [...coordinatorNames].sort((a, b) => a.localeCompare(b));
  const coordinatorIdByName = new Map(sortedCoordinatorNames.map((name) => [name, `coord-${slug(name)}`]));

  const assignments: LearnerAssignment[] = learners.map((learner) => ({
    id: `assign-${learner.id}`,
    learnerId: learner.id,
    coordinatorId: coordinatorIdByName.get(learner.coach) || "coord-unassigned",
    assignedDate: new Date().toISOString().slice(0, 10),
    assignedBy: "system",
  }));

  const coordinators: Coordinator[] = sortedCoordinatorNames.map((name) => {
    const coordLearners = learners.filter((learner) => learner.coach === name);
    const active = coordLearners.length > 0;
    const total = coordLearners.length || 1;
    const breakdown = emptyBreakdown();
    for (const key of kpiKeys) {
      breakdown[key] = Math.round((coordLearners.filter((l) => l.riskCategories.includes(key)).length / total) * 100);
    }
    return {
      id: coordinatorIdByName.get(name) || `coord-${slug(name)}`,
      name,
      email: "",
      role: "LMS Coach",
      active,
      caseloadSize: coordLearners.length,
      workload: coordLearners.length > 80 ? "heavy" : coordLearners.length > 35 ? "normal" : "light",
      kpiBreakdown: breakdown,
    };
  });

  const lastContactByLearner: Record<string, string | null> = {};
  const nextFollowUpByLearner: Record<string, string | null> = {};

  for (const learner of learners) {
    const latest = latestLogByEmail.get(learner.email);
    const lastContact = dateOnly(latest?.createdAt);
    lastContactByLearner[learner.id] = lastContact;
    nextFollowUpByLearner[learner.id] = addDays(lastContact, 7);
  }

  return {
    totals: lms.totals,
    learners,
    coordinators,
    assignments,
    performance: buildAdminPerformance(coordinators, learners, assignments, contactLogs, "7days"),
    contactLogs,
    lastContactByLearner,
    nextFollowUpByLearner,
  };
}
