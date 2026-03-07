import { useState } from "react";
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
}

const priorityBadge = (priority: Learner["priority"]) => {
  switch (priority) {
    case "critical":
      return (
        <Badge className="bg-severity-critical-bg text-severity-critical-foreground border-0 text-[11px]">
          Critical
        </Badge>
      );
    case "high":
      return (
        <Badge className="bg-severity-overdue-bg text-severity-overdue-foreground border-0 text-[11px]">
          High
        </Badge>
      );
    default:
      return null;
  }
};

const calcBehindPct = (learner: Learner) => {
  const expected = Number(learner.expectedOtjHours || 0);
  const actual = Number(learner.actualOtjHours || 0);
  if (expected <= 0) return 0;
  return Math.round(((expected - actual) / expected) * 100);
};

export default function LearnerTable({
  learners,
  kpiCategory,
  onSelectLearner,
}: LearnerTableProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<string>("lastName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const filtered = learners
    .filter((l) => {
      const q = search.toLowerCase();
      return (
        !q ||
        `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) ||
        l.organisation.toLowerCase().includes(q) ||
        l.email.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      let av: any, bv: any;

      if (sortField === "otjBehind") {
        av = calcBehindPct(a);
        bv = calcBehindPct(b);
      } else {
        av = (a as any)[sortField] || "";
        bv = (b as any)[sortField] || "";
      }

      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

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
    const headers = [
      "Name",
      "Organisation",
      "Programme",
      "Coach",
      "Email",
      "Phone",
      "OTJ Planned",
      "OTJ Expected",
      "OTJ Actual",
      "Behind %",
      "Last Progress Review",
    ];

    const rows = filtered.map((l) => [
      `${l.firstName} ${l.lastName}`,
      l.organisation,
      l.programme,
      l.coach,
      l.email,
      l.phone,
      l.plannedOtjHours,
      l.expectedOtjHours,
      l.actualOtjHours,
      `${calcBehindPct(l)}%`,
      l.lastProgressReviewDate || "",
    ]);

    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${kpiCategory}-learners.csv`;
    a.click();
  };

  return (
    <div className="animate-fade-in">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, employer, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex gap-2">
          {selected.size > 0 && (
            <>
              <Button size="sm" variant="outline" className="gap-1.5">
                <Mail className="w-3.5 h-3.5" /> Email {selected.size}
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5">
                <Phone className="w-3.5 h-3.5" /> Call {selected.size}
              </Button>
            </>
          )}

          <Button size="sm" variant="outline" onClick={handleExport} className="gap-1.5">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="bg-card rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
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
                  <th className="p-3 text-right font-medium text-muted-foreground">Expected</th>
                  <th className="p-3 text-right font-medium text-muted-foreground">Actual</th>
                </>
              )}

              {kpiCategory === "missed-session" && (
                <>
                  <th className="p-3 text-left font-medium text-muted-foreground">Last Session</th>
                  <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
                </>
              )}

              {(kpiCategory === "review-due" || kpiCategory === "coaching-due") && (
                <th className="p-3 text-left font-medium text-muted-foreground">Due Date</th>
              )}

              <th className="p-3 text-left font-medium text-muted-foreground">Priority</th>
            </tr>
          </thead>

          <tbody>
            {filtered.map((l) => {
              const behindPct = calcBehindPct(l);

              return (
                <tr
                  key={l.id}
                  className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
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

                  <td className="p-3 font-medium text-foreground">
                    {l.firstName} {l.lastName}
                  </td>

                  <td className="p-3 text-muted-foreground">{l.organisation}</td>
                  <td className="p-3 text-muted-foreground">{l.programme}</td>
                  <td className="p-3 text-muted-foreground">{l.coach}</td>

                  {kpiCategory === "otj-behind" && (
                    <>
                      <td className="p-3 text-right font-semibold">
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
                      <td className="p-3 text-right text-muted-foreground">{l.plannedOtjHours}h</td>
                      <td className="p-3 text-right text-muted-foreground">{l.expectedOtjHours}h</td>
                      <td className="p-3 text-right text-muted-foreground">{l.actualOtjHours}h</td>
                    </>
                  )}

                  {kpiCategory === "missed-session" && (
                    <>
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
                    </>
                  )}

                  {kpiCategory === "review-due" && (
                    <td className="p-3 text-muted-foreground">
                      {l.lastProgressReviewDate || ""}
                    </td>
                  )}

                  {kpiCategory === "coaching-due" && (
                    <td className="p-3 text-muted-foreground">{l.nextMonthlyMeetingDue || ""}</td>
                  )}

                  <td className="p-3">{priorityBadge(l.priority)}</td>
                </tr>
              );
            })}

            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="p-8 text-center text-muted-foreground">
                  No learners found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground mt-2">
        {filtered.length} learner{filtered.length !== 1 ? "s" : ""} • {selected.size} selected
      </p>
    </div>
  );
}