import { useMemo } from "react";
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

const ALL_ORGANIZATIONS = "All Organizations";
const ALL_STATUSES = "All Statuses";

type Props = {
  rows: UiCoach[];
  loading: boolean;
  filters: DashboardFilters;
  onChange: (next: DashboardFilters) => void;
  onRefresh?: () => void;
};

const unique = (arr: string[]) => Array.from(new Set(arr.filter(Boolean)));

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
      .map((r) => r.name?.trim())
      .filter((n) => n && n !== "Unknown" && n !== "API Do Not Delete");

    return unique(["All Coaches", ...names]).sort((a, b) => a.localeCompare(b));
  }, [safeRows]);

  const programmeOptions = useMemo(() => {
    const all: string[] = [];
    safeRows.forEach((r) => (r.programmes || []).forEach((p) => all.push(p)));

    return unique(["All Programmes", ...all]).sort((a, b) => a.localeCompare(b));
  }, [safeRows]);

  const ratingOptions = useMemo(() => {
    return unique(["All Ratings", ...safeRows.map((r) => r.rating || "Unknown")]);
  }, [safeRows]);

  const organisationOptions = useMemo(() => {
    const set = new Set<string>();

    safeRows.forEach((r) => {
      const students = getStudentsFromRaw(r.raw);
      students.forEach((student: any) => {
        const org = pickOrganisation(student);
        if (org) set.add(org);
      });
    });

    return [ALL_ORGANIZATIONS, ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [safeRows]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();

    safeRows.forEach((r) => {
      const students = getStudentsFromRaw(r.raw);
      students.forEach((student: any) => {
        const status = pickStatus(student);
        if (status) set.add(status);
      });
    });

    const dynamic = Array.from(set).sort((a, b) => a.localeCompare(b));
    return [ALL_STATUSES, ...dynamic];
  }, [safeRows]);

  const riskOptions = ["All", "On track", "At risk", "Overdue", "Unknown"];

  return (
    <div className="bg-card border-b px-6 py-4">
      <div className="flex items-center justify-between mb-3">
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
            <RefreshCcw className="w-3.5 h-3.5" /> Refresh
          </Button>

          <Button size="sm" variant="outline" className="gap-1.5">
            <Settings2 className="w-3.5 h-3.5" /> Thresholds
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Select
          value={filters.programme}
          onValueChange={(v) => onChange({ ...filters, programme: v })}
        >
          <SelectTrigger className="w-[220px] h-9 text-sm">
            <SelectValue placeholder={loading ? "Loading..." : undefined} />
          </SelectTrigger>
          <SelectContent>
            {programmeOptions.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.coach}
          onValueChange={(v) => onChange({ ...filters, coach: v })}
        >
          <SelectTrigger className="w-[190px] h-9 text-sm">
            <SelectValue placeholder={loading ? "Loading..." : undefined} />
          </SelectTrigger>
          <SelectContent>
            {coachOptions.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.rating}
          onValueChange={(v) => onChange({ ...filters, rating: v })}
        >
          <SelectTrigger className="w-[160px] h-9 text-sm">
            <SelectValue placeholder={loading ? "Loading..." : undefined} />
          </SelectTrigger>
          <SelectContent>
            {ratingOptions.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.risk}
          onValueChange={(v) => onChange({ ...filters, risk: v })}
        >
          <SelectTrigger className="w-[150px] h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {riskOptions.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.organisation}
          onValueChange={(v) => onChange({ ...filters, organisation: v })}
        >
          <SelectTrigger className="w-[190px] h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {organisationOptions.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.status}
          onValueChange={(v) => onChange({ ...filters, status: v })}
        >
          <SelectTrigger className="w-[170px] h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
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