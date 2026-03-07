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
  "otj-behind": "border-l-[var(--kpi-otj)]",
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

      // Bookings index per coach row
      console.log("RAW BOOKING COLUMNS", {
        PR: raw?.booked_students_PR,
        MCM: raw?.booked_students_MCM,
        StSu: raw?.booked_students_StSupport,
      });

      const bookedIndex = buildBookedIndex(raw);

      console.log("BOOKED INDEX", bookedIndex);

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
        const monthlyCoachingBooked =
          (emailKey && bookedIndex.byEmail.has(emailKey)) ||
          (id && bookedIndex.byId.has(id)) ||
          false;

        const monthlyCoachingHasData = bookedIndex.count > 0;

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

        (learner as any).__reviewFlag = reviewFlag;
        (learner as any).__reviewOverdue = reviewFlag === "overdue";

        out.push(learner);
      }
    }

    return out.filter((l) => l.status === "Active");
  }, [filteredRows]);

  const kpiCards = useMemo<KpiCardData[]>(() => {
    const total = activeLearners.length;

    const missed = activeLearners.filter((l) => (l.missedInRow ?? 0) >= 2 || (l.absenceRatio ?? 0) >= 25).length;

    const reviewDue = activeLearners.filter((l) => (l as any).__reviewFlag && (l as any).__reviewFlag !== "none").length;

    // Only count coaching-due when we have booking data to compare
    const coachingDue = activeLearners.filter((l) => {
      const hasData = Boolean((l as any).monthlyCoachingHasData);
      const booked = Boolean((l as any).monthlyCoachingBooked);
      return hasData && !booked;
    }).length;

    const otjBehind = activeLearners.filter((l) => Number((l as any).otjBehindBy ?? 0) > 0).length;

    const mk = (id: KpiCategory, title: string, count: number): KpiCardData =>
    ({
      id,
      title,
      count,
      total,
      percentage: total ? Math.round((count / total) * 100) : 0,
      trend: 0,
      accentClass: kpiAccentClass[id],
    } as KpiCardData);

    return [
      mk("missed-session", "Missed Session", missed),
      mk("review-due", "Review Due", reviewDue),
      mk("coaching-due", "Monthly Coaching Due - Not Booked", coachingDue),
      mk("otj-behind", "OTJ Behind", otjBehind),
    ];
  }, [activeLearners]);

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

    if (activeKpi === "otj-behind") {
      return activeLearners
        .filter((l) => Number((l as any).otjBehindBy ?? 0) > 0)
        .sort((a, b) => Number((b as any).otjBehindBy ?? 0) - Number((a as any).otjBehindBy ?? 0));
    }

    return [];
  }, [activeLearners, activeKpi]);

  return (
    <AppLayout>
      <GlobalFilters rows={rows} loading={loading} filters={filters} onChange={setFilters} onRefresh={load} />

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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

        {activeKpi && (
          <div>
            <h3 className="text-base font-semibold text-foreground mb-3">
              {kpiCards.find((c) => c.id === activeKpi)?.title} , {filteredLearners.length} learner
              {filteredLearners.length !== 1 ? "s" : ""}
            </h3>

            <LearnerTable learners={filteredLearners} kpiCategory={activeKpi} onSelectLearner={setSelectedLearner} />
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