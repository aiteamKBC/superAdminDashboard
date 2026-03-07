export type LearnerStatus = 'Active' | 'Break in Learning' | 'Withdrawn';
export type SessionStatus = 'Attended' | 'Missed' | 'No Show' | 'Cancelled by learner late' | 'Cancelled by provider' | 'Scheduled';
export type CallOutcome = 
  | 'Sent email with details'
  | 'Booked an appointment with the coach'
  | 'Escalated to line manager'
  | 'Escalated to HR'
  | 'No answer – voicemail left'
  | 'No answer – will try again'
  | 'Other (specify)';

export interface Learner {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  whatsapp: string;
  organisation: string;
  programme: string;
  coach: string;
  cohort: string;
  status: LearnerStatus;
  lineManagerName: string;
  lineManagerPhone: string;
  lineManagerEmail: string;
  hrManagerName?: string;
  hrManagerPhone?: string;
  hrManagerEmail?: string;
  startDate: string;
  expectedEndDate: string;
  // OTJ
  plannedOtjHours: number;
  expectedOtjHours: number;
  actualOtjHours: number;
  // Dates
  lastSessionDate?: string;
  lastSessionStatus?: SessionStatus;
  // Progress Review
  lastProgressReviewDate?: string;
  nextProgressReviewDue?: string;
  progressReviewBooked?: boolean;
  // Monthly Coaching Meeting
  lastMonthlyMeetingDate?: string;
  nextMonthlyMeetingDue?: string;
  monthlyMeetingBooked?: boolean;
  // Absence metrics
  absenceRatio: number; // percentage of sessions missed overall
  missedLast10Weeks: number; // sessions missed in last 10 weeks
  missedInRow: number; // consecutive sessions missed
  // KPI flags
  riskCategories: KpiCategory[];
  priority: 'normal' | 'high' | 'critical';
}

export type KpiCategory = 'missed-session' | 'review-due' | 'coaching-due' | 'otj-behind';

export interface EngagementAction {
  id: string;
  learnerId: string;
  type: 'call' | 'email' | 'escalation' | 'note' | 'appointment' | 'resolved';
  dateTime: string;
  userId: string;
  userName: string;
  calledNumber?: string;
  answered?: boolean;
  outcome?: CallOutcome;
  notes?: string;
  escalatedTo?: 'none' | 'line_manager' | 'hr';
  appointmentBooked?: boolean;
  followUpDate?: string;
  resolutionReason?: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  kpiCategory: KpiCategory;
  mergeFields: string[];
}

export interface ThresholdSettings {
  progressReviewCycleWeeks: number;
  progressReviewDueSoonDays: number;
  monthlyMeetingCycleWeeks: number;
  monthlyMeetingDueSoonDays: number;
  otjBehindThreshold: number;
  missedSessionStatuses: string[];
  includeBreakInLearning: boolean;
}

export interface KpiCardData {
  id: KpiCategory;
  title: string;
  count: number;
  total: number;
  percentage: number;
  trend: number; // positive = worsening, negative = improving
  accentClass: string;
}

export interface DailyActivity {
  date: string;
  callsMade: number;
  answered: number;
  notAnswered: number;
  escalatedLM: number;
  escalatedHR: number;
  appointmentsBooked: number;
  emailsSent: number;
}
