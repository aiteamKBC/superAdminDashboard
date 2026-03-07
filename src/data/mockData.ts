import { Learner, EngagementAction, EmailTemplate, ThresholdSettings, DailyActivity, KpiCardData } from '@/types/dashboard';

export const defaultThresholds: ThresholdSettings = {
  progressReviewCycleWeeks: 10,
  progressReviewDueSoonDays: 14,
  monthlyMeetingCycleWeeks: 4,
  monthlyMeetingDueSoonDays: 7,
  otjBehindThreshold: 20,
  missedSessionStatuses: ['Missed', 'No Show', 'Cancelled by learner late'],
  includeBreakInLearning: false,
};

const programmes = [
  'Marketing Executive L4',
  'Project Controls L6',
  'Digital Marketing L3',
  'Business Administration L3',
  'Data Analyst L4',
];
const coaches = ['Sarah Mitchell', 'James Reynolds', 'Emma Thompson', 'David Clark', 'Rachel Green'];
const organisations = ['Acme Corp', 'TechStart Ltd', 'Bright Future PLC', 'Metro Solutions', 'Green Energy Co', 'Summit Partners'];
const cohorts = ['Jan 2025', 'Mar 2025', 'Sep 2024', 'Jun 2024', 'Nov 2024'];

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate(daysAgo: number, daysAhead: number = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo + Math.floor(Math.random() * (daysAgo + daysAhead)));
  return d.toISOString().split('T')[0];
}

