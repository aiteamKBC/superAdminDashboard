import { useMemo,useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCcw, Settings2 } from "lucide-react";

import type { UiCoach } from "@/lib/adapters/kbcToUi";
import type { DashboardFilters } from "@/lib/filters/dashboardFilters";

const ALL_PROGRAMMES = "All Programmes";
const ALL_COACHES = "All Coaches";
const ALL_RATINGS = "All Ratings";
const ALL_ORGANIZATIONS = "All Organizations";
const ALL_STATUSES = "All Statuses";

type Props = {
  rows: UiCoach[];
  loading: boolean;
  filters: DashboardFilters;
  onChange: (next: DashboardFilters) => void;
  onRefresh?: () => void;
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

export default function GlobalFilters({
  rows,
  loading,
  filters,
  onChange,
  onRefresh,
}: Props) {
  const lastRefreshed = useMemo(() => new Date(), []);
  const safeRows = Array.isArray(rows) ? rows : [];

  const coachOptions = useMemo(() => {
    const names = safeRows
      .map((r) => String(r.name || "").trim())
      .filter((n) => n && n !== "Unknown" && n !== "API Do Not Delete");

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

  const latestProgrammeAudit = useMemo(() => {
  const expectedModules: string[] = [];

  safeRows.forEach((row) => {
    const attendanceLearners = getAttendanceLearnersFromRaw(row.raw);

    attendanceLearners.forEach((learner: any) => {
      const latestModule = getLatestAttendanceModule(learner?.Attendance);
      if (latestModule) expectedModules.push(latestModule);
    });
  });

  const expectedUnique = withAllFirst(ALL_PROGRAMMES, expectedModules);
  const actualUnique = programmeOptions;

  const extraInFilter = actualUnique.filter((x) => !expectedUnique.includes(x));
  const missingFromFilter = expectedUnique.filter((x) => !actualUnique.includes(x));

  return {
    expectedUnique,
    actualUnique,
    extraInFilter,
    missingFromFilter,
  };
}, [safeRows, programmeOptions]);

useEffect(() => {
  console.log("Programme filter audit", latestProgrammeAudit);
  console.table(
    latestProgrammeAudit.expectedUnique.map((module) => ({
      module,
      inFilter: latestProgrammeAudit.actualUnique.includes(module),
    }))
  );
}, [latestProgrammeAudit]);

  const ratingOptions = useMemo(() => {
    const ratings = safeRows.map((r) => String(r.rating || "Unknown").trim() || "Unknown");
    return withAllFirst(ALL_RATINGS, ratings);
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

    safeRows.forEach((row) => {
      const learnersJsonStudents = getLearnersJsonStudentsFromRaw(row.raw);
      learnersJsonStudents.forEach((student: any) => {
        const status = pickStatus(student);
        if (status) all.push(status);
      });
    });

    return withAllFirst(ALL_STATUSES, all);
  }, [safeRows]);

  const riskOptions = ["All", "On track", "At risk", "Overdue", "Unknown"];

  return (
    <div className="border-b bg-card px-6 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">
          Engagement Coordinator , Learner Risk & Actions
        </h2>

        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Last refreshed:{" "}
            {lastRefreshed.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>

          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 text-muted-foreground"
            onClick={() => onRefresh?.()}
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            Refresh
          </Button>

          <Button size="sm" variant="outline" className="gap-1.5">
            <Settings2 className="h-3.5 w-3.5" />
            Thresholds
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={filters.programme}
          onValueChange={(v) => onChange({ ...filters, programme: v })}
        >
          <SelectTrigger className="h-9 w-[220px] text-sm">
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
          <SelectTrigger className="h-9 w-[190px] text-sm">
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
          value={filters.rating}
          onValueChange={(v) => onChange({ ...filters, rating: v })}
        >
          <SelectTrigger className="h-9 w-[160px] text-sm">
            <SelectValue placeholder={loading ? "Loading..." : undefined} />
          </SelectTrigger>
          <SelectContent>
            {ratingOptions.map((rating) => (
              <SelectItem key={rating} value={rating}>
                {rating}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.risk}
          onValueChange={(v) => onChange({ ...filters, risk: v })}
        >
          <SelectTrigger className="h-9 w-[150px] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {riskOptions.map((risk) => (
              <SelectItem key={risk} value={risk}>
                {risk}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.organisation}
          onValueChange={(v) => onChange({ ...filters, organisation: v })}
        >
          <SelectTrigger className="h-9 w-[190px] text-sm">
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
          <SelectTrigger className="h-9 w-[170px] text-sm">
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

        <Badge variant="secondary" className="text-xs">
          Last 30 days
        </Badge>
      </div>
    </div>
  );
}