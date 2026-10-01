import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, TrendingUp, X } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import BackButton from "@/components/BackButton";
import FilterSelect from "@/components/FilterSelect";
import { Input } from "@/components/ui/input";

type Tone = "red" | "amber" | "green" | "blue" | "teal" | "slate";

interface PrRow {
  id: number | string;
  fullName: string;
  email: string;
  group?: string;
  caseOwner?: string;
  organisation?: string;
  lastActuallyCompletedPr?: string;
  lastProgressReview?: string;
  duePrDate?: string;
  duePrState?: string;
  nextPrDate?: string;
  nextPrState?: string;
  reviewStatus?: string;
}

interface McrRow {
  id: number | string;
  fullName: string;
  email: string;
  caseOwner?: string;
  programme?: string;
  organisationName?: string;
  lastMcm?: string;
  nextMcm?: string;
  lastActuallyCompletedMcm?: string;
  dueMcmDate?: string | null;
  nextDueDate?: string | null;
  mcrStatus?: string;
  mcmDates?: { date: string; status: string; completed: boolean }[];
}

interface OtjRow {
  id: number | string;
  fullName: string;
  email: string;
  programName?: string;
  organizationName?: string;
  ownerName?: string;
  programStatus?: string;
  startDate?: string | null;
  endDate?: string | null;
  otjCompleted?: number;
  otjExpected?: number;
  otjPlanned?: number;
  otjHoursStatus?: string;
}

interface MarkingRow {
  learnerId: number | string;
  fullName: string;
  email: string;
  caseOwner?: string;
  countEvidencePending?: number;
  evidenceAccepted?: number;
  evidenceReferred?: number;
  totalEvidence?: number;
  lastSnapshotDate?: string | null;
  startDate?: string | null;
  status?: string;
  lastSubDate?: string;
  lastFileSubmitDate?: string;
}

interface LmsActivityRow {
  learnerId: number | string;
  fullName: string;
  email: string;
  caseOwner?: string;
  lastActivity?: string;
}

interface CombinedLearnerRow {
  key: string;
  fullName: string;
  email: string;
  organisation: string;
  programme: string;
  coach: string;
  pr?: PrRow;
  mcr?: McrRow;
  otj?: OtjRow;
  marking?: MarkingRow;
  lms?: LmsActivityRow;
}

const normalizeEmail = (email: string | undefined) => String(email || "").trim().toLowerCase();

const parseDateValue = (value: string | null | undefined) => {
  const text = String(value || "").trim();
  if (!text || text.toLowerCase() === "n/a") return null;

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const dmy = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (dmy) {
    const year = dmy[3].length === 2 ? Number(`20${dmy[3]}`) : Number(dmy[3]);
    const d = new Date(year, Number(dmy[2]) - 1, Number(dmy[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
};

const formatDate = (value: string | null | undefined) => {
  const d = parseDateValue(value);
  if (!d) return String(value || "").trim() || "-";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const formatHours = (value: number | undefined) => {
  const hours = Number(value || 0);
  if (!Number.isFinite(hours) || hours <= 0) return "-";
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return minutes ? `${whole}h ${minutes}m` : `${whole}h`;
};

const startOfDay = (date: Date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const endOfDay = (date: Date) => {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
};

const statusTone = (status: string | undefined, dateValue?: string | null): Tone => {
  const text = String(status || "").trim().toLowerCase();
  const date = parseDateValue(dateValue);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (text.includes("completed") || text.includes("on track") || text.includes("ahead")) return "green";
  if (text.includes("in progress") || text.includes("awaiting")) return "blue";
  if (text.includes("scheduled") && !text.includes("not")) return "teal";
  if (text.includes("at risk") || text.includes("overdue")) return "red";
  if (text.includes("due") || text.includes("not scheduled") || text.includes("behind")) return "red";
  if (text.includes("need attention") || text.includes("normal")) return "amber";
  if (date && date < today) return "red";
  return "slate";
};

const toneClass: Record<Tone, string> = {
  red: "border-red-200 bg-red-50 text-red-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  green: "border-green-200 bg-green-50 text-green-700",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  teal: "border-teal-200 bg-teal-50 text-teal-700",
  slate: "border-slate-200 bg-slate-50 text-slate-600",
};

const toneScore: Record<Tone, number> = {
  red: 4,
  amber: 3,
  blue: 2,
  teal: 1,
  slate: 0,
  green: 0,
};

const getMcrNextStatus = (row: McrRow | undefined) => {
  if (!row) return "";
  const nextDate = parseDateValue(row.nextDueDate || "");
  if (!nextDate) return "";
  const nextTime = nextDate.toDateString();
  const match = (row.mcmDates || []).find((item) => {
    const itemDate = parseDateValue(item.date);
    return itemDate && itemDate.toDateString() === nextTime;
  });
  return match?.status || row.mcrStatus || "";
};

const getMcrDueStatus = (row: McrRow | undefined) => {
  if (!row?.dueMcmDate) return "";
  const dueDate = parseDateValue(row.dueMcmDate);
  if (!dueDate) return row.mcrStatus || "";
  const dueTime = dueDate.toDateString();
  const match = (row.mcmDates || []).find((item) => {
    const itemDate = parseDateValue(item.date);
    return itemDate && itemDate.toDateString() === dueTime;
  });
  return match?.status || "Due";
};

const getPrDueStatus = (row: PrRow | undefined) => {
  if (!row?.duePrDate) return "";
  return row.duePrState || "Due";
};

const matchesStatusFilter = (filter: string, tone: Tone, status: string) => {
  if (filter === "all") return true;
  const text = String(status || "").toLowerCase();
  if (filter === "red") {
    return tone === "red" || text.includes("due") || text.includes("not scheduled") || text.includes("at risk") || text.includes("overdue");
  }
  if (filter === "amber") {
    return tone === "amber" || text.includes("need attention") || text.includes("needs attention") || text.includes("normal");
  }
  if (filter === "blue") {
    return tone === "blue" || text.includes("in progress") || text.includes("awaiting");
  }
  if (filter === "teal") {
    return tone === "teal" || (text.includes("scheduled") && !text.includes("not"));
  }
  if (filter === "green") {
    return tone === "green" || text.includes("completed") || text.includes("on track") || text.includes("ahead");
  }
  if (filter === "slate") {
    return tone === "slate" || !text;
  }
  return true;
};

const markingTone = (row: MarkingRow | undefined): Tone => {
  const pending = Number(row?.countEvidencePending || 0);
  if (pending > 10) return "red";
  if (pending > 0) return "amber";
  if (row) return "green";
  return "slate";
};

const lmsActivityTone = (row: LmsActivityRow | undefined): Tone => {
  const activityDate = parseDateValue(row?.lastActivity);
  if (!activityDate) return "slate";
  const today = startOfDay(new Date());
  const date = startOfDay(activityDate);
  const days = Math.floor((today.getTime() - date.getTime()) / 86400000);
  if (days <= 30) return "green";
  if (days <= 90) return "blue";
  return "amber";
};

const statusFilterOptions = (label: string) => [
  { value: "all", label },
  { value: "red", label: "Due / Not Scheduled" },
  { value: "amber", label: "Normal / Need Attention" },
  { value: "blue", label: "In Progress / Awaiting" },
  { value: "teal", label: "Scheduled" },
  { value: "green", label: "Completed / On Track" },
  { value: "slate", label: "No Status" },
];

const assignmentFilterOptions = [
  { value: "all", label: "All Assignments" },
  { value: "has_pending", label: "Require Marking" },
  { value: "no_pending", label: "No Pending" },
  { value: "no_data", label: "No Marking Data" },
];

const timeFilterOptions = [
  { value: "all", label: "All Time" },
  { value: "overdue", label: "Overdue Dates" },
  { value: "this_month", label: "This Month" },
  { value: "last_30", label: "Last 30 Days" },
  { value: "next_30", label: "Next 30 Days" },
  { value: "next_90", label: "Next 90 Days" },
];

const lastSubmissionFilterOptions = [
  { value: "all", label: "All Last Submissions" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7", label: "Last 7 Days" },
  { value: "last_30", label: "Last 30 Days" },
  { value: "older_30", label: "Older Than 30 Days" },
  { value: "none", label: "No Submission" },
];

const getRowDateValues = (row: CombinedLearnerRow) => [
  row.otj?.startDate,
  row.otj?.endDate,
  row.pr?.duePrDate,
  row.pr?.nextPrDate,
  row.mcr?.dueMcmDate,
  row.mcr?.nextDueDate,
  row.lms?.lastActivity,
  row.marking?.lastFileSubmitDate || row.marking?.lastSubDate || row.marking?.lastSnapshotDate,
]
  .map(parseDateValue)
  .filter((date): date is Date => Boolean(date));

const matchesTimeFilter = (row: CombinedLearnerRow, filter: string) => {
  if (filter === "all") return true;

  const today = startOfDay(new Date());
  const dates = getRowDateValues(row);

  if (filter === "overdue") {
    const prDate = parseDateValue(row.pr?.duePrDate);
    const prTone = statusTone(getPrDueStatus(row.pr), row.pr?.duePrDate);
    const mcrDate = parseDateValue(row.mcr?.dueMcmDate);
    const mcrTone = statusTone(getMcrDueStatus(row.mcr), row.mcr?.dueMcmDate);
    return Boolean((prDate && prDate < today && prTone !== "green") || (mcrDate && mcrDate < today && mcrTone !== "green"));
  }

  let start = today;
  let end = endOfDay(today);

  if (filter === "this_month") {
    start = startOfDay(new Date(today.getFullYear(), today.getMonth(), 1));
    end = endOfDay(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  }

  if (filter === "last_30") {
    start = startOfDay(new Date(today));
    start.setDate(start.getDate() - 30);
    end = endOfDay(new Date());
  }

  if (filter === "next_30") {
    start = today;
    end = endOfDay(new Date(today));
    end.setDate(end.getDate() + 30);
  }

  if (filter === "next_90") {
    start = today;
    end = endOfDay(new Date(today));
    end.setDate(end.getDate() + 90);
  }

  return dates.some((date) => date >= start && date <= end);
};

const matchesLastSubmissionFilter = (row: CombinedLearnerRow, filter: string) => {
  if (filter === "all") return true;

  const submissionDate = parseDateValue(row.marking?.lastFileSubmitDate || row.marking?.lastSubDate || row.marking?.lastSnapshotDate);
  if (filter === "none") return !submissionDate;
  if (!submissionDate) return false;

  const today = startOfDay(new Date());
  const date = startOfDay(submissionDate);

  if (filter === "today") {
    return date.getTime() === today.getTime();
  }

  const yesterday = startOfDay(new Date(today));
  yesterday.setDate(yesterday.getDate() - 1);
  if (filter === "yesterday") {
    return date.getTime() === yesterday.getTime();
  }

  const last7 = startOfDay(new Date(today));
  last7.setDate(last7.getDate() - 7);
  if (filter === "last_7") {
    return date >= last7 && date <= today;
  }

  const last30 = startOfDay(new Date(today));
  last30.setDate(last30.getDate() - 30);
  if (filter === "last_30") {
    return date >= last30 && date <= today;
  }

  if (filter === "older_30") {
    return date < last30;
  }

  return true;
};

const loadJson = async <T,>(path: string): Promise<T[]> => {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) return [];
  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
};

export default function LearnerProgressPage() {
  const [prRows, setPrRows] = useState<PrRow[]>([]);
  const [mcrRows, setMcrRows] = useState<McrRow[]>([]);
  const [otjRows, setOtjRows] = useState<OtjRow[]>([]);
  const [markingRows, setMarkingRows] = useState<MarkingRow[]>([]);
  const [lmsRows, setLmsRows] = useState<LmsActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [programmeFilter, setProgrammeFilter] = useState("all");
  const [coachFilter, setCoachFilter] = useState("all");
  const [prFilter, setPrFilter] = useState("all");
  const [mcrFilter, setMcrFilter] = useState("all");
  const [otjFilter, setOtjFilter] = useState("all");
  const [assignmentFilter, setAssignmentFilter] = useState("all");
  const [timeFilter, setTimeFilter] = useState("all");
  const [lastSubmissionFilter, setLastSubmissionFilter] = useState("all");

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const [nextPrRows, nextMcrRows, nextOtjRows, nextMarkingRows, nextLmsRows] = await Promise.all([
        loadJson<PrRow>("/api/progress-review-summary/"),
        loadJson<McrRow>("/api/mcr-summary/"),
        loadJson<OtjRow>("/api/aptem-learners/"),
        loadJson<MarkingRow>("/api/require-marking/"),
        loadJson<LmsActivityRow>("/api/lms-activity/"),
      ]);
      setPrRows(nextPrRows);
      setMcrRows(nextMcrRows);
      setOtjRows(nextOtjRows);
      setMarkingRows(nextMarkingRows);
      setLmsRows(nextLmsRows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const allOverviewRows = useMemo(() => {
    const rows = new Map<string, CombinedLearnerRow>();

    const ensure = (email: string, seed: Partial<CombinedLearnerRow>) => {
      const key = normalizeEmail(email) || seed.key || seed.fullName || "";
      if (!key) return null;
      const current = rows.get(key);
      if (current) {
        rows.set(key, {
          ...current,
          fullName: current.fullName || seed.fullName || "",
          email: current.email || seed.email || key,
          organisation: current.organisation || seed.organisation || "",
          programme: current.programme || seed.programme || "",
          coach: current.coach || seed.coach || "",
        });
        return rows.get(key)!;
      }
      const next: CombinedLearnerRow = {
        key,
        fullName: seed.fullName || "",
        email: seed.email || key,
        organisation: seed.organisation || "",
        programme: seed.programme || "",
        coach: seed.coach || "",
      };
      rows.set(key, next);
      return next;
    };

    for (const row of otjRows) {
      const item = ensure(row.email, {
        fullName: row.fullName,
        email: normalizeEmail(row.email),
        organisation: row.organizationName || "",
        programme: row.programName || "",
        coach: row.ownerName || "",
      });
      if (item) item.otj = row;
    }

    for (const row of prRows) {
      const item = ensure(row.email, {
        fullName: row.fullName,
        email: normalizeEmail(row.email),
        organisation: row.organisation || "",
        programme: row.group || "",
        coach: row.caseOwner || "",
      });
      if (item) item.pr = row;
    }

    for (const row of mcrRows) {
      const item = ensure(row.email, {
        fullName: row.fullName,
        email: normalizeEmail(row.email),
        organisation: row.organisationName || "",
        programme: row.programme || "",
        coach: row.caseOwner || "",
      });
      if (item) item.mcr = row;
    }

    for (const row of markingRows) {
      const item = ensure(row.email, {
        fullName: row.fullName,
        email: normalizeEmail(row.email),
        coach: row.caseOwner || "",
      });
      if (item) item.marking = row;
    }

    for (const row of lmsRows) {
      const item = ensure(row.email, {
        fullName: row.fullName,
        email: normalizeEmail(row.email),
        coach: row.caseOwner || "",
      });
      if (item) item.lms = row;
    }

    return Array.from(rows.values())
      .filter((row) => !row.otj?.programStatus || row.otj.programStatus.toLowerCase() === "active")
      .sort((a, b) => {
        const aPrTone = statusTone(getPrDueStatus(a.pr) || a.pr?.nextPrState || a.pr?.reviewStatus, a.pr?.duePrDate || a.pr?.nextPrDate);
        const bPrTone = statusTone(getPrDueStatus(b.pr) || b.pr?.nextPrState || b.pr?.reviewStatus, b.pr?.duePrDate || b.pr?.nextPrDate);
        const aMcrTone = statusTone(getMcrDueStatus(a.mcr) || getMcrNextStatus(a.mcr), a.mcr?.dueMcmDate || a.mcr?.nextDueDate);
        const bMcrTone = statusTone(getMcrDueStatus(b.mcr) || getMcrNextStatus(b.mcr), b.mcr?.dueMcmDate || b.mcr?.nextDueDate);
        const aOtjTone = statusTone(a.otj?.otjHoursStatus);
        const bOtjTone = statusTone(b.otj?.otjHoursStatus);
        const aLmsTone = lmsActivityTone(a.lms);
        const bLmsTone = lmsActivityTone(b.lms);
        const aMarkingTone = markingTone(a.marking);
        const bMarkingTone = markingTone(b.marking);
        const aScore = toneScore[aPrTone] + toneScore[aMcrTone] + toneScore[aOtjTone] + toneScore[aLmsTone] + toneScore[aMarkingTone];
        const bScore = toneScore[bPrTone] + toneScore[bMcrTone] + toneScore[bOtjTone] + toneScore[bLmsTone] + toneScore[bMarkingTone];
        if (aScore !== bScore) return bScore - aScore;
        return a.fullName.localeCompare(b.fullName);
      });
  }, [lmsRows, markingRows, mcrRows, otjRows, prRows]);

  const programmeOptions = useMemo(
    () => [
      { value: "all", label: "All Programmes" },
      ...Array.from(new Set(allOverviewRows.map((row) => row.programme).filter(Boolean)))
        .sort()
        .map((value) => ({ value, label: value })),
    ],
    [allOverviewRows],
  );

  const coachOptions = useMemo(
    () => [
      { value: "all", label: "All Coaches" },
      ...Array.from(new Set(allOverviewRows.map((row) => row.coach).filter(Boolean)))
        .filter((coach) => !["default owner", "enrolment team"].includes(coach.toLowerCase()))
        .sort()
        .map((value) => ({ value, label: value })),
    ],
    [allOverviewRows],
  );

  const otjOptions = useMemo(
    () => [
      { value: "all", label: "All OTJH" },
      ...Array.from(new Set(allOverviewRows.map((row) => row.otj?.otjHoursStatus || "").filter(Boolean)))
        .sort()
        .map((value) => ({ value, label: value })),
      { value: "__no_otj__", label: "No OTJH Data" },
    ],
    [allOverviewRows],
  );

  const overviewRows = useMemo(() => {
    const q = search.trim().toLowerCase();

    return allOverviewRows.filter((row) => {
      if (q && ![row.fullName, row.email, row.organisation, row.programme, row.coach]
        .some((value) => value.toLowerCase().includes(q))) {
        return false;
      }
      if (programmeFilter !== "all" && row.programme !== programmeFilter) return false;
      if (coachFilter !== "all" && row.coach !== coachFilter) return false;

      const prStatus = row.pr?.nextPrState || "";
      const prTone = statusTone(prStatus, row.pr?.nextPrDate);
      if (!matchesStatusFilter(prFilter, prTone, prStatus)) return false;

      const mcrStatus = getMcrNextStatus(row.mcr);
      const mcrTone = statusTone(mcrStatus, row.mcr?.nextDueDate);
      if (!matchesStatusFilter(mcrFilter, mcrTone, mcrStatus)) return false;

      const otjStatus = row.otj?.otjHoursStatus || "";
      if (otjFilter === "__no_otj__" && otjStatus) return false;
      if (otjFilter !== "all" && otjFilter !== "__no_otj__" && otjStatus !== otjFilter) return false;

      const pendingEvidence = Number(row.marking?.countEvidencePending || 0);
      if (assignmentFilter === "has_pending" && pendingEvidence <= 0) return false;
      if (assignmentFilter === "no_pending" && (!row.marking || pendingEvidence > 0)) return false;
      if (assignmentFilter === "no_data" && row.marking) return false;

      if (!matchesTimeFilter(row, timeFilter)) return false;
      if (!matchesLastSubmissionFilter(row, lastSubmissionFilter)) return false;

      return true;
    });
  }, [
    allOverviewRows,
    assignmentFilter,
    coachFilter,
    lastSubmissionFilter,
    mcrFilter,
    otjFilter,
    prFilter,
    programmeFilter,
    search,
    timeFilter,
  ]);

  const hasFilters =
    Boolean(search.trim()) ||
    programmeFilter !== "all" ||
    coachFilter !== "all" ||
    prFilter !== "all" ||
    mcrFilter !== "all" ||
    otjFilter !== "all" ||
    assignmentFilter !== "all" ||
    timeFilter !== "all" ||
    lastSubmissionFilter !== "all";

  const clearFilters = () => {
    setSearch("");
    setProgrammeFilter("all");
    setCoachFilter("all");
    setPrFilter("all");
    setMcrFilter("all");
    setOtjFilter("all");
    setAssignmentFilter("all");
    setTimeFilter("all");
    setLastSubmissionFilter("all");
  };

  return (
    <AppLayout>
      <div className="min-h-full bg-[#F5F4FB]">
        <div className="border-b border-[#E2DCF8] bg-white px-4 pb-5 pt-4 sm:px-6">
          <BackButton to="/" label="Home" />
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#E2DCF8] bg-[#EEF2FF]">
                <TrendingUp className="h-5 w-5 text-[#5B47D5]" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-[#1D1050]">Learner Progress</h1>
                <p className="mt-0.5 text-sm text-[#6E6D8A]">PR, MCR, and OTJH in one place</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative min-w-[280px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9B94C8]" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search student name..."
                  className="h-10 rounded-lg border-[#E2DCF8] bg-white pl-9 text-sm"
                />
              </div>
              <button
                onClick={loadOverview}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-[#E2DCF8] bg-white px-3 text-xs font-semibold text-[#3730A3] transition-colors hover:bg-[#F0F6FF]"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <FilterSelect
              value={programmeFilter}
              onChange={setProgrammeFilter}
              options={programmeOptions}
              minWidth={190}
            />
            <FilterSelect
              value={coachFilter}
              onChange={setCoachFilter}
              options={coachOptions}
              minWidth={160}
            />
            <FilterSelect
              value={prFilter}
              onChange={setPrFilter}
              options={statusFilterOptions("All PR")}
              minWidth={150}
            />
            <FilterSelect
              value={mcrFilter}
              onChange={setMcrFilter}
              options={statusFilterOptions("All MCR")}
              minWidth={150}
            />
            <FilterSelect
              value={otjFilter}
              onChange={setOtjFilter}
              options={otjOptions}
              minWidth={155}
            />
            <FilterSelect
              value={assignmentFilter}
              onChange={setAssignmentFilter}
              options={assignmentFilterOptions}
              minWidth={170}
            />
            <FilterSelect
              value={timeFilter}
              onChange={setTimeFilter}
              options={timeFilterOptions}
              minWidth={150}
            />
            <FilterSelect
              value={lastSubmissionFilter}
              onChange={setLastSubmissionFilter}
              options={lastSubmissionFilterOptions}
              minWidth={190}
            />
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#E2DCF8] bg-white px-3 text-xs font-semibold text-[#6E6D8A] shadow-sm transition-colors hover:bg-[#F0F6FF]"
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </button>
            )}
            <span className="ml-auto rounded-full bg-[#1D1050] px-3 py-1 text-xs font-bold text-white shadow-sm">
              {overviewRows.length} of {allOverviewRows.length}
            </span>
          </div>

          <div className="overflow-hidden rounded-xl border border-[#E2DCF8] bg-white shadow-sm">
            {loading ? (
              <div className="flex h-40 items-center justify-center text-sm text-[#6E6D8A]">
                Loading learner progress...
              </div>
            ) : overviewRows.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-[#6E6D8A]">
                No learners found
              </div>
            ) : (
              <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 210px)" }}>
                <table className="w-full min-w-[1320px] text-sm">
                  <thead>
                    <tr className="border-b border-[#E2DCF8] bg-[#F8FBFE]">
                      <th rowSpan={2} className="sticky left-0 top-0 z-30 border-r border-[#E2DCF8] bg-[#F8FBFE] px-4 py-3 text-left text-xs font-semibold text-[#6E6D8A]">
                        Learner
                      </th>
                      <th rowSpan={2} className="sticky top-0 z-20 whitespace-nowrap bg-[#F8FBFE] px-3 py-3 text-left text-xs font-semibold text-[#6E6D8A]">
                        Start Date
                      </th>
                      <th rowSpan={2} className="sticky top-0 z-20 whitespace-nowrap border-r border-[#E2DCF8] bg-[#F8FBFE] px-3 py-3 text-left text-xs font-semibold text-[#6E6D8A]">
                        End Date
                      </th>
                      <th colSpan={2} className="sticky top-0 z-20 border-r border-[#E2DCF8] bg-[#EEF2FF] px-3 py-2 text-center text-xs font-bold text-[#5B47D5]">
                        PR
                      </th>
                      <th colSpan={2} className="sticky top-0 z-20 border-r border-[#E2DCF8] bg-[#F1F6FC] px-3 py-2 text-center text-xs font-bold text-[#4338CA]">
                        MCR
                      </th>
                      <th colSpan={2} className="sticky top-0 z-20 bg-orange-50 px-3 py-2 text-center text-xs font-bold text-orange-800">
                        OTJH
                      </th>
                      <th colSpan={1} className="sticky top-0 z-20 border-l border-[#E2DCF8] border-r border-[#E2DCF8] bg-[#EEF2FF] px-3 py-2 text-center text-xs font-bold text-[#5B47D5]">
                        LMS Activity
                      </th>
                      <th colSpan={2} className="sticky top-0 z-20 bg-slate-100 px-3 py-2 text-center text-xs font-bold text-slate-700">
                        Aptem Assignment
                      </th>
                    </tr>
                    <tr className="border-b border-[#E2DCF8] bg-[#F8FBFE]">
                      {["Last PR", "Next PR", "Last MCR", "Next MCR", "Hours", "Status", "Last Activity", "Pending", "Last Submit"].map((header, index) => (
                        <th
                          key={header}
                          className={`sticky top-[37px] z-20 whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold text-[#6E6D8A] ${
                            index === 1 || index === 3 || index === 5 || index === 6 ? "border-r border-[#E2DCF8]" : ""
                          } ${index >= 7 ? "bg-slate-100" : index === 6 ? "bg-[#EEF2FF]" : index >= 4 ? "bg-orange-50" : index >= 2 ? "bg-[#F1F6FC]" : "bg-[#EEF2FF]"}`}
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {overviewRows.map((row) => {
                      const prNextStatus = row.pr?.nextPrState || "";
                      const prNextTone = statusTone(prNextStatus, row.pr?.nextPrDate);
                      const mcrNextStatus = getMcrNextStatus(row.mcr);
                      const mcrNextTone = statusTone(mcrNextStatus, row.mcr?.nextDueDate);
                      const otjTone = statusTone(row.otj?.otjHoursStatus);
                      const lmsTone = lmsActivityTone(row.lms);
                      const assignmentTone = markingTone(row.marking);
                      const otjHours = `${formatHours(row.otj?.otjCompleted)} / ${formatHours(row.otj?.otjExpected || row.otj?.otjPlanned)}`;
                      const pendingEvidence = Number(row.marking?.countEvidencePending || 0);

                      return (
                        <tr key={row.key} className="group border-b border-[#F0F4F8] transition-colors hover:bg-[#F8FBFE]">
                          <td className="sticky left-0 z-10 border-r border-[#E2DCF8] bg-white px-4 py-3 group-hover:bg-[#F8FBFE]">
                            <p className="whitespace-nowrap font-semibold text-[#1D1050]">{row.fullName || "-"}</p>
                            <p className="text-xs text-[#6E6D8A]">{row.email}</p>
                            <p className="mt-1 max-w-[280px] truncate text-[11px] text-[#9B94C8]">
                              {[row.organisation, row.programme, row.coach].filter(Boolean).join(" - ") || "-"}
                            </p>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-xs font-semibold text-[#1D1050]">
                            {formatDate(row.otj?.startDate)}
                          </td>
                          <td className="whitespace-nowrap border-r border-[#E2DCF8] px-3 py-3 text-xs font-semibold text-[#1D1050]">
                            {formatDate(row.otj?.endDate)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-xs text-[#6E6D8A]">
                            {formatDate(row.pr?.lastActuallyCompletedPr || row.pr?.lastProgressReview)}
                          </td>
                          <td className="border-r border-[#E2DCF8] px-3 py-3">
                            <span className={`inline-flex min-w-[8rem] flex-col rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${toneClass[prNextTone]}`}>
                              <span>{formatDate(row.pr?.nextPrDate)}</span>
                              <span className="mt-0.5 text-[10px] font-bold opacity-80">{prNextStatus || "No next"}</span>
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-xs text-[#6E6D8A]">
                            {formatDate(row.mcr?.lastActuallyCompletedMcm || row.mcr?.lastMcm)}
                          </td>
                          <td className="border-r border-[#E2DCF8] px-3 py-3">
                            <span className={`inline-flex min-w-[8rem] flex-col rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${toneClass[mcrNextTone]}`}>
                              <span>{formatDate(row.mcr?.nextDueDate)}</span>
                              <span className="mt-0.5 text-[10px] font-bold opacity-80">{mcrNextStatus || "No next"}</span>
                            </span>
                          </td>
                          <td className="bg-orange-50/40 px-3 py-3">
                            <span className={`inline-flex min-w-[9rem] flex-col rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${toneClass[otjTone]}`}>
                              <span>{otjHours}</span>
                              <span className="mt-0.5 text-[10px] font-bold opacity-80">completed / target</span>
                            </span>
                          </td>
                          <td className="whitespace-nowrap bg-orange-50/40 px-3 py-3">
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${toneClass[otjTone]}`}>
                              {row.otj?.otjHoursStatus || "No status"}
                            </span>
                          </td>
                          <td className="border-r border-[#E2DCF8] bg-[#F8FBFE] px-3 py-3">
                            <span className={`inline-flex min-w-[8rem] flex-col rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${toneClass[lmsTone]}`}>
                              <span>{formatDate(row.lms?.lastActivity)}</span>
                              <span className="mt-0.5 text-[10px] font-bold opacity-80">
                                {row.lms?.lastActivity ? "completed activity" : "No activity"}
                              </span>
                            </span>
                          </td>
                          <td className="bg-slate-50/80 px-3 py-3">
                            <span className={`inline-flex min-w-[7rem] flex-col rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${toneClass[assignmentTone]}`}>
                              <span>{pendingEvidence}</span>
                              <span className="mt-0.5 text-[10px] font-bold opacity-80">evidence pending</span>
                            </span>
                          </td>
                          <td className="whitespace-nowrap bg-slate-50/80 px-3 py-3">
                            <span className={`inline-flex min-w-[8rem] flex-col rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${toneClass[assignmentTone]}`}>
                              <span>{formatDate(row.marking?.lastFileSubmitDate || row.marking?.lastSubDate || row.marking?.lastSnapshotDate)}</span>
                              <span className="mt-0.5 text-[10px] font-bold opacity-80">
                                {pendingEvidence > 0 ? "Require Marking" : row.marking ? "No Pending" : "No marking data"}
                              </span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
