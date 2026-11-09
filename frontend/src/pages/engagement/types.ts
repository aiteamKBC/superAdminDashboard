export type AttentionItem = {
  key: string;
  level: "critical" | "warning" | "review";
  label: string;
};

export type DailyPerformance = {
  date: string;
  calls: number;
  answered: number;
  talkSeconds: number;
};

export type SpecialistPerformance = {
  id: number;
  name: string;
  email: string;
  phone: string;
  account: string;
  dailyTargetMinutes: number;
  workdays: number;
  targetSeconds: number;
  calls: number;
  answered: number;
  notAnswered: number;
  answerRate: number;
  talkSeconds: number;
  targetAttainment: number;
  eventCalls: number;
  learnersReached: number;
  resolved: number;
  openCases: number;
  pendingWorked: number;
  openSlaBreaches: number;
  overdueFollowups: number;
  missingOutcomes: number;
  missingRecordings: number;
  ratedCalls: number;
  badCalls: number;
  sessionsBooked: number;
  emailsSent: number;
  daily: DailyPerformance[];
  attention: AttentionItem[];
};

export type ReportPeriod = {
  value: string;
  label: string;
  from?: string;
  to?: string;
  timezone: string;
  workdays?: number;
};

export type TeamReport = {
  period: ReportPeriod;
  summary: {
    specialists: number;
    calls: number;
    answered: number;
    talkSeconds: number;
    resolved: number;
    openCases: number;
    openSlaBreaches: number;
    overdueFollowups: number;
    needsAttention: number;
  };
  agents: SpecialistPerformance[];
  dataCoverage: {
    verifiedZoomCallsOnly: boolean;
    eventCallsAvailable: boolean;
    recordingsAvailable: boolean;
    callQualityAvailable: boolean;
    notice: string;
  };
};

export type CallCase = {
  id: number;
  reference: string;
  learnerName: string;
  sourceType: string;
  status: string;
  outcome: string;
};

export type EngagementCall = {
  id: number;
  intentId: number | null;
  agentId: number;
  agentName: string;
  learnerEmail: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  result: string;
  callerNumber: string;
  callerName: string;
  calleeNumber: string;
  calleeName: string;
  direction: string;
  eventCall: boolean;
  matched: boolean;
  formSaved: boolean;
  cases: CallCase[];
  outcome: string;
  recordingId: number | null;
  transcriptStatus: string;
  rating: string;
};

export type CallsReport = {
  period: ReportPeriod;
  summary: {
    calls: number;
    answered: number;
    talkSeconds: number;
    missingOutcomes: number;
    missingRecordings: number;
  };
  agents: Array<{ id: number; name: string }>;
  calls: EngagementCall[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
  dataCoverage: { eventCallsAvailable: boolean; recordingsAvailable: boolean };
};

export type CallTranscript = {
  recordingId: number;
  callId: number;
  status: string;
  text: string;
  error: string;
  checkedAt: string | null;
  startedAt: string | null;
};

export type SpecialistCase = {
  id: number;
  reference: string;
  sourceType: string;
  learnerName: string;
  learnerEmail: string;
  coach: string;
  status: string;
  risk: string;
  dueAt: string | null;
  nextFollowupAt: string | null;
  slaBreached: boolean;
  attempts: number;
  lastActivityAt: string | null;
  owned: boolean;
};

export type SpecialistDetail = {
  period: ReportPeriod;
  agent: SpecialistPerformance;
  openCases: SpecialistCase[];
  linkedCasesTotal: number;
  recentCalls: EngagementCall[];
  activity: Array<{
    id: number;
    kind: string;
    actor: string;
    createdAt: string;
    caseId: number;
    learnerName: string;
    sourceType: string;
  }>;
  dataCoverage: TeamReport["dataCoverage"];
};
