import type { UiCoach } from "@/lib/adapters/kbcToUi";

export type DashboardFilters = {
  coach: string;
  rating: string;
  programme: string;
  risk: string;
  organisation: string;
  status: string;
};

const ALL_ORGANIZATIONS = "All Organizations";
const ALL_STATUSES = "All Statuses";

export function riskBucket(elapsedDays?: number): string {
  if (elapsedDays == null) return "Unknown";
  if (elapsedDays <= 56) return "On track";
  if (elapsedDays <= 70) return "At risk";
  return "Overdue";
}

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

const pickOrganisation = (student: any) =>
  String(
    student?.OrganizationName ||
      student?.OrganisationName ||
      student?.Organization ||
      student?.Organisation ||
      student?.CompanyName ||
      student?.company_name ||
      ""
  )
    .trim()
    .toLowerCase();

const pickStatus = (student: any) =>
  String(
    student?.["Program-Status"] ||
      student?.["Program Status"] ||
      student?.program_status ||
      student?.Status ||
      student?.status ||
      ""
  )
    .trim()
    .toLowerCase();

export function applyDashboardFilters(rows: UiCoach[], f: DashboardFilters): UiCoach[] {
  const cleaned = rows.filter((r) => r.name !== "Unknown" && r.name !== "API Do Not Delete");

  return cleaned.filter((r) => {
    if (f.coach !== "All Coaches" && r.name !== f.coach) {
      return false;
    }

    const rating = r.rating || "Unknown";
    if (f.rating !== "All Ratings" && rating !== f.rating) {
      return false;
    }

    if (f.programme !== "All Programmes") {
      const programmes = r.programmes || [];
      if (!programmes.includes(f.programme)) {
        return false;
      }
    }

    const students = getStudentsFromRaw((r as any).raw);

    if (f.organisation !== ALL_ORGANIZATIONS) {
      const orgFilter = f.organisation.trim().toLowerCase();
      const match = students.some((student: any) => pickOrganisation(student) === orgFilter);
      if (!match) return false;
    }

    if (f.risk !== "All") {
      const bucket = riskBucket((r as any).raw?.elapsed_days ?? null);
      if (bucket !== f.risk) {
        return false;
      }
    }

    if (f.status !== ALL_STATUSES) {
      const statusFilter = f.status.trim().toLowerCase();
      const match = students.some((student: any) => pickStatus(student) === statusFilter);
      if (!match) return false;
    }

    return true;
  });
}