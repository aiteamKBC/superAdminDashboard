import type { UiCoach } from "@/lib/adapters/kbcToUi";

export type DashboardFilters = {
  coach: string;
  rating: string;
  programme: string;
  risk: string;
  organisation: string;
  status: string;
};

const ALL_PROGRAMMES = "All Programmes";
const ALL_COACHES = "All Coaches";
const ALL_RATINGS = "All Ratings";
const ALL_ORGANIZATIONS = "All Organizations";
const ALL_STATUSES = "All Statuses";
const ALL_RISK = "All";

const norm = (v: unknown) => String(v ?? "").trim();
const lower = (v: unknown) => norm(v).toLowerCase();

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

const getModuleLabel = (moduleStr: unknown) => norm(moduleStr);

const pickOrganisationFromStudent = (student: any) =>
  norm(
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
  );

const pickStatusFromStudent = (student: any) =>
  norm(
    student?.["Program-Status"] ||
      student?.["Program Status"] ||
      student?.program_status ||
      student?.Status ||
      student?.status ||
      ""
  );

const pickRatingFromStudent = (student: any) =>
  norm(
    student?.Rating ||
      student?.rating ||
      student?.Risk ||
      student?.risk ||
      student?.LearnerRating ||
      student?.learner_rating ||
      ""
  );

const extractProgrammesFromAttendanceRaw = (raw: any) => {
  const set = new Set<string>();

  const attendanceLearners = getAttendanceLearnersFromRaw(raw);
  attendanceLearners.forEach((learner: any) => {
    const latestModule = getLatestAttendanceModule(learner?.Attendance);
    if (latestModule) set.add(latestModule);
  });

  return Array.from(set);
};

const extractOrganisationsFromLearnersJsonRaw = (raw: any) => {
  const set = new Set<string>();

  const learnersJsonStudents = getLearnersJsonStudentsFromRaw(raw);
  learnersJsonStudents.forEach((student: any) => {
    const organisation = pickOrganisationFromStudent(student);
    if (organisation) set.add(organisation);
  });

  return Array.from(set);
};

const extractStatusesFromLearnersJsonRaw = (raw: any) => {
  const set = new Set<string>();

  const learnersJsonStudents = getLearnersJsonStudentsFromRaw(raw);
  learnersJsonStudents.forEach((student: any) => {
    const status = pickStatusFromStudent(student);
    if (status) set.add(status);
  });

  return Array.from(set);
};

const extractRatingsFromRow = (row: UiCoach) => {
  const set = new Set<string>();

  const rowRating = norm((row as any)?.rating);
  const rowRisk = norm((row as any)?.risk);

  if (rowRating) set.add(rowRating);
  if (rowRisk) set.add(rowRisk);

  const learnersJsonStudents = getLearnersJsonStudentsFromRaw((row as any)?.raw);
  learnersJsonStudents.forEach((student: any) => {
    const rating = pickRatingFromStudent(student);
    if (rating) set.add(rating);
  });

  return Array.from(set);
};

const matchesValue = (candidate: unknown, selected: string) => lower(candidate) === lower(selected);

const anyMatch = (values: unknown[], selected: string) =>
  values.some((value) => matchesValue(value, selected));

export function applyDashboardFilters(rows: UiCoach[], filters: DashboardFilters): UiCoach[] {
  const safeRows = Array.isArray(rows) ? rows : [];

  return safeRows.filter((row) => {
    const raw = (row as any)?.raw;

    if (filters.coach !== ALL_COACHES) {
      const coachName = norm((row as any)?.name);
      if (!matchesValue(coachName, filters.coach)) return false;
    }

    if (filters.rating !== ALL_RATINGS) {
      const ratingCandidates = extractRatingsFromRow(row);
      if (!anyMatch(ratingCandidates, filters.rating)) return false;
    }

    if (filters.risk !== ALL_RISK) {
      const riskCandidates = extractRatingsFromRow(row);
      if (!anyMatch(riskCandidates, filters.risk)) return false;
    }

    if (filters.programme !== ALL_PROGRAMMES) {
      const programmes = extractProgrammesFromAttendanceRaw(raw);
      if (!anyMatch(programmes, filters.programme)) return false;
    }

    if (filters.organisation !== ALL_ORGANIZATIONS) {
      const organisations = extractOrganisationsFromLearnersJsonRaw(raw);
      if (!anyMatch(organisations, filters.organisation)) return false;
    }

    if (filters.status !== ALL_STATUSES) {
      const statuses = extractStatusesFromLearnersJsonRaw(raw);
      if (!anyMatch(statuses, filters.status)) return false;
    }

    return true;
  });
}