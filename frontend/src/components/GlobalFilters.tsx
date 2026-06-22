import { useEffect, useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RefreshCcw, Settings2 } from "lucide-react";

import type { UiCoach } from "@/lib/adapters/kbcToUi";
import type { DashboardFilters } from "@/lib/filters/dashboardFilters";

const ALL_PROGRAMMES = "All Programmes";
const ALL_COACHES = "All Coaches";
const ALL_ORGANIZATIONS = "All Organizations";
const ALL_STATUSES = "All Statuses";
const DEFAULT_STATUS = "Active";

type Props = {
  rows: UiCoach[];
  loading: boolean;
  filters: DashboardFilters;
  onChange: (next: DashboardFilters) => void;
  onRefresh?: () => void | Promise<void>;
  learnerStatusOptions?: string[];
  showPrMonthFilter?: boolean;
  prMonthOffset?: number | "last12weeks";
  onPrMonthOffsetChange?: (v: number | "last12weeks") => void;
  getPrMonthLabel?: (offset: number | "last12weeks") => string;
  showPrStatusFilter?: boolean;
  prStatusFilter?: string;
  onPrStatusFilterChange?: (v: string) => void;
  prStatusOptions?: string[];
  showMcrMonthFilter?: boolean;
  mcrMonthOffset?: number;
  onMcrMonthOffsetChange?: (v: number) => void;
  showAbsenceFilter?: boolean;
  absenceWeeks?: "all" | 0 | 1 | 2 | 3;
  onAbsenceWeeksChange?: (v: "all" | 0 | 1 | 2 | 3) => void;
  getWeekLabel?: (index: 0 | 1 | 2 | 3) => string;
};

/********************************** Helpers ***************************/

// TODO: dedupe with Index.tsx
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

const getLatestAttendanceModule = (
  attendance:
    | Record<
      string,
      { value?: number; module?: string } | Array<{ value?: number; module?: string }>
    >
    | undefined
) => {
  const entries = Object.entries(attendance || {})
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
        sortIndex: index,
        module: getModuleLabel(value?.module),
      }));
    })
    .filter((x) => x.module)
    .sort((a, b) => {
      const diff = a.parsed.getTime() - b.parsed.getTime();
      if (diff !== 0) return diff;
      return a.sortIndex - b.sortIndex;
    });

  return entries.length ? entries[entries.length - 1].module : "";
};

const unique = (arr: string[]) =>
  Array.from(new Set(arr.map((x) => String(x || "").trim()).filter(Boolean)));

const sortAlpha = (arr: string[]) => [...arr].sort((a, b) => a.localeCompare(b));

const withAllFirst = (allLabel: string, values: string[]) => [
  allLabel,
  ...sortAlpha(unique(values).filter((v) => v !== allLabel)),
];

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

const getLearnersJsonStudentsFromRaw = (raw: any): any[] => {
  const fromLearnersJson = asArray(raw?.learners_json);
  if (fromLearnersJson.length) return fromLearnersJson;

  const fromNested = asArray(raw?.learners_json?.students);
  if (fromNested.length) return fromNested;

  return [];
};

const getAttendanceLearnersFromRaw = (raw: any): any[] => {
  const learners = raw?.attendance?.learners;
  return Array.isArray(learners) ? learners : [];
};

const getModuleLabel = (moduleStr: unknown) => {
  return String(moduleStr || "").trim();
};

const getAttendanceEntries = (
  attendance:
    | Record<
      string,
      { value?: number; module?: string } | Array<{ value?: number; module?: string }>
    >
    | undefined
) => {
  const entries = Object.entries(attendance || {});
  if (!entries.length) return [];

  return entries.flatMap(([, rawValue]) => {
    if (Array.isArray(rawValue)) return rawValue;
    if (rawValue && typeof rawValue === "object") return [rawValue];
    return [];
  });
};

const pickOrganisation = (student: any) =>
  String(
    student?.OrganizationName ||
    student?.OrganisationName ||
    student?.Organization ||
    student?.Organisation ||
    student?.CompanyName ||
    student?.company_name ||
    student?.Employer ||
    student?.EmployerName ||
    student?.employer_name ||
    ""
  ).trim();

