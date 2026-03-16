// src/lib/dashboard/getLearnersForKpi.ts

import type { Learner } from "@/types/dashboard";
import type { KpiCategory } from "@/types/dashboard";

export function getLearnersForKpi(
  learners: Learner[],
  kpi: KpiCategory
) {
  if (kpi === "missed-session") {
    return learners.filter(
      (l) =>
        (l.missedInRow ?? 0) >= 2 ||
        (l.absenceRatio ?? 0) >= 25
    );
  }

  if (kpi === "review-due") {
    return learners.filter((l) => (l as any).__reviewFlag === "overdue");
  }

  if (kpi === "otj-behind") {
    return learners.filter((l) => Boolean((l as any).hasOtjBehind));
  }

  return [];
}