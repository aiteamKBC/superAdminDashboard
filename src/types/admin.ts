import { KpiCategory } from './dashboard';

export interface Coordinator {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  caseloadSize: number;
  workload: 'light' | 'normal' | 'heavy';
  kpiBreakdown: Record<KpiCategory, number>; // % of caseload flagged
}

export interface LearnerAssignment {
  id: string;
  learnerId: string;
  coordinatorId: string;
  assignedDate: string;
  assignedBy: string;
  reassignmentReason?: string;
}

export interface AssignmentAuditEntry {
  id: string;
  learnerId: string;
  fromCoordinatorId: string | null;
  toCoordinatorId: string;
  adminUserId: string;
  adminUserName: string;
  dateTime: string;
  reason: string;
}

export interface CoordinatorPerformance {
  coordinatorId: string;
  coordinatorName: string;
  assignedCaseload: number;
  callsMade: number;
  answeredCalls: number;
  notAnswered: number;
  emailsSent: number;
  escalationsLM: number;
  escalationsHR: number;
  appointmentsBooked: number;
  resolutionCount: number;
  resolutionRate: number;
  slaCompliance: number; // % contacted within 2 working days
  avgTimeToFirstContact: number; // hours
  avgTimeToResolution: number; // hours
  outcomeBreakdown: {
    bookedAppointment: number;
    emailedDetails: number;
    escalated: number;
    noAnswer: number;
    other: number;
  };
  caseloadHealth: {
    missedSession: number;
    reviewDue: number;
    coachingDue: number;
    otjBehind: number;
    highPriority: number;
  };
  ageingBuckets: {
    '0-2': number;
    '3-7': number;
    '8-14': number;
    '15+': number;
  };
}
