import { useMemo, useState } from "react";
import { Learner, KpiCategory } from "@/types/dashboard";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Download, Phone, Mail, ArrowUpDown } from "lucide-react";

interface LearnerTableProps {
  learners: Learner[];
  kpiCategory: KpiCategory;
  onSelectLearner: (learner: Learner) => void;
  sessionTypeFilter?: "All Session Types" | "Progress Review" | "MCM" | "Support Session";
  onSessionTypeFilterChange?: (
    value: "All Session Types" | "Progress Review" | "MCM" | "Support Session"
  ) => void;
  onUpdateContactAction?: (payload: {
    contactKey: string;
    email: string;
    date: string;
    module: string;
    called: boolean;
    emailed: boolean;
    resolved: boolean;
    note: string;
  }) => void;
}

const SESSION_TYPE_OPTIONS = [
  "All Session Types",
  "Progress Review",
  "MCM",
  "Support Session",
] as const;

const priorityBadge = (priority: Learner["priority"]) => {
  switch (priority) {
    case "critical":
      return (
        <Badge className="pointer-events-none bg-severity-critical-bg text-severity-critical-foreground border-0 text-[11px]">
          Critical
        </Badge>
      );
    case "high":
      return (
        <Badge className="pointer-events-none bg-severity-overdue-bg text-severity-overdue-foreground border-0 text-[11px]">
          High
        </Badge>
      );
    default:
      return null;
  }
};

const otjPriorityBadge = (priority: string) => {
  switch (priority) {
    case "at-risk":
      return (
        <Badge className="bg-severity-critical-bg text-severity-critical-foreground border-0 text-[11px]">
          At Risk
        </Badge>
      );
    case "need-attention":
      return (
        <Badge className="bg-severity-overdue-bg text-severity-overdue-foreground border-0 text-[11px]">
          Need Attention
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-[11px]">
          Normal
        </Badge>
      );
  }
};

const calcBehindPct = (learner: Learner) => {
  const stored = Number((learner as any).otjBehindPct);
  if (Number.isFinite(stored)) return Math.abs(stored);

  const expected = Number(learner.expectedOtjHours || 0);
  const actual = Number(learner.actualOtjHours || 0);
  if (expected <= 0) return 0;

  return Math.abs(Math.round(((expected - actual) / expected) * 100));
};

const getRequiredHoursToSubmit = (learner: Learner) =>
  String((learner as any).requiredHoursToSubmit || "N/A");

const splitNoteParts = (noteValue: unknown) => {
  const note = String(noteValue || "").trim();
  if (!note) return { outcome: "", details: "" };

  const parts = note.split(" | ").map((part) => part.trim()).filter(Boolean);

  if (parts.length >= 2) {
    return {
      outcome: parts[0],
      details: parts.slice(1).join(" | "),
    };
  }

  return {
    outcome: note,
    details: "",
  };
};