export const mockLearners: Learner[] = Array.from({ length: 48 }, (_, i) => {
  const firstName = ['Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Jamie', 'Riley', 'Quinn', 'Avery', 'Cameron', 'Drew', 'Finley', 'Harper', 'Kai', 'Logan', 'Max', 'Noah', 'Olive', 'Parker', 'Reese', 'Sam', 'Spencer', 'Tatum', 'Wren'][i % 24];
  const lastName = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Wilson', 'Moore', 'Taylor', 'Anderson', 'Thomas', 'Jackson', 'White', 'Harris', 'Martin', 'Lee', 'Clark', 'Lewis', 'Young', 'Hall', 'Allen', 'King'][i % 24];
  const status = i < 40 ? 'Active' : i < 44 ? 'Break in Learning' : 'Withdrawn';
  const expectedOtj = 200 + Math.floor(Math.random() * 200);
  const actualOtj = Math.floor(expectedOtj * (0.4 + Math.random() * 0.7));
  const behindPct = ((expectedOtj - actualOtj) / expectedOtj) * 100;
  
  const riskCategories: Learner['riskCategories'] = [];
  if (i % 5 === 0 || i % 7 === 0) riskCategories.push('missed-session');
  if (i % 4 === 0 || i % 9 === 0) riskCategories.push('review-due');
  if (i % 3 === 0 || i % 11 === 0) riskCategories.push('coaching-due');
  if (behindPct > 20) riskCategories.push('otj-behind');

  const priority = riskCategories.length >= 2 ? (behindPct > 40 ? 'critical' : 'high') : 'normal';
  const absenceRatio = Math.floor(Math.random() * 35);
  const missedLast10Weeks = Math.floor(Math.random() * 5);
  const missedInRow = riskCategories.includes('missed-session') ? Math.floor(Math.random() * 4) + 1 : 0;

  return {
    id: `learner-${i + 1}`,
    firstName,
    lastName: `${lastName}${i > 23 ? '-' + (i - 23) : ''}`,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@email.com`,
    phone: `07${Math.floor(100000000 + Math.random() * 900000000)}`,
    whatsapp: `+447${Math.floor(100000000 + Math.random() * 900000000)}`,
    organisation: rand(organisations),
    programme: rand(programmes),
    coach: rand(coaches),
    cohort: rand(cohorts),
    status,
    lineManagerName: `LM ${rand(['Adams', 'Baker', 'Carter', 'Dixon', 'Evans'])}`,
    lineManagerPhone: `07${Math.floor(100000000 + Math.random() * 900000000)}`,
    lineManagerEmail: `lm${i}@company.com`,
    hrManagerName: i % 3 === 0 ? `HR ${rand(['Fox', 'Grant', 'Hart'])}` : undefined,
    hrManagerPhone: i % 3 === 0 ? `07${Math.floor(100000000 + Math.random() * 900000000)}` : undefined,
    hrManagerEmail: i % 3 === 0 ? `hr${i}@company.com` : undefined,
    startDate: randomDate(365, 0),
    expectedEndDate: randomDate(-30, 365),
    expectedOtjHours: expectedOtj,
    actualOtjHours: actualOtj,
    lastSessionDate: randomDate(14, 0),
    lastSessionStatus: i % 5 === 0 ? 'Missed' : i % 7 === 0 ? 'No Show' : 'Attended',
    lastProgressReviewDate: randomDate(70, 0),
    nextProgressReviewDue: randomDate(-7, 21),
    progressReviewBooked: i % 4 !== 0,
    lastMonthlyMeetingDate: randomDate(28, 0),
    nextMonthlyMeetingDue: randomDate(-3, 10),
    monthlyMeetingBooked: i % 3 !== 0,
    absenceRatio,
    missedLast10Weeks,
    missedInRow,
    riskCategories,
    priority,
  };
});

export const mockActions: EngagementAction[] = Array.from({ length: 120 }, (_, i) => ({
  id: `action-${i + 1}`,
  learnerId: `learner-${(i % 48) + 1}`,
  type: (['call', 'email', 'escalation', 'note', 'appointment'] as const)[i % 5],
  dateTime: new Date(Date.now() - Math.floor(Math.random() * 30 * 24 * 60 * 60 * 1000)).toISOString(),
  userId: 'coord-1',
  userName: 'Jane Cooper',
  calledNumber: i % 5 === 0 ? '07123456789' : undefined,
  answered: i % 3 !== 0,
  outcome: i % 5 === 0 ? 'No answer – voicemail left' : 'Sent email with details',
  notes: i % 2 === 0 ? 'Followed up regarding missed session. Learner confirmed will attend next week.' : undefined,
  escalatedTo: i % 10 === 0 ? 'line_manager' : 'none',
  appointmentBooked: i % 4 === 0,
  followUpDate: i % 3 === 0 ? randomDate(-2, 7) : undefined,
}));

export const mockEmailTemplates: EmailTemplate[] = [
  {
    id: 'tpl-1',
    name: 'Missed Session Reminder',
    subject: 'Missed Session – Action Required | {{programme}}',
    body: 'Dear {{learnerName}},\n\nWe noticed you missed your most recent session on {{lastSessionDate}}. It\'s important that you attend all scheduled sessions to stay on track with your {{programme}} programme.\n\nPlease contact your coach {{coachName}} to discuss rescheduling.\n\nIf you have any difficulties, please don\'t hesitate to reach out.\n\nKind regards,\n{{senderName}}\nEngagement Coordinator\nKent Business College',
    kpiCategory: 'missed-session',
    mergeFields: ['learnerName', 'programme', 'coachName', 'lastSessionDate', 'senderName'],
  },
  {
    id: 'tpl-2',
    name: 'Progress Review Booking Request',
    subject: 'Progress Review Due – Please Book | {{programme}}',
    body: 'Dear {{learnerName}},\n\nYour progress review is due on {{dueDate}}. We don\'t currently have a booking for this.\n\nPlease use the following link to book your review: {{bookingLink}}\n\nIf you need assistance, contact your coach {{coachName}}.\n\nKind regards,\n{{senderName}}\nEngagement Coordinator\nKent Business College',
    kpiCategory: 'review-due',
    mergeFields: ['learnerName', 'programme', 'coachName', 'dueDate', 'bookingLink', 'senderName'],
  },
  {
    id: 'tpl-3',
    name: 'Monthly Coaching Meeting Request',
    subject: 'Monthly Coaching Meeting – Booking Required | {{programme}}',
    body: 'Dear {{learnerName}},\n\nYour monthly coaching meeting with {{coachName}} is due. Please book this as soon as possible.\n\nBooking link: {{bookingLink}}\n\nKind regards,\n{{senderName}}\nEngagement Coordinator\nKent Business College',
    kpiCategory: 'coaching-due',
    mergeFields: ['learnerName', 'programme', 'coachName', 'bookingLink', 'senderName'],
  },
  {
    id: 'tpl-4',
    name: 'OTJ Hours Catch-Up Guidance',
    subject: 'Off-the-Job Hours – Action Plan Needed | {{programme}}',
    body: 'Dear {{learnerName}},\n\nOur records show you are currently {{behindPercent}}% behind on your off-the-job training hours.\n\nExpected hours: {{expectedHours}}\nActual hours logged: {{actualHours}}\n\nPlease speak with your coach {{coachName}} and your line manager {{lineManagerName}} to develop a catch-up plan.\n\nKind regards,\n{{senderName}}\nEngagement Coordinator\nKent Business College',
    kpiCategory: 'otj-behind',
    mergeFields: ['learnerName', 'programme', 'coachName', 'lineManagerName', 'expectedHours', 'actualHours', 'behindPercent', 'senderName'],
  },
];

export const mockDailyActivity: DailyActivity[] = Array.from({ length: 30 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (29 - i));
  const calls = Math.floor(Math.random() * 20) + 5;
  const answered = Math.floor(calls * (0.4 + Math.random() * 0.3));
  return {
    date: d.toISOString().split('T')[0],
    callsMade: calls,
    answered,
    notAnswered: calls - answered,
    escalatedLM: Math.floor(Math.random() * 4),
    escalatedHR: Math.floor(Math.random() * 2),
    appointmentsBooked: Math.floor(Math.random() * 6) + 1,
    emailsSent: Math.floor(Math.random() * 15) + 3,
  };
});

export function getKpiCards(learners: Learner[]): KpiCardData[] {
  const active = learners.filter(l => l.status === 'Active');
  const total = active.length;

  const missed = active.filter(l => l.riskCategories.includes('missed-session'));
  const reviewDue = active.filter(l => l.riskCategories.includes('review-due'));
  const coachingDue = active.filter(l => l.riskCategories.includes('coaching-due'));
  const otjBehind = active.filter(l => l.riskCategories.includes('otj-behind'));

  return [
    {
      id: 'missed-session',
      title: 'Missed Last Session',
      count: missed.length,
      total,
      percentage: total ? Math.round((missed.length / total) * 100) : 0,
      trend: 2,
      accentClass: 'kpi-accent-missed',
    },
    {
      id: 'review-due',
      title: 'Progress Review Due – Not Booked',
      count: reviewDue.length,
      total,
      percentage: total ? Math.round((reviewDue.length / total) * 100) : 0,
      trend: -1,
      accentClass: 'kpi-accent-review',
    },
    {
      id: 'coaching-due',
      title: 'Monthly Coaching Due – Not Booked',
      count: coachingDue.length,
      total,
      percentage: total ? Math.round((coachingDue.length / total) * 100) : 0,
      trend: 3,
      accentClass: 'kpi-accent-coaching',
    },
    {
      id: 'otj-behind',
      title: 'OTJ Hours Behind > 20%',
      count: otjBehind.length,
      total,
      percentage: total ? Math.round((otjBehind.length / total) * 100) : 0,
      trend: 0,
      accentClass: 'kpi-accent-otj',
    },
  ];
}