const pickStatus = (student: any) =>
  String(
    student?.["Program-Status"] ||
    student?.["Program Status"] ||
    student?.program_status ||
    student?.Status ||
    student?.status ||
    ""
  ).trim();

const getMonthLabel = (offset: number) => {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return d.toLocaleString("en-GB", { month: "long", year: "numeric" });
};

export default function GlobalFilters({
  rows,
  loading,
  filters,
  onChange,
  onRefresh,
  learnerStatusOptions = [],
  showPrMonthFilter,
  prMonthOffset = 0 as number | "last12weeks",
  onPrMonthOffsetChange,
  getPrMonthLabel,
  showPrStatusFilter,
  prStatusFilter = "All",
  onPrStatusFilterChange,
  prStatusOptions = ["All"],
  showMcrMonthFilter,
  mcrMonthOffset = 0,
  onMcrMonthOffsetChange,
  showAbsenceFilter,
  absenceWeeks = 0,
  onAbsenceWeeksChange,
  getWeekLabel,
}: Props) {
  const [lastRefreshed, setLastRefreshed] = useState(() => new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [thresholdsOpen, setThresholdsOpen] = useState(false);
  const safeRows = Array.isArray(rows) ? rows : [];

  useEffect(() => {
    if (!loading && !refreshing) {
      setLastRefreshed(new Date());
    }
  }, [loading, refreshing]);

  const handleRefresh = async () => {
    if (!onRefresh || refreshing) return;

    setRefreshing(true);
    try {
      await onRefresh();
      setLastRefreshed(new Date());
    } finally {
      setRefreshing(false);
    }
  };

  const EXCLUDED_COACHES = new Set(["unknown", "api do not delete", "phone 1", "phone 2", "ella steven", "elaf mansour", "marwa mahmoud", "omar ham", "default owner", "enrolment team"]);

  const coachOptions = useMemo(() => {
    const names = safeRows
      .map((r) => String(r.name || "").trim())
      .filter((n) => n && !EXCLUDED_COACHES.has(n.toLowerCase()));

    return withAllFirst(ALL_COACHES, names);
  }, [safeRows]);

  const programmeOptions = useMemo(() => {
    const all: string[] = [];

    safeRows.forEach((row) => {
      const attendanceLearners = getAttendanceLearnersFromRaw(row.raw);

      attendanceLearners.forEach((learner: any) => {
        const latestModule = getLatestAttendanceModule(learner?.Attendance);
        if (latestModule) all.push(latestModule);
      });
    });

    return withAllFirst(ALL_PROGRAMMES, all);
  }, [safeRows]);



  const organisationOptions = useMemo(() => {
    const all: string[] = [];

    safeRows.forEach((row) => {
      const learnersJsonStudents = getLearnersJsonStudentsFromRaw(row.raw);
      learnersJsonStudents.forEach((student: any) => {
        const organisation = pickOrganisation(student);
        if (organisation) all.push(organisation);
      });
    });

    return withAllFirst(ALL_ORGANIZATIONS, all);
  }, [safeRows]);

  const statusOptions = useMemo(() => {
    const all: string[] = [];

    if (learnerStatusOptions.length) {
      all.push(...learnerStatusOptions);
    } else {
      safeRows.forEach((row) => {
        const learnersJsonStudents = getLearnersJsonStudentsFromRaw(row.raw);
        learnersJsonStudents.forEach((student: any) => {
          const status = pickStatus(student);
          if (status) all.push(status);
        });
      });
    }

    return withAllFirst(ALL_STATUSES, all);
  }, [safeRows, learnerStatusOptions]);

  const hasActivePrimaryFilters =
    filters.programme !== ALL_PROGRAMMES ||
    filters.coach !== ALL_COACHES ||
    filters.organisation !== ALL_ORGANIZATIONS ||
    filters.status !== DEFAULT_STATUS;

  return (
    <div className="border-b border-[#DDE7F0] bg-white/95 px-4 py-4 backdrop-blur sm:px-6">
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-xs font-bold uppercase text-[#2D73D5]">
            Engagment Dashboard
          </p>
          <h2 className="mt-1 text-xl font-bold tracking-normal text-[#14264A]">
            Learner Risk & Actions
          </h2>
          <p className="mt-1 text-sm text-[#71849A]">
            Filter the live cohort, then open a KPI to see the learners behind each signal.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[#DDE7F0] bg-[#F8FBFE] px-3 py-1.5 text-xs font-semibold text-[#5F748B]">
            Last refreshed:{" "}
            {lastRefreshed.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>

          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5 rounded-lg border-[#BFD4E7] bg-white text-[#24486D] hover:bg-[#EEF7FF] hover:text-[#14264A]"
            disabled={loading || refreshing}
            onClick={handleRefresh}
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${loading || refreshing ? "animate-spin" : ""}`} />
            {loading || refreshing ? "Refreshing" : "Refresh"}
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5 rounded-lg border-[#BFD4E7] bg-[#EEF7FF] text-[#1E6ACB] hover:bg-[#DFF0FF] hover:text-[#184D91]"
            onClick={() => setThresholdsOpen(true)}
          >
            <Settings2 className="h-3.5 w-3.5" />
            Thresholds
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filters.programme}
          onValueChange={(v) => onChange({ ...filters, programme: v })}
        >
          <SelectTrigger className="h-10 w-full rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm text-[#20344D] sm:w-[240px]">
            <SelectValue placeholder={loading ? "Loading..." : undefined} />
          </SelectTrigger>
          <SelectContent>
            {programmeOptions.map((programme) => (
              <SelectItem key={programme} value={programme}>
                {programme}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.coach}
          onValueChange={(v) => onChange({ ...filters, coach: v })}
        >
          <SelectTrigger className="h-10 w-full rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm text-[#20344D] sm:w-[200px]">
            <SelectValue placeholder={loading ? "Loading..." : undefined} />
          </SelectTrigger>
          <SelectContent>
            {coachOptions.map((coach) => (
              <SelectItem key={coach} value={coach}>
                {coach}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.organisation}
          onValueChange={(v) => onChange({ ...filters, organisation: v })}
        >
          <SelectTrigger className="h-10 w-full rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm text-[#20344D] sm:w-[210px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {organisationOptions.map((organisation) => (
              <SelectItem key={organisation} value={organisation}>
                {organisation}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.status}
          onValueChange={(v) => onChange({ ...filters, status: v })}
        >
          <SelectTrigger className="h-10 w-full rounded-lg border-[#D7E5F3] bg-[#F8FBFE] text-sm text-[#20344D] sm:w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((status) => (
              <SelectItem key={status} value={status}>
                {status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {showPrMonthFilter && onPrMonthOffsetChange && getPrMonthLabel && (
          <div className="flex h-10 items-center gap-2 rounded-lg border border-[#B8D7F2] bg-[#EEF7FF] px-3">
            <span className="text-xs font-bold text-[#184D91]">
              PR Quarter
            </span>
            <Select
              value={String(prMonthOffset)}
              onValueChange={(v) =>
                onPrMonthOffsetChange(v === "last12weeks" ? "last12weeks" : Number(v))
              }
            >
              <SelectTrigger className="h-7 w-[165px] border-0 bg-transparent p-0 text-xs font-semibold text-[#14264A] shadow-none focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="last12weeks">Last 12 Weeks</SelectItem>
                <SelectItem value="-2">{getPrMonthLabel(-2)}</SelectItem>
                <SelectItem value="-1">{getPrMonthLabel(-1)}</SelectItem>
                <SelectItem value="0">Current - {getPrMonthLabel(0)}</SelectItem>
                <SelectItem value="1">{getPrMonthLabel(1)}</SelectItem>
                <SelectItem value="2">{getPrMonthLabel(2)}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {showPrStatusFilter && onPrStatusFilterChange && (
          <div className="flex h-10 items-center gap-2 rounded-lg border border-[#B8D7F2] bg-[#EEF7FF] px-3">
            <span className="text-xs font-bold text-[#184D91]">
              PR Status
            </span>
            <Select
              value={prStatusFilter}
              onValueChange={(v) => onPrStatusFilterChange(v)}
            >
              <SelectTrigger className="h-7 w-[140px] border-0 bg-transparent p-0 text-xs font-semibold text-[#14264A] shadow-none focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {prStatusOptions.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {showAbsenceFilter && onAbsenceWeeksChange && getWeekLabel && (
          <div className="flex h-10 items-center gap-2 rounded-lg border border-[#F1D79D] bg-[#FFF8E8] px-3">
            <span className="text-xs font-bold text-[#94610A]">
              Absence Window
            </span>
            <Select
              value={String(absenceWeeks)}
              onValueChange={(v) =>
                onAbsenceWeeksChange(v === "all" ? "all" : (Number(v) as 0 | 1 | 2 | 3))
              }
            >
              <SelectTrigger className="h-7 w-[210px] border-0 bg-transparent p-0 text-xs font-semibold text-[#14264A] shadow-none focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="0">This week - {getWeekLabel(0)}</SelectItem>
                <SelectItem value="1">Previous week - {getWeekLabel(1)}</SelectItem>
                <SelectItem value="2">2 weeks ago - {getWeekLabel(2)}</SelectItem>
                <SelectItem value="3">3 weeks ago - {getWeekLabel(3)}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {showMcrMonthFilter && onMcrMonthOffsetChange && (
          <div className="flex h-10 items-center gap-2 rounded-lg border border-[#B8D7F2] bg-[#EEF7FF] px-3">
            <span className="text-xs font-bold text-[#184D91]">
              MCM Period
            </span>
            <Select
              value={String(mcrMonthOffset)}
              onValueChange={(v) => onMcrMonthOffsetChange(Number(v))}
            >
              <SelectTrigger className="h-7 w-[170px] border-0 bg-transparent p-0 text-xs font-semibold text-[#14264A] shadow-none focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="-1">Last 30 days</SelectItem>
                <SelectItem value="0">This Month - {getMonthLabel(0)}</SelectItem>
                <SelectItem value="1">{getMonthLabel(1)}</SelectItem>
                <SelectItem value="2">{getMonthLabel(2)}</SelectItem>
                <SelectItem value="3">{getMonthLabel(3)}</SelectItem>
                <SelectItem value="4">{getMonthLabel(4)}</SelectItem>
                <SelectItem value="5">{getMonthLabel(5)}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {hasActivePrimaryFilters && (
          <Button
            size="sm"
            variant="ghost"
            className="h-10 rounded-lg px-3 text-xs font-bold text-[#1E6ACB] hover:bg-[#EEF7FF] hover:text-[#184D91]"
            onClick={() =>
              onChange({
                ...filters,
                programme: ALL_PROGRAMMES,
                coach: ALL_COACHES,
                organisation: ALL_ORGANIZATIONS,
                status: DEFAULT_STATUS,
              })
            }
          >
            Clear filters
          </Button>
        )}
      </div>

      <Dialog open={thresholdsOpen} onOpenChange={setThresholdsOpen}>
        <DialogContent className="max-w-xl rounded-lg border-[#DDE7F0]">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-[#14264A]">
              Dashboard Thresholds
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-[#B8D7F2] bg-[#EEF7FF] p-3">
              <p className="font-semibold text-[#184D91]">Progress Review</p>
              <ul className="mt-2 space-y-1 text-xs text-[#5F748B]">
                <li>Review required is based on the selected PR period.</li>
                <li>Last 12 Weeks excludes Personal Support Plan and Gateway Review.</li>
                <li>Scheduled PR meetings today or later are excluded from Last 12 Weeks.</li>
              </ul>
            </div>

            <div className="rounded-lg border border-[#DDE7F0] bg-white p-3">
              <p className="font-semibold text-[#24486D]">Monthly Coaching Meeting</p>
              <ul className="mt-2 space-y-1 text-xs text-[#5F748B]">
                <li>Last 30 days includes today.</li>
                <li>Required counts learners with matching MCM activity in the selected period.</li>
                <li>Scheduled counts scheduled or completed MCM activity by period.</li>
              </ul>
            </div>

            <div className="rounded-lg border border-[#F1D79D] bg-[#FFF8E8] p-3">
              <p className="font-semibold text-[#94610A]">Attendance and OTJH</p>
              <ul className="mt-2 space-y-1 text-xs text-[#5F748B]">
                <li>Missed attendance uses the selected absence window.</li>
                <li>OTJH Behind uses learners flagged as at risk in the OTJH source data.</li>
              </ul>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