export default function LearnerTable({
  learners,
  kpiCategory,
  onSelectLearner,
  sessionTypeFilter = "All Session Types",
  onSessionTypeFilterChange,
  onUpdateContactAction,
}: LearnerTableProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<string>("lastName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    const data = learners
      .filter((l) => {
        const sessionType =
          kpiCategory === "coaching-booked"
            ? String((l as any).anyBookedSessionType || "Unknown").toLowerCase()
            : String((l as any).monthlyCoachingSessionType || "Unknown").toLowerCase();

        const sessionDate =
          kpiCategory === "coaching-booked"
            ? String((l as any).anyBookedSessionDate || "").toLowerCase()
            : String((l as any).monthlyCoachingSessionDate || "").toLowerCase();

        const serviceName = String((l as any).anyBookedServiceName || "").toLowerCase();
        const groupName = String((l as any).anyBookedGroupName || "").toLowerCase();

        const phone = String(l.phone || "").toLowerCase();
        const requiredHoursToSubmit = getRequiredHoursToSubmit(l).toLowerCase();
        const note = String((l as any).note || "").toLowerCase();

        const matchesSearch =
          !q ||
          `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) ||
          String(l.organisation || "").toLowerCase().includes(q) ||
          String(l.email || "").toLowerCase().includes(q) ||
          phone.includes(q) ||
          String(l.programme || "").toLowerCase().includes(q) ||
          String(l.coach || "").toLowerCase().includes(q) ||
          sessionType.includes(q) ||
          sessionDate.includes(q) ||
          serviceName.includes(q) ||
          groupName.includes(q) ||
          requiredHoursToSubmit.includes(q) ||
          note.includes(q);

        return matchesSearch;
      })

      .sort((a, b) => {
        let av: any;
        let bv: any;

        if (sortField === "otjBehind") {
          av = calcBehindPct(a);
          bv = calcBehindPct(b);
        } else if (sortField === "sessionType") {
          av =
            kpiCategory === "coaching-booked"
              ? String((a as any).anyBookedSessionType || "")
              : String((a as any).monthlyCoachingSessionType || "");

          bv =
            kpiCategory === "coaching-booked"
              ? String((b as any).anyBookedSessionType || "")
              : String((b as any).monthlyCoachingSessionType || "");
        } else if (sortField === "sessionDate") {
          av =
            kpiCategory === "coaching-booked"
              ? String((a as any).anyBookedSessionDate || "")
              : String((a as any).monthlyCoachingSessionDate || "");

          bv =
            kpiCategory === "coaching-booked"
              ? String((b as any).anyBookedSessionDate || "")
              : String((b as any).monthlyCoachingSessionDate || "");
        } else {
          av = (a as any)[sortField] || "";
          bv = (b as any)[sortField] || "";
        }

        if (av < bv) return sortDir === "asc" ? -1 : 1;
        if (av > bv) return sortDir === "asc" ? 1 : -1;
        return 0;
      });

    return data;
  }, [learners, search, sessionTypeFilter, sortField, sortDir, kpiCategory]);

  const getRowKey = (l: Learner) => {
    const anyLearner = l as any;

    return [
      kpiCategory,
      l.id,
      anyLearner.attendanceContactKey || "",
      anyLearner.anyBookedSessionType || "",
      anyLearner.anyBookedSessionDate || "",
      anyLearner.anyBookedServiceName || "",
    ].join("::");
  };

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((l) => l.id)));
  };

  const handleExport = () => {
    let headers: string[] = [];
    let rows: any[][] = [];

    if (kpiCategory === "coaching-booked") {
      headers = [
        "Name",
        "Phone",
        "Organisation",
        "Programme",
        "Coach",
        "Session Type",
        "Session Date",
        "Service Name",
      ];

      rows = filtered.map((l) => [
        `${l.firstName} ${l.lastName}`,
        l.phone || "N/A",
        l.organisation,
        l.programme,
        l.coach,
        (l as any).anyBookedSessionType || "Unknown",
        (l as any).anyBookedSessionDate || "N/A",
        (l as any).anyBookedServiceName || "N/A",
      ]);
    } else if (kpiCategory === "review-due") {
      headers = [
        "Name",
        "Phone",
        "Organisation",
        "Programme",
        "Coach",
        "Email",
        "Last Progress Review",
        "Next PR",
        "No. of overdue PR",
        "Booked Date",
        "Review Status",
      ];

      rows = filtered.map((l) => [
        `${l.firstName} ${l.lastName}`,
        l.phone || "N/A",
        l.organisation,
        l.programme,
        l.coach,
        l.email,
        l.lastProgressReviewDate || "N/A",
        (l as any).nextPrDate || (l as any).nextProgressReviewDue || "N/A",
        Number((l as any).overduePrCount ?? 0),
        (l as any).bookedPrDate || "N/A",
        (l as any).reviewStatusLabel || "Normal",
      ]);
    } else if (kpiCategory === "otj-behind") {
      headers = [
        "Name",
        "Phone",
        "Organisation",
        "Programme",
        "Coach",
        "Email",
        "Behind %",
        "Planned",
        "Completed",
        "Required Hours to submit",
        "Last Progress Review",
      ];

      rows = filtered.map((l) => [
        `${l.firstName} ${l.lastName}`,
        l.phone || "N/A",
        l.organisation,
        l.programme,
        l.coach,
        l.email,
        `${calcBehindPct(l)}%`,
        l.plannedOtjHours,
        l.actualOtjHours,
        getRequiredHoursToSubmit(l),
        l.lastProgressReviewDate || "",
      ]);
    } else if (kpiCategory === "missed-session") {
      headers = [
        "Name",
        "Phone",
        "Called",
        "Emailed",
        "Resolved",
        "Note",
        "Booked Meeting",
        "Organisation",
        "Programme",
        "Coach",
        "Last Session",
        "Status",
        "Priority",
      ];

      rows = filtered.map((l) => [
        `${l.firstName} ${l.lastName}`,
        l.phone || "N/A",
        Boolean((l as any).called) ? "Yes" : "No",
        Boolean((l as any).emailed) ? "Yes" : "No",
        Boolean((l as any).isResolved) ? "Yes" : "No",
        String((l as any).note || ""),
        Boolean((l as any).anyBooked) ? String((l as any).anyBookedSessionDate || "") : "",
        l.organisation,
        l.programme,
        l.coach,
        l.lastSessionDate || "N/A",
        l.lastSessionStatus || "Unknown",
        l.priority || "",
      ]);
    } else if (kpiCategory === "coaching-due") {
      headers = [
        "Name",
        "Phone",
        "Organisation",
        "Programme",
        "Coach",
        "Email",
        "Due Date",
      ];

      rows = filtered.map((l) => [
        `${l.firstName} ${l.lastName}`,
        l.phone || "N/A",
        l.organisation,
        l.programme,
        l.coach,
        l.email,
        String((l as any).nextMonthlyMeetingDue || "Due"),
      ]);
    }

    const csv = [headers, ...rows]
      .map((r) => r.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${kpiCategory}-learners.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const colSpan =
    kpiCategory === "otj-behind"
      ? 11
      : kpiCategory === "missed-session"
        ? 14
        : kpiCategory === "review-due"
          ? 12
          : kpiCategory === "coaching-due"
            ? 8
            : kpiCategory === "coaching-booked"
              ? 9
              : 7;

  return (
    <div className="animate-fade-in rounded-2xl border border-[#E8E8E8] bg-white p-3 sm:p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-[360px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A8A8A]" />
            <Input
              type="search"
              name="learner_lookup"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Search by name, employer, email, phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 rounded-xl border-[#E4E4E4] bg-[#FFFFFF] pl-10 pr-4 text-sm text-[#4C4C4C] placeholder:text-[#A0A0A0] focus-visible:ring-2 focus-visible:ring-[#B27715]/20 focus-visible:border-[#B27715]"
            />
          </div>

          {kpiCategory === "coaching-booked" && (
            <select
              value={sessionTypeFilter}
              onChange={(e) =>
                onSessionTypeFilterChange?.(
                  e.target.value as "All Session Types" | "Progress Review" | "MCM" | "Support Session"
                )
              }
              className="h-11 w-full rounded-xl border border-[#E4E4E4] bg-white px-3 text-sm text-[#4C4C4C] outline-none sm:w-auto sm:min-w-[220px]"
            >
              {SESSION_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:justify-end">
          {selected.size > 0 && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-11 gap-1.5 rounded-xl border-[#E4E4E4] bg-white text-[#644D93] hover:bg-[#FCF3FF] hover:text-[#644D93]"
              >
                <Mail className="h-3.5 w-3.5" />
                Email {selected.size}
              </Button>

              <Button
                size="sm"
                variant="outline"
                className="h-11 gap-1.5 rounded-xl border-[#E4E4E4] bg-white text-[#B27715] hover:bg-[#FFF8EE] hover:text-[#B27715]"
              >
                <Phone className="h-3.5 w-3.5" />
                Call {selected.size}
              </Button>
            </>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={handleExport}
            className="h-11 gap-1.5 rounded-xl border-[#E4E4E4] bg-[#FCF3FF] text-[#866CB6] hover:bg-[#F7ECFF] hover:text-[#644D93]"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#ECECEC] bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full text-sm">
            <thead>
              <tr className="border-b border-[#F0F0F0] bg-[#FAF7FC]">
                <th className="p-3 w-10">
                  <Checkbox
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onCheckedChange={toggleAll}
                  />
                </th>

                <th
                  className="p-3 text-left font-medium text-muted-foreground cursor-pointer"
                  onClick={() => toggleSort("lastName")}
                >
                  <span className="flex items-center gap-1">
                    Learner <ArrowUpDown className="w-3 h-3" />
                  </span>
                </th>

                <th className="px-4 py-3 text-left text-[13px] font-semibold text-[#8A8A8A]">
                  Learner Phone
                </th>

                {kpiCategory === "missed-session" && (
                  <>
                    <th className="px-4 py-3 text-left text-[13px] font-semibold text-[#8A8A8A]">Called</th>
                    <th className="px-4 py-3 text-left text-[13px] font-semibold text-[#8A8A8A]">Emailed</th>
                    <th className="px-4 py-3 text-left text-[13px] font-semibold text-[#8A8A8A]">Resolved</th>
                    <th className="px-4 py-3 text-left text-[13px] font-semibold text-[#8A8A8A]">Note</th>
                    <th className="px-4 py-3 text-left text-[13px] font-semibold text-[#8A8A8A]">Booked Meeting</th>
                  </>
                )}

                <th className="p-3 text-left font-medium text-muted-foreground">Organisation</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Programme</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Coach</th>

                {kpiCategory === "otj-behind" && (
                  <>
                    <th
                      className="p-3 text-right font-medium text-muted-foreground cursor-pointer"
                      onClick={() => toggleSort("otjBehind")}
                    >
                      <span className="flex items-center gap-1 justify-end">
                        Behind % <ArrowUpDown className="w-3 h-3" />
                      </span>
                    </th>
                    <th className="p-3 text-right font-medium text-muted-foreground">Planned</th>
                    <th className="p-3 text-right font-medium text-muted-foreground">Completed</th>
                    <th className="p-3 text-right font-medium text-muted-foreground">
                      Required Hours to submit
                    </th>
                  </>
                )}

                {kpiCategory === "missed-session" && (
                  <>
                    <th className="p-3 text-left font-medium text-muted-foreground">Last Session</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
                  </>
                )}

                {kpiCategory === "review-due" && (
                  <>
                    <th className="p-3 text-left font-medium text-muted-foreground">Last Progress Review</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Next PR</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">No. of overdue PR</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Booked Date</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Review Status</th>
                  </>
                )}

                {kpiCategory === "coaching-due" && (
                  <th className="p-3 text-left font-medium text-muted-foreground">Due Date</th>
                )}

                {kpiCategory === "coaching-booked" && (
                  <>
                    <th
                      className="p-3 text-left font-medium text-muted-foreground cursor-pointer"
                      onClick={() => toggleSort("sessionType")}
                    >
                      <span className="flex items-center gap-1">
                        Session Type <ArrowUpDown className="w-3 h-3" />
                      </span>
                    </th>

                    <th
                      className="p-3 text-left font-medium text-muted-foreground cursor-pointer"
                      onClick={() => toggleSort("sessionDate")}
                    >
                      <span className="flex items-center gap-1">
                        Session Date <ArrowUpDown className="w-3 h-3" />
                      </span>
                    </th>

                    <th className="p-3 text-left font-medium text-muted-foreground">Service Name</th>
                  </>
                )}

                {kpiCategory === "review-booked" && (
                  <th className="p-3 text-left font-medium text-muted-foreground">Booked PR Date</th>
                )}

                {kpiCategory !== "coaching-booked" && kpiCategory !== "review-due" && kpiCategory !== "review-booked" && (
                  <th className="p-3 text-left font-medium text-muted-foreground">Priority</th>
                )}
              </tr>
            </thead>

            <tbody>
              {filtered.map((l) => {
                const behindPct = calcBehindPct(l);
                const noteParts = splitNoteParts((l as any).note);

                if (kpiCategory === "missed-session") {
                  return (
                    <tr
                      key={getRowKey(l)}
                      className="cursor-pointer border-b border-[#F4F4F4] transition-colors hover:bg-[#FCFCFC]"
                      onClick={() => onSelectLearner(l)}
                    >
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(l.id)}
                          onCheckedChange={() => {
                            const next = new Set(selected);
                            next.has(l.id) ? next.delete(l.id) : next.add(l.id);
                            setSelected(next);
                          }}
                        />
                      </td>

                      <td className="px-4 py-3.5 font-medium text-[#505050]">
                        <div className="flex items-center gap-2">
                          {l.firstName} {l.lastName}
                          {(l as any).isResolved && (
                            <Badge className="border-0 bg-green-100 text-green-700 text-[11px]">
                              Resolved
                            </Badge>
                          )}
                        </div>
                      </td>

                      <td className="p-3 text-muted-foreground">{l.phone || "N/A"}</td>

                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={Boolean((l as any).called)}
                          onCheckedChange={(checked) => {
                            onUpdateContactAction?.({
                              contactKey: String((l as any).attendanceContactKey || ""),
                              email: String((l as any).attendanceEmail || ""),
                              date: String((l as any).attendanceDate || ""),
                              module: String((l as any).attendanceModule || ""),
                              called: Boolean(checked),
                              emailed: Boolean((l as any).emailed),
                              resolved: Boolean((l as any).isResolved),
                              note: String((l as any).note || ""),
                            });
                          }}
                        />
                      </td>

                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={Boolean((l as any).emailed)}
                          onCheckedChange={(checked) => {
                            onUpdateContactAction?.({
                              contactKey: String((l as any).attendanceContactKey || ""),
                              email: String((l as any).attendanceEmail || ""),
                              date: String((l as any).attendanceDate || ""),
                              module: String((l as any).attendanceModule || ""),
                              called: Boolean((l as any).called),
                              emailed: Boolean(checked),
                              resolved: Boolean((l as any).isResolved),
                              note: String((l as any).note || ""),
                            });
                          }}
                        />
                      </td>

                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={Boolean((l as any).isResolved)}
                          onCheckedChange={(checked) => {
                            onUpdateContactAction?.({
                              contactKey: String((l as any).attendanceContactKey || ""),
                              email: String((l as any).attendanceEmail || ""),
                              date: String((l as any).attendanceDate || ""),
                              module: String((l as any).attendanceModule || ""),
                              called: Boolean((l as any).called),
                              emailed: Boolean((l as any).emailed),
                              resolved: Boolean(checked),
                              note: String((l as any).note || ""),
                            });
                          }}
                        />
                      </td>

                      <td className="p-3 min-w-[240px] max-w-[280px]" onClick={(e) => e.stopPropagation()}>
                        {String((l as any).note || "").trim() ? (
                          <div className="flex flex-col gap-1">
                            <span className="inline-flex w-fit rounded-full bg-[#FFF8EE] px-2 py-1 text-[11px] font-medium text-[#B27715]">
                              {noteParts.outcome || "Logged"}
                            </span>
                            {noteParts.details ? (
                              <p
                                className="text-xs text-[#7C7C7C] line-clamp-2"
                                title={noteParts.details}
                              >
                                {noteParts.details}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-xs text-[#A0A0A0]">No log</span>
                        )}
                      </td>

                      <td className="p-3 min-w-[140px]" onClick={(e) => e.stopPropagation()}>
                        {Boolean((l as any).anyBooked) && String((l as any).anyBookedSessionDate || "").trim() ? (
                          <Badge className="rounded-full border-0 bg-[#FCF3FF] px-3 py-1 text-[11px] font-medium text-[#866CB6]">
                            {String((l as any).anyBookedSessionDate)}
                          </Badge>
                        ) : (
                          <span className="text-xs text-[#A0A0A0]">Not booked</span>
                        )}
                      </td>

                      <td className="px-4 py-3.5 text-[#7C7C7C]">{l.organisation}</td>
                      <td className="p-3 text-muted-foreground">{l.programme}</td>
                      <td className="p-3 text-muted-foreground">{l.coach}</td>
                      <td className="p-3 text-muted-foreground">{l.lastSessionDate}</td>

                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={
                            l.lastSessionStatus === "Attended"
                              ? "text-[11px] border-emerald-300 text-emerald-700 bg-emerald-50"
                              : l.lastSessionStatus === "Missed"
                                ? "text-[11px] border-rose-300 text-rose-700 bg-rose-50"
                                : "text-[11px] border-slate-300 text-slate-600 bg-slate-50"
                          }
                        >
                          {l.lastSessionStatus}
                        </Badge>
                      </td>

                      <td className="p-3">{priorityBadge(l.priority)}</td>
                    </tr>
                  );
                }

                if (kpiCategory === "coaching-booked") {
                  return (
                    <tr
                      key={getRowKey(l)}
                      className="cursor-pointer border-b border-[#F4F4F4] transition-colors hover:bg-[#FCFCFC]"
                      onClick={() => onSelectLearner(l)}
                    >
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(l.id)}
                          onCheckedChange={() => {
                            const next = new Set(selected);
                            next.has(l.id) ? next.delete(l.id) : next.add(l.id);
                            setSelected(next);
                          }}
                        />
                      </td>

                      <td className="px-4 py-3.5 font-medium text-[#505050]">
                        {l.firstName} {l.lastName}
                      </td>
                      <td className="p-3 text-muted-foreground">{l.phone || "N/A"}</td>
                      <td className="px-4 py-3.5 text-[#7C7C7C]">{l.organisation}</td>
                      <td className="p-3 text-muted-foreground">{l.programme}</td>
                      <td className="p-3 text-muted-foreground">{l.coach}</td>
                      <td className="p-3 text-muted-foreground">
                        {String((l as any).anyBookedSessionType || "Unknown")}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {String((l as any).anyBookedSessionDate || "N/A")}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {String((l as any).anyBookedServiceName || "N/A")}
                      </td>
                    </tr>
                  );
                }

                if (kpiCategory === "review-booked") {
                  return (
                    <tr
                      key={getRowKey(l)}
                      className="cursor-pointer border-b border-[#F4F4F4] transition-colors hover:bg-[#FCFCFC]"
                      onClick={() => onSelectLearner(l)}
                    >
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(l.id)}
                          onCheckedChange={() => {
                            const next = new Set(selected);
                            next.has(l.id) ? next.delete(l.id) : next.add(l.id);
                            setSelected(next);
                          }}
                        />
                      </td>
                      <td className="px-4 py-3.5 font-medium text-[#505050]">
                        {l.firstName} {l.lastName}
                      </td>
                      <td className="p-3 text-muted-foreground">{l.phone || "N/A"}</td>
                      <td className="px-4 py-3.5 text-[#7C7C7C]">{l.organisation}</td>
                      <td className="p-3 text-muted-foreground">{l.programme}</td>
                      <td className="p-3 text-muted-foreground">{l.coach}</td>
                      <td className="p-3 min-w-[140px]">
                        {(l as any).bookedPrDate ? (
                          <Badge className="rounded-full border-0 bg-[#FFF8EE] px-3 py-1 text-[11px] font-medium text-[#b27715]">
                            {(l as any).bookedPrDate}
                          </Badge>
                        ) : (
                          <span className="text-xs text-[#A0A0A0]">N/A</span>
                        )}
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr
                    key={getRowKey(l)}
                    className="cursor-pointer border-b border-[#F4F4F4] transition-colors hover:bg-[#FCFCFC]"
                    onClick={() => onSelectLearner(l)}
                  >
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(l.id)}
                        onCheckedChange={() => {
                          const next = new Set(selected);
                          next.has(l.id) ? next.delete(l.id) : next.add(l.id);
                          setSelected(next);
                        }}
                      />
                    </td>

                    <td className="px-4 py-3.5 font-medium text-[#505050]">
                      <div className="flex items-center gap-2">
                        {l.firstName} {l.lastName}
                        {(l as any).isResolved && (
                          <Badge className="border-0 bg-green-100 text-green-700 text-[11px]">
                            Resolved
                          </Badge>
                        )}
                      </div>
                    </td>

                    <td className="p-3 text-muted-foreground">{l.phone || "N/A"}</td>
                    <td className="px-4 py-3.5 text-[#7C7C7C]">{l.organisation}</td>
                    <td className="p-3 text-muted-foreground">{l.programme}</td>
                    <td className="p-3 text-muted-foreground">{l.coach}</td>

                    {kpiCategory === "otj-behind" && (
                      <>
                        <td className="p-3 text-center font-semibold">
                          <span
                            className={
                              behindPct > 40
                                ? "text-severity-critical"
                                : behindPct > 20
                                  ? "text-severity-overdue"
                                  : "text-foreground"
                            }
                          >
                            {behindPct}%
                          </span>
                        </td>
                        <td className="p-3 text-center text-muted-foreground">{l.plannedOtjHours}h</td>
                        <td className="p-3 text-center text-muted-foreground">{l.actualOtjHours}h</td>
                        <td className="p-3 text-center text-muted-foreground">
                          {getRequiredHoursToSubmit(l)}
                        </td>
                      </>
                    )}

                    {kpiCategory === "review-due" && (
                      <>
                        <td className="p-3 text-muted-foreground">{l.lastProgressReviewDate || "N/A"}</td>

                        <td className="p-3 text-muted-foreground">
                          {(l as any).nextPrDate
                            ? `${(l as any).nextPrDate}${(l as any).nextPrState ? ` (${(l as any).nextPrState})` : ""}`
                            : "N/A"}
                        </td>

                        <td className="p-3 text-muted-foreground">
                          {Number((l as any).overduePrCount ?? 0)}
                        </td>

                        <td className="p-3 min-w-[140px]">
                          {(l as any).bookedPrDate && (l as any).bookedPrDate !== "N/A" ? (
                            <Badge className="rounded-full border-0 bg-[#FCF3FF] px-3 py-1 text-[11px] font-medium text-[#866CB6]">
                              {(l as any).bookedPrDate}
                            </Badge>
                          ) : (
                            <span className="text-xs text-[#A0A0A0]">Not booked</span>
                          )}
                        </td>

                        <td className="p-3">
                          <Badge
                            className={
                              (l as any).reviewStatusTone === "due"
                                ? "border-0 bg-severity-critical-bg text-severity-critical-foreground text-[11px]"
                                : (l as any).reviewStatusTone === "at-risk"
                                  ? "border-0 bg-severity-overdue-bg text-severity-overdue-foreground text-[11px]"
                                  : (l as any).reviewStatusTone === "ahead"
                                    ? "border-0 bg-emerald-100 text-emerald-700 text-[11px]"
                                    : "border-0 bg-slate-100 text-slate-700 text-[11px]"
                            }
                          >
                            {(l as any).reviewStatusLabel || "Normal"}
                          </Badge>
                        </td>
                      </>
                    )}

                    {kpiCategory === "coaching-due" && (
                      <td className="px-4 py-3.5">
                        <Badge className="rounded-full border-0 bg-[#FFF8EE] px-3 py-1 text-[11px] font-medium text-[#B27715]">
                          {String((l as any).nextMonthlyMeetingDue || "Due")}
                        </Badge>
                      </td>
                    )}

                    {kpiCategory !== "review-due" && (
                      <td className="p-3">
                        {kpiCategory === "otj-behind"
                          ? otjPriorityBadge(String((l as any).otjPriority || "normal"))
                          : priorityBadge(l.priority)}
                      </td>
                    )}
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="p-8 text-center text-muted-foreground">
                    No learners found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs text-[#8C8C8C]">
          {filtered.length} learner{filtered.length !== 1 ? "s" : ""} • {selected.size} selected
        </p>
      </div>
    </div>
  );
}