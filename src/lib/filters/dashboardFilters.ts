import type { UiCoach } from "@/lib/adapters/kbcToUi";

export type DashboardFilters = {
    coach: string;
    rating: string;
    programme: string;
    risk: string;
    organisation: string;
    status: string;
};

export function riskBucket(elapsedDays?: number): string {
    if (elapsedDays == null) return "Unknown";
    if (elapsedDays <= 56) return "On track";
    if (elapsedDays <= 70) return "At risk";
    return "Overdue";
}

export function applyDashboardFilters(rows: UiCoach[], f: DashboardFilters): UiCoach[] {
    const cleaned = rows.filter(
        (r) =>
            r.name !== "Unknown" &&
            r.name !== "API Do Not Delete"
    );

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

        if (f.organisation !== "All Organisations") {
            const learners = (r as any).raw?.learners ?? [];

            const orgFilter = f.organisation.trim().toLowerCase();

            const match = learners.some((l: any) => {
                const org =
                    l?.OrganizationName ||
                    l?.OrganisationName ||
                    l?.organisation ||
                    "";

                return org.toLowerCase().trim() === orgFilter;
            });

            if (!match) return false;
        }

        if (f.risk !== "All") {
            const bucket = riskBucket((r as any).raw?.elapsed_days ?? null);
            if (bucket !== f.risk) {
                return false;
            }
        }

        if (f.status !== "All Statuses") {
            const status = (r as any).raw?.program_status || "";
            if (status !== f.status) {
                return false;
            }
        }

        return true;
    });
}