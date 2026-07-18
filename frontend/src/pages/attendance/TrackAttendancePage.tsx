import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  Download,
  ExternalLink,
  PhoneCall,
  RefreshCw,
  Search,
  Ticket,
  Users,
} from "lucide-react";

import AppLayout from "@/components/AppLayout";
import BackButton from "@/components/BackButton";
import FilterSelect from "@/components/FilterSelect";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import type { Learner } from "@/types/dashboard";

type AbsenceWindow = "all" | 0 | 1 | 2 | 3;
type FollowUpFilter = "all" | "unresolved" | "contacted" | "resolved";
type AttendanceSortField =
  | "learner"
  | "phone"
  | "organisation"
  | "programme"
  | "group"
  | "coach"
  | "lastSession"
  | "sessionStatus"
  | "totalMissedSessions"
  | "absenceRatio"
  | "called"
  | "emailed"
  | "note"
  | "followUp";
type AttRec = { date: string | null; attendance: unknown; module: string; note?: string };
type ContactActionState = { called: boolean; emailed: boolean; resolved: boolean; note: string };

interface AttendanceSourceRow {
  email: string;
  fullName: string;
  phone?: string;
  organisation?: string;
  aptemProgramme?: string;
  ownerName?: string;
  records: AttRec[];
}

interface TicketInfo {
  id: number;
  ticketRef: string;
  status: string;
  email: string;
  attendanceDate: string;
}

interface AttendanceLearner extends Learner {
  attendanceEmail: string;
  attendanceDate: string;
  attendanceModule: string;
  attendanceContactKey: string;
  coachName: string;
  called: boolean;
  emailed: boolean;
  note: string;
  hasAttendanceInWindow: boolean;
  allRecords: AttRec[];
}

const parseAttendanceDate = (raw: string): Date | null => {
  const value = String(raw || "").trim();
  if (!value) return null;
  const match = value.match(/^(\d{4})[-/\s](\d{2})[-/\s](\d{2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

const formatDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const getExactWeekRange = (weekIndex: 0 | 1 | 2 | 3) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysToMonday = today.getDay() === 0 ? 6 : today.getDay() - 1;
  const start = new Date(today);
  start.setDate(today.getDate() - daysToMonday - weekIndex * 7);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const isDateInExactWeekBucket = (date: Date, weekIndex: 0 | 1 | 2 | 3) => {
  const { start, end } = getExactWeekRange(weekIndex);
  return date >= start && date <= end;
};

const formatUiDate = (date: Date) =>
  date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

const getIsoWeekNumber = (date: Date) => {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
};

const getWeekLabel = (weekIndex: 0 | 1 | 2 | 3) => {
  const { start, end } = getExactWeekRange(weekIndex);
  return `Week ${getIsoWeekNumber(start)} - ${formatUiDate(start)} - ${formatUiDate(end)}`;
};

const formatAttendanceDate = (raw: string) => {
  const date = parseAttendanceDate(raw);
  return date ? formatUiDate(date) : raw || "N/A";
};

const normalizeAttendanceValue = (value: unknown): number | null => {
  if (value === 1 || value === true) return 1;
  if (value === 0 || value === false) return 0;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["1", "present", "attended", "yes", "true"].includes(normalized)) return 1;
  if (["0", "absent", "missed", "no", "false"].includes(normalized)) return 0;
  return null;
};

const safePct = (numerator: number, denominator: number) =>
  !Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0
    ? 0
    : Math.round((numerator / denominator) * 100);

const parseModuleParts = (module: string) => {
  const parts = String(module || "")
    .trim()
    .split(" - ")
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    coach: parts.length >= 2 ? parts[0] : "",
    programme:
      parts.length >= 3
        ? parts.slice(1, -1).join(" - ")
        : parts.length === 2
          ? parts[1]
          : parts[0] || "",
  };
};

const normalizeModuleIdentity = (module: string) => {
  const programme = parseModuleParts(module).programme || module;
  return programme.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
};

const isSameModuleProgramme = (module: string, targetModule: string) => {
  const moduleIdentity = normalizeModuleIdentity(module);
  const targetIdentity = normalizeModuleIdentity(targetModule);
  return Boolean(moduleIdentity && targetIdentity && moduleIdentity === targetIdentity);
};

const normEmail = (value: unknown) => String(value ?? "").trim().toLowerCase();

const isAlternateInstructorException = (record: AttRec) => {
  const note = String(record.note || "").toLowerCase();
  return note.includes("attended with another instructor");
};

const isTrackableAttendanceRecord = (record: AttRec, absenceWindow: AbsenceWindow) => {
  const module = String(record.module || "").trim();
  if (!module || !record.date) return false;
  if (module.toLowerCase().includes("recorded sessions")) return false;
  if (isAlternateInstructorException(record)) return false;

  const date = parseAttendanceDate(record.date);
  return date !== null && isDateInExactWeekBucket(date, absenceWindow);
};

function buildAttendanceMetrics(records: AttRec[], absenceWindow: AbsenceWindow = 0) {
  const empty = {
    absenceRatio: 0,
    missedLast10Weeks: 0,
    missedInRow: 0,
    lastSessionDate: "N/A",
    lastSessionStatus: "Unknown" as Learner["lastSessionStatus"],
    lastSessionModule: "",
    latestProgramme: "Unknown",
    hasAttendanceInWindow: false,
  };
  if (!records.length) return empty;

  const sorted = [...records]
    .filter((record) => record.date != null)
    .sort((a, b) => a.date!.localeCompare(b.date!));
  if (!sorted.length) return empty;

  const filtered =
    absenceWindow === "all"
      ? sorted
      : sorted.filter((record) => {
          const date = parseAttendanceDate(record.date!);
          return date !== null && isDateInExactWeekBucket(date, absenceWindow);
        });

  const hasAttendanceInWindow = filtered.length > 0;
  const source = hasAttendanceInWindow ? filtered : [];
  const last = source[source.length - 1];
  const lastValue = normalizeAttendanceValue(last?.attendance);
  const lastSessionStatus = (
    lastValue == null ? "Unknown" : lastValue === 1 ? "Attended" : "Missed"
  ) as Learner["lastSessionStatus"];

  const tenWeeksAgo = new Date();
  tenWeeksAgo.setHours(0, 0, 0, 0);
  tenWeeksAgo.setDate(tenWeeksAgo.getDate() - 69);
  const missedLast10Weeks = sorted.filter((record) => {
    const date = parseAttendanceDate(record.date!);
    return date !== null && date >= tenWeeksAgo && normalizeAttendanceValue(record.attendance) === 0;
  }).length;

  let missedInRow = 0;
  for (let index = sorted.length - 1; index >= 0; index--) {
    if (normalizeAttendanceValue(sorted[index].attendance) === 0) missedInRow++;
    else break;
  }

  const latestModule = last?.module || "";
  const moduleRecords = latestModule
    ? sorted.filter((record) => isSameModuleProgramme(record.module, latestModule))
    : source;
  const absenceRatio = safePct(
    moduleRecords.filter((record) => normalizeAttendanceValue(record.attendance) === 0).length,
    moduleRecords.length
  );

  return {
    absenceRatio,
    missedLast10Weeks,
    missedInRow,
    lastSessionDate: last?.date || "N/A",
    lastSessionStatus,
    lastSessionModule: latestModule,
    latestProgramme: parseModuleParts(latestModule).programme || "Unknown",
    hasAttendanceInWindow,
  };
}

const getContactPayload = (learner: AttendanceLearner, updates: Partial<ContactActionState>) => ({
  contactKey: learner.attendanceContactKey,
  email: learner.attendanceEmail,
  date: learner.attendanceDate,
  module: learner.attendanceModule,
  called: updates.called ?? learner.called,
  emailed: updates.emailed ?? learner.emailed,
  resolved: updates.resolved ?? Boolean(learner.isResolved),
  note: updates.note ?? learner.note,
});

export default function TrackAttendancePage() {
  const navigate = useNavigate();
  const [attendanceData, setAttendanceData] = useState<AttendanceSourceRow[]>([]);
  const [contactActions, setContactActions] = useState<Record<string, ContactActionState>>({});
  const [tickets, setTickets] = useState<TicketInfo[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [absenceWindow, setAbsenceWindow] = useState<AbsenceWindow>(0);
  const [search, setSearch] = useState("");
  const [programmeFilter, setProgrammeFilter] = useState("all");
  const [coachFilter, setCoachFilter] = useState("all");
  const [organisationFilter, setOrganisationFilter] = useState("all");
  const [followUpFilter, setFollowUpFilter] = useState<FollowUpFilter>("all");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [sortField, setSortField] = useState<AttendanceSortField>("learner");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadTickets = useCallback(async (showLookupLoading = true) => {
    if (showLookupLoading) setTicketsLoading(true);
    try {
      const response = await fetch("/api/attendance-tickets/?archived=false&lookup=true");
      if (!response.ok) return;
      const data: Array<{
        id: number;
        ticketRef: string;
        learnerEmail: string;
        attendanceDate: string | null;
        status: string;
      }> = await response.json();
      setTickets(
        data.map((ticket) => ({
          id: ticket.id,
          ticketRef: ticket.ticketRef,
          status: ticket.status,
          email: normEmail(ticket.learnerEmail),
          attendanceDate: String(ticket.attendanceDate || ""),
        }))
      );
    } catch {
      setTickets([]);
    } finally {
      if (showLookupLoading) setTicketsLoading(false);
    }
  }, []);

  const loadAttendance = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const [attendanceResponse, actionsResponse] = await Promise.all([
        fetch("/api/kbc-attendance/", { cache: "no-store" }),
        fetch("/api/learner-contact-actions/"),
      ]);

      if (attendanceResponse.ok) {
        const data = await attendanceResponse.json();
        setAttendanceData(Array.isArray(data) ? data : []);
      }

      if (actionsResponse.ok) {
        const data = await actionsResponse.json();
        const mapped: Record<string, ContactActionState> = {};
        for (const item of data || []) {
          const key =
            item.contact_key ||
            `${normEmail(item.email)}||${item.date || ""}||${item.module || ""}`;
          mapped[key] = {
            called: Boolean(item.called),
            emailed: Boolean(item.emailed),
            resolved: Boolean(item.resolved),
            note: String(item.note || "").trim(),
          };
        }
        setContactActions(mapped);
      }
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadAttendance(false), loadTickets()]);
    } finally {
      setLoading(false);
    }
  }, [loadAttendance, loadTickets]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    refreshIntervalRef.current = setInterval(
      () => void Promise.all([loadAttendance(false), loadTickets(false)]),
      5000
    );
    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, [loadAttendance, loadTickets]);

  const ticketMaps = useMemo(() => {
    const byAttendance = new Map<string, TicketInfo>();
    const byEmail = new Map<string, TicketInfo>();
    for (const ticket of tickets) {
      if (!ticket.email) continue;
      if (!byEmail.has(ticket.email)) byEmail.set(ticket.email, ticket);
      if (ticket.attendanceDate) {
        const key = `${ticket.email}||${ticket.attendanceDate}`;
        if (!byAttendance.has(key)) byAttendance.set(key, ticket);
      }
    }
    return { byAttendance, byEmail };
  }, [tickets]);

  const attendanceMetrics = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildAttendanceMetrics>>();
    for (const record of attendanceData) {
      const email = normEmail(record.email);
      if (email) map.set(email, buildAttendanceMetrics(record.records || [], absenceWindow));
    }
    return map;
  }, [attendanceData, absenceWindow]);

  const allLearners = useMemo<AttendanceLearner[]>(() => {
    return attendanceData.map((record) => {
      const email = normEmail(record.email);
      const metrics =
        attendanceMetrics.get(email) ?? buildAttendanceMetrics([], absenceWindow);
      const fullName = String(record.fullName || "").trim();
      const nameParts = fullName.split(/\s+/).filter(Boolean);
      const firstName =
        nameParts.slice(0, -1).join(" ") || fullName || "Unknown";
      const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";
      const attendanceDate =
        metrics.lastSessionDate === "N/A" ? "" : metrics.lastSessionDate;
      const attendanceModule = metrics.lastSessionModule;
      const attendanceContactKey = `${email}||${attendanceDate}||${attendanceModule}`;
      const ticket = attendanceDate
        ? ticketMaps.byAttendance.get(`${email}||${attendanceDate}`)
        : ticketMaps.byEmail.get(email);
      const contactState = contactActions[attendanceContactKey] ?? {
        called: false,
        emailed: false,
        resolved: false,
        note: "",
      };
      const phone = String(record.phone || "").trim();
      const organisation = String(record.organisation || "").trim();
      const programme = String(
        record.aptemProgramme || metrics.latestProgramme || ""
      ).trim();
      const coachName = String(record.ownerName || "").trim();

      return {
        id: email,
        firstName,
        lastName,
        email,
        phone,
        whatsapp: phone,
        organisation,
        programme,
        coach: coachName,
        coachName,
        cohort: "",
        status: "Active",
        lineManagerName: "N/A",
        lineManagerPhone: "",
        lineManagerEmail: "",
        startDate: "",
        expectedEndDate: "",
        plannedOtjHours: 0,
        expectedOtjHours: 0,
        actualOtjHours: 0,
        lastSessionDate: metrics.lastSessionDate,
        lastSessionStatus: metrics.lastSessionStatus,
        absenceRatio: metrics.absenceRatio,
        missedLast10Weeks: metrics.missedLast10Weeks,
        missedInRow: metrics.missedInRow,
        riskCategories:
          metrics.missedInRow >= 1 || metrics.absenceRatio >= 25
            ? ["missed-session"]
            : [],
        priority:
          metrics.missedInRow > 2
            ? "critical"
            : metrics.missedInRow >= 1
              ? "high"
              : "normal",
        isResolved: ticket?.status === "resolved",
        attendanceEmail: email,
        attendanceDate,
        attendanceModule,
        attendanceContactKey,
        called: contactState.called,
        emailed: contactState.emailed,
        note: contactState.note,
        hasAttendanceInWindow: metrics.hasAttendanceInWindow,
        allRecords: record.records || [],
      };
    });
  }, [
    absenceWindow,
    attendanceData,
    attendanceMetrics,
    contactActions,
    ticketMaps,
  ]);

  const missedLearners = useMemo(
    () =>
      allLearners.filter(
        (learner) =>
          learner.hasAttendanceInWindow && learner.lastSessionStatus === "Missed"
      ),
    [allLearners]
  );

  const programmes = useMemo(
    () =>
      Array.from(
        new Set(
          allLearners
            .filter((learner) =>
              learner.allRecords.some((record) =>
                isTrackableAttendanceRecord(record, absenceWindow)
              )
            )
            .map((learner) => learner.programme)
            .filter(Boolean)
        )
      ).sort(),
    [absenceWindow, allLearners]
  );
  const coachOptions = useMemo(
    () =>
      Array.from(
        new Set(allLearners.map((learner) => learner.coachName).filter(Boolean))
      )
      .filter((c) => !["default owner", "enrolment team"].includes(c.toLowerCase()))
      .sort(),
    [allLearners]
  );
  const organisations = useMemo(
    () =>
      Array.from(
        new Set(
          allLearners.map((learner) => learner.organisation).filter(Boolean)
        )
      ).sort(),
    [allLearners]
  );

  const moduleOptions = useMemo(
    () => {
      const modulesInWindow = new Set<string>();

      attendanceData.forEach((row) => {
        (row.records || []).forEach((record) => {
          const module = String(record.module || "").trim();
          if (isTrackableAttendanceRecord(record, absenceWindow)) {
            modulesInWindow.add(module);
          }
        });
      });

      return Array.from(modulesInWindow).sort();
    },
    [absenceWindow, attendanceData]
  );

  useEffect(() => {
    if (moduleFilter === "all" || moduleOptions.includes(moduleFilter)) return;
    setModuleFilter("all");
  }, [moduleFilter, moduleOptions]);

  useEffect(() => {
    if (programmeFilter === "all" || programmes.includes(programmeFilter)) return;
    setProgrammeFilter("all");
  }, [programmeFilter, programmes]);

  // Total missed / total sessions for each learner — in the filtered module (or their current module if no filter)
  const missedByModule = useMemo(() => {
    const map = new Map<string, { missed: number; total: number; sessions: { key: string; date: string; missed: boolean; module: string }[] }>();
    for (const learner of allLearners) {
      const courseRecords = learner.allRecords.filter((r) => r.date);
      // Deduplicate by date: if any record on that date is Missed → mark as missed
      const sessions = courseRecords
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map((record, index) => ({
          key: `${record.date}-${index}`,
          date: record.date!,
          missed: normalizeAttendanceValue(record.attendance) === 0,
          module: String(record.module || "Unassigned module").trim() || "Unassigned module",
        }));
      const missed = sessions.filter((s) => s.missed).length;
      map.set(learner.email, { missed, total: sessions.length, sessions });
    }
    return map;
  }, [allLearners]);

  const entityFiltered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return missedLearners.filter((learner) => {
      const fullName = `${learner.firstName} ${learner.lastName}`.trim();
      if (
        query &&
        !fullName.toLowerCase().includes(query) &&
        !learner.email.toLowerCase().includes(query) &&
        !learner.organisation.toLowerCase().includes(query)
      ) {
        return false;
      }
      if (programmeFilter !== "all" && learner.programme !== programmeFilter)
        return false;
      if (coachFilter !== "all" && learner.coachName !== coachFilter) return false;
      if (
        organisationFilter !== "all" &&
        learner.organisation !== organisationFilter
      ) {
        return false;
      }
      if (moduleFilter !== "all" && !isSameModuleProgramme(learner.attendanceModule, moduleFilter))
        return false;
      return true;
    });
  }, [
    coachFilter,
    missedLearners,
    moduleFilter,
    organisationFilter,
    programmeFilter,
    search,
  ]);

  const filteredLearners = useMemo(
    () => {
      const rows = entityFiltered.filter((learner) => {
        if (followUpFilter === "unresolved") return !learner.isResolved;
        if (followUpFilter === "contacted")
          return (learner.called || learner.emailed) && !learner.isResolved;
        if (followUpFilter === "resolved") return Boolean(learner.isResolved);
        return true;
      });

      const textValue = (value: unknown) => String(value ?? "").trim().toLowerCase();
      const phoneValue = (value: unknown) => textValue(value).replace(/\D/g, "");
      const missedValue = (learner: AttendanceLearner) =>
        missedByModule.get(learner.email)?.missed ?? 0;
      const dateValue = (value: unknown) => {
        const parsed = parseAttendanceDate(String(value || ""));
        return parsed ? parsed.getTime() : 0;
      };
      const getSortValue = (learner: AttendanceLearner): string | number => {
        switch (sortField) {
          case "learner":
            return textValue(`${learner.firstName} ${learner.lastName}`);
          case "phone":
            return phoneValue(learner.phone);
          case "organisation":
            return textValue(learner.organisation);
          case "programme":
            return textValue(learner.programme);
          case "group":
            return textValue(learner.attendanceModule);
          case "coach":
            return textValue(learner.coachName);
          case "lastSession":
            return dateValue(learner.attendanceDate || learner.lastSessionDate);
          case "sessionStatus":
            return textValue(learner.lastSessionStatus);
          case "totalMissedSessions":
            return missedValue(learner);
          case "absenceRatio":
            return Number(learner.absenceRatio || 0);
          case "called":
            return learner.called ? 1 : 0;
          case "emailed":
            return learner.emailed ? 1 : 0;
          case "note":
            return textValue(learner.note);
          case "followUp": {
            const email = normEmail(learner.email);
            const ticket = learner.attendanceDate
              ? ticketMaps.byAttendance.get(`${email}||${learner.attendanceDate}`)
              : ticketMaps.byEmail.get(email);
            if (ticket?.status === "resolved") return "2-resolved";
            if (ticket) return "1-open";
            return "0-new";
          }
          default:
            return "";
        }
      };

      return [...rows].sort((a, b) => {
        const av = getSortValue(a);
        const bv = getSortValue(b);
        const direction = sortDir === "asc" ? 1 : -1;

        if (typeof av === "number" && typeof bv === "number") {
          if (av !== bv) return (av - bv) * direction;
        } else {
          const result = String(av).localeCompare(String(bv), undefined, {
            numeric: true,
            sensitivity: "base",
          });
          if (result !== 0) return result * direction;
        }

        return textValue(`${a.firstName} ${a.lastName}`).localeCompare(
          textValue(`${b.firstName} ${b.lastName}`),
          undefined,
          { sensitivity: "base" }
        );
      });
    },
    [entityFiltered, followUpFilter, missedByModule, sortDir, sortField, ticketMaps]
  );

  const autoCreateKeyRef = useRef("");
  useEffect(() => {
    if (loading || missedLearners.length === 0 || absenceWindow === "all") return;

    const { start, end } = getExactWeekRange(absenceWindow);
    const weekKey = `${formatDateKey(start)}_${formatDateKey(end)}`;
    const emailKey = missedLearners
      .map((learner) => normEmail(learner.email))
      .sort()
      .join(",");
    const key = `${weekKey}__${emailKey}`;
    if (autoCreateKeyRef.current === key) return;
    autoCreateKeyRef.current = key;

    const payload = missedLearners.map((learner) => ({
      email: normEmail(learner.email),
      name: `${learner.firstName} ${learner.lastName}`.trim(),
      phone: learner.phone || "",
      organisation: learner.organisation || "",
      programme: learner.programme || "",
      attendance_date: learner.attendanceDate || null,
      attendance_module: learner.attendanceModule || "",
    }));

    fetch("/api/attendance-tickets/auto-create/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        week_start: formatDateKey(start),
        week_end: formatDateKey(end),
        learners: payload,
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.created > 0) void loadTickets(false);
      })
      .catch(() => {});
  }, [absenceWindow, loading, loadTickets, missedLearners]);

  const updateContactAction = useCallback(
    async (payload: {
      contactKey: string;
      email: string;
      date: string;
      module: string;
      called: boolean;
      emailed: boolean;
      resolved: boolean;
      note: string;
    }) => {
      setContactActions((previous) => ({
        ...previous,
        [payload.contactKey]: {
          called: payload.called,
          emailed: payload.emailed,
          resolved: payload.resolved,
          note: payload.note,
        },
      }));
      try {
        const response = await fetch("/api/learner-contact-actions/", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: payload.email,
            date: payload.date,
            module: payload.module,
            called: payload.called,
            emailed: payload.emailed,
            resolved: payload.resolved,
            note: payload.note,
          }),
        });
        if (!response.ok) throw new Error("Failed to update contact action");
      } catch {
        await loadAttendance(false);
      }
    },
    [loadAttendance]
  );

  const openFollowUp = (learner: AttendanceLearner) => {
    if (ticketsLoading) return;
    const email = normEmail(learner.email);
    const ticket = learner.attendanceDate
      ? ticketMaps.byAttendance.get(`${email}||${learner.attendanceDate}`)
      : ticketMaps.byEmail.get(email);
    if (ticket) {
      navigate(`/attendance/tickets?ticket=${ticket.id}`);
      return;
    }

    const params = new URLSearchParams({
      create: "1",
      email: learner.email,
      name: `${learner.firstName} ${learner.lastName}`.trim(),
      phone: learner.phone || "",
      organisation: learner.organisation || "",
      programme: learner.programme || "",
      date: learner.attendanceDate,
    });
    navigate(`/attendance/tickets?${params.toString()}`);
  };

  const toggleSort = (field: AttendanceSortField) => {
    if (sortField === field) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(field);
    setSortDir("asc");
  };

  const sortColumns: Array<{ heading: string; field: AttendanceSortField }> = [
    { heading: "Phone", field: "phone" },
    { heading: "Organisation", field: "organisation" },
    { heading: "Programme", field: "programme" },
    { heading: "Group", field: "group" },
    { heading: "Coach", field: "coach" },
    { heading: "Last Session", field: "lastSession" },
    { heading: "Session Status", field: "sessionStatus" },
    { heading: "Total Missed Sessions", field: "totalMissedSessions" },
    { heading: "Absence Ratio", field: "absenceRatio" },
    { heading: "Called", field: "called" },
    { heading: "Emailed", field: "emailed" },
    { heading: "Note", field: "note" },
    { heading: "Follow-up", field: "followUp" },
  ];

  const renderSortLabel = (heading: string, field: AttendanceSortField) => (
    <button
      type="button"
      onClick={() => toggleSort(field)}
      className="inline-flex w-full items-center gap-1 text-left font-semibold text-[#5F7288] hover:text-[#1E6ACB]"
      aria-label={`Sort by ${heading}`}
    >
      <span>{heading}</span>
      <ArrowUpDown
        className={`h-3.5 w-3.5 shrink-0 ${
          sortField === field ? "text-[#1E6ACB]" : "text-[#8AA0B6]"
        }`}
      />
      {sortField === field && (
        <span className="sr-only">
          {sortDir === "asc" ? "ascending" : "descending"}
        </span>
      )}
    </button>
  );

  const exportCsv = () => {
    const headers = [
      "Learner",
      "Email",
      "Phone",
      "Organisation",
      "Programme",
      "Group",
      "Coach",
      "Last Session",
      "Total Missed Sessions",
      "Absence Ratio",
      "Called",
      "Emailed",
      "Ticket Status",
      "Note",
    ];
    const rows = filteredLearners.map((learner) => [
      `${learner.firstName} ${learner.lastName}`.trim(),
      learner.email,
      learner.phone,
      learner.organisation,
      learner.programme,
      learner.attendanceModule,
      learner.coachName,
      learner.lastSessionDate,
      (() => { const s = missedByModule.get(learner.email); return s ? `${s.missed}/${s.total}` : "—"; })(),
      `${learner.absenceRatio}%`,
      learner.called ? "Yes" : "No",
      learner.emailed ? "Yes" : "No",
      learner.isResolved ? "Resolved" : "Open",
      learner.note,
    ]);
    const csv = [headers, ...rows]
      .map((row) =>
        row
          .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `track-attendance-${String(absenceWindow)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const contactedCount = entityFiltered.filter(
    (learner) => learner.called || learner.emailed
  ).length;
  const resolvedCount = entityFiltered.filter((learner) => learner.isResolved).length;
  const unresolvedCount = entityFiltered.length - resolvedCount;
  const hasFilters =
    search !== "" ||
    programmeFilter !== "all" ||
    coachFilter !== "all" ||
    organisationFilter !== "all" ||
    moduleFilter !== "all" ||
    followUpFilter !== "all";

  const clearFilters = () => {
    setSearch("");
    setProgrammeFilter("all");
    setCoachFilter("all");
    setOrganisationFilter("all");
    setModuleFilter("all");
    setFollowUpFilter("all");
  };

  const weekOptions = [
    { value: "0", label: `This week - ${getWeekLabel(0)}` },
    { value: "1", label: `Previous week - ${getWeekLabel(1)}` },
    { value: "2", label: `2 weeks ago - ${getWeekLabel(2)}` },
    { value: "3", label: `3 weeks ago - ${getWeekLabel(3)}` },
  ];

  return (
    <AppLayout>
      <div className="min-h-full bg-[#F4F8FC]">
        <div className="border-b border-[#DDE7F0] bg-white px-4 pb-5 pt-4 sm:px-6">
          <BackButton to="/attendance" label="Attendance" />
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100">
                <AlertTriangle className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-[#14264A]">
                  Track Attendance
                </h1>
                <p className="mt-0.5 text-sm text-[#5F7288]">
                  Learners with missed sessions and follow-up activity
                </p>
              </div>
            </div>
            <Button
              onClick={() => navigate("/attendance/tickets")}
              className="h-9 gap-1.5 rounded-lg bg-[#14264A] text-white hover:bg-[#184D91]"
            >
              <Ticket className="h-4 w-4" />
              Attendance Tickets
            </Button>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              {
                label: "Missed Session",
                count: entityFiltered.length,
                sub: "in the selected window",
                icon: <AlertTriangle className="h-4 w-4" />,
                classes: "border-blue-200 bg-blue-50 text-blue-900",
              },
              {
                label: "Contacted",
                count: contactedCount,
                sub: "called or emailed",
                icon: <PhoneCall className="h-4 w-4" />,
                classes: "border-teal-200 bg-teal-50 text-teal-900",
              },
              {
                label: "Unresolved",
                count: unresolvedCount,
                sub: "still needs action",
                icon: <Users className="h-4 w-4" />,
                classes: "border-red-200 bg-red-50 text-red-900",
              },
              {
                label: "Resolved",
                count: resolvedCount,
                sub: "follow-up completed",
                icon: <CheckCircle2 className="h-4 w-4" />,
                classes: "border-green-200 bg-green-50 text-green-900",
              },
            ].map(({ label, count, sub, icon, classes }) => (
              <div key={label} className={`rounded-xl border p-3 ${classes}`}>
                <div className="flex items-center gap-2 opacity-75">
                  {icon}
                  <span className="text-xs font-semibold">{label}</span>
                </div>
                <p className="mt-1 text-2xl font-bold">{loading ? "..." : count}</p>
                <p className="text-[11px] opacity-65">{sub}</p>
              </div>
            ))}
          </div>

          <div className="mb-2 flex flex-wrap gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8AA0B6]" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, email, organisation..."
                className="h-10 rounded-lg border-[#D7E5F3] bg-white pl-9 text-sm"
              />
            </div>
            <FilterSelect
              value={programmeFilter}
              onChange={setProgrammeFilter}
              options={[
                { value: "all", label: "All Programmes" },
                ...programmes.map((programme) => ({
                  value: programme,
                  label: programme,
                })),
              ]}
              minWidth={190}
            />
            <FilterSelect
              value={coachFilter}
              onChange={setCoachFilter}
              options={[
                { value: "all", label: "All Coaches" },
                ...coachOptions.map((coach) => ({ value: coach, label: coach })),
              ]}
              minWidth={170}
            />
            <FilterSelect
              value={organisationFilter}
              onChange={setOrganisationFilter}
              options={[
                { value: "all", label: "All Organizations" },
                ...organisations.map((organisation) => ({
                  value: organisation,
                  label: organisation,
                })),
              ]}
              minWidth={190}
            />
            <FilterSelect
              value={moduleFilter}
              onChange={setModuleFilter}
              options={[
                { value: "all", label: "All Modules / Groups" },
                ...moduleOptions.map((mod) => ({
                  value: mod,
                  label: mod,
                })),
              ]}
              minWidth={200}
            />
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <FilterSelect
              value={String(absenceWindow)}
              onChange={(value) =>
                setAbsenceWindow(Number(value) as 0 | 1 | 2 | 3)
              }
              options={weekOptions}
              minWidth={260}
            />
            <FilterSelect
              value={followUpFilter}
              onChange={(value) => setFollowUpFilter(value as FollowUpFilter)}
              options={[
                { value: "all", label: "All Follow-up" },
                { value: "unresolved", label: "Unresolved" },
                { value: "contacted", label: "Contacted" },
                { value: "resolved", label: "Resolved" },
              ]}
              minWidth={165}
            />
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="h-10 rounded-lg border border-[#DDE7F0] bg-white px-3 text-sm text-[#5F7288] hover:bg-[#F0F6FF]"
              >
                Clear Filters
              </button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={refreshAll}
              disabled={loading}
              className="ml-auto h-10 gap-1.5 rounded-lg border-[#DDE7F0] bg-white text-[#24486D]"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportCsv}
              className="h-10 gap-1.5 rounded-lg border-[#DDE7F0] bg-white text-[#24486D]"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
          </div>

          <div className="overflow-hidden rounded-xl border border-[#DDE7F0] bg-white shadow-sm">
            {loading ? (
              <div className="flex h-40 items-center justify-center text-sm text-[#5F7288]">
                Loading learners...
              </div>
            ) : filteredLearners.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-[#5F7288]">
                <CheckCircle2 className="h-8 w-8 text-[#C5D5E3]" />
                <p>No missed attendance learners found</p>
                {hasFilters && (
                  <button
                    onClick={clearFilters}
                    className="text-xs font-semibold text-[#1E6ACB] hover:underline"
                  >
                    Clear all filters
                  </button>
                )}
              </div>
            ) : (
              <div
                className="overflow-auto"
                style={{ maxHeight: "calc(100vh - 365px)" }}
              >
                <table className="min-w-[1450px] w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#DDE7F0] bg-[#F8FBFE]">
                      <th className="sticky left-0 top-0 z-30 min-w-[220px] border-r border-[#DDE7F0] bg-[#F8FBFE] px-3 py-3 text-left text-xs font-semibold text-[#5F7288]">
                        {renderSortLabel("Learner", "learner")}
                      </th>
                      {sortColumns.map(({ heading, field }) => (
                        <th
                          key={heading}
                          className="sticky top-0 z-20 whitespace-nowrap bg-[#F8FBFE] px-3 py-3 text-left text-xs font-semibold text-[#5F7288]"
                        >
                          {renderSortLabel(heading, field)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLearners.map((learner) => {
                      const email = normEmail(learner.email);
                      const ticket = learner.attendanceDate
                        ? ticketMaps.byAttendance.get(
                            `${email}||${learner.attendanceDate}`
                          )
                        : ticketMaps.byEmail.get(email);
                      return (
                        <tr
                          key={learner.id}
                          className="group border-b border-[#F0F4F8] transition-colors hover:bg-[#F8FBFE]"
                        >
                          <td className="sticky left-0 z-10 border-r border-[#DDE7F0] bg-white px-3 py-3 group-hover:bg-[#F8FBFE]">
                            <p className="whitespace-nowrap font-semibold text-[#14264A]">
                              {learner.firstName} {learner.lastName}
                            </p>
                            <p className="text-xs text-[#71849A]">{learner.email}</p>
                          </td>
                          <td className="px-3 py-3 text-xs text-[#5F7288]">
                            {learner.phone || "N/A"}
                          </td>
                          <td className="px-3 py-3 text-xs text-[#5F7288]">
                            {learner.organisation || "N/A"}
                          </td>
                          <td className="px-3 py-3 text-xs text-[#5F7288]">
                            {learner.programme || "N/A"}
                          </td>
                          <td className="px-3 py-3 text-xs text-[#5F7288]">
                            {learner.attendanceModule || "—"}
                          </td>
                          <td className="px-3 py-3 text-xs text-[#5F7288]">
                            {learner.coachName || "Unassigned"}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-xs font-semibold text-[#14264A]">
                            {formatAttendanceDate(learner.attendanceDate)}
                          </td>
                          <td className="px-3 py-3">
                            <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                              <AlertTriangle className="h-3 w-3" />
                              Missed
                            </span>
                          </td>
                          <td className="px-3 py-3 text-center text-xs font-bold text-red-600">
                            {(() => {
                              const s = missedByModule.get(learner.email);
                              if (!s) return <span>—</span>;
                              if (!s.sessions.length) return <span>{s.missed}/{s.total}</span>;
                              const sessionsByModule = s.sessions.reduce(
                                (groups, sess) => {
                                  const module = sess.module || "Unassigned module";
                                  if (!groups.has(module)) groups.set(module, []);
                                  groups.get(module)!.push(sess);
                                  return groups;
                                },
                                new Map<string, typeof s.sessions>()
                              );
                              return (
                                <TooltipProvider delayDuration={200}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="cursor-default underline decoration-dotted decoration-red-400">{s.missed}/{s.total}</span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-[360px] p-0 border border-[#DDE7F0] bg-white shadow-lg rounded-xl overflow-hidden">
                                      <div className="px-3 py-2 border-b border-[#DDE7F0] bg-[#F8FBFE]">
                                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#5F7288]">Sessions by module</p>
                                      </div>
                                      <div className="max-h-[420px] overflow-y-auto px-3 py-2">
                                        {Array.from(sessionsByModule.entries()).map(([module, sessions]) => {
                                          const moduleMissed = sessions.filter((sess) => sess.missed).length;
                                          return (
                                            <div key={module} className="border-b border-[#EDF2F7] py-2 last:border-b-0">
                                              <div className="mb-1.5 flex items-start justify-between gap-3">
                                                <p className="max-w-[245px] text-left text-[11px] font-semibold leading-snug text-[#14264A]">
                                                  {module}
                                                </p>
                                                <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600">
                                                  {moduleMissed}/{sessions.length}
                                                </span>
                                              </div>
                                              <div className="flex flex-col gap-0">
                                                {sessions.map((sess) => (
                                                  <div key={sess.key} className="flex items-center gap-2 py-1">
                                                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${sess.missed ? "bg-red-500" : "bg-emerald-500"}`} />
                                                    <span className={`text-xs ${sess.missed ? "font-semibold text-red-600" : "text-[#3D5166]"}`}>
                                                      {formatAttendanceDate(sess.date)}
                                                    </span>
                                                    <span className={`ml-auto text-[10px] font-medium ${sess.missed ? "text-red-500" : "text-emerald-600"}`}>
                                                      {sess.missed ? "Missed" : "Present"}
                                                    </span>
                                                  </div>
                                                ))}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              );
                            })()}
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={`text-xs font-semibold ${
                                learner.absenceRatio >= 50
                                  ? "text-red-600"
                                  : learner.absenceRatio >= 25
                                    ? "text-amber-600"
                                    : "text-[#5F7288]"
                              }`}
                            >
                              {learner.absenceRatio}%
                            </span>
                          </td>
                          <td
                            className="px-3 py-3"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Checkbox
                              checked={learner.called}
                              onCheckedChange={(checked) =>
                                updateContactAction(
                                  getContactPayload(learner, {
                                    called: Boolean(checked),
                                  })
                                )
                              }
                            />
                          </td>
                          <td
                            className="px-3 py-3"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Checkbox
                              checked={learner.emailed}
                              onCheckedChange={(checked) =>
                                updateContactAction(
                                  getContactPayload(learner, {
                                    emailed: Boolean(checked),
                                  })
                                )
                              }
                            />
                          </td>
                          <td className="max-w-[220px] px-3 py-3 text-xs text-[#5F7288]">
                            <p className="line-clamp-2" title={learner.note}>
                              {learner.note || "No note"}
                            </p>
                          </td>
                          <td
                            className="px-3 py-3"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openFollowUp(learner)}
                              disabled={ticketsLoading}
                              className={`h-7 gap-1 rounded-lg px-2 text-xs font-semibold ${
                                ticketsLoading
                                  ? "border-[#D7E5F3] text-[#71849A]"
                                  : ticket
                                  ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                                  : "border-[#D7E5F3] text-[#1E6ACB] hover:bg-[#EEF7FF]"
                              }`}
                            >
                              {ticketsLoading ? (
                                <>
                                  <RefreshCw className="h-3 w-3 animate-spin" />
                                  Checking...
                                </>
                              ) : ticket ? (
                                <>
                                  <ExternalLink className="h-3 w-3" />
                                  View Ticket
                                </>
                              ) : (
                                <>
                                  <Ticket className="h-3 w-3" />
                                  Open Ticket
                                </>
                              )}
                            </Button>
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
