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
    body: 'Dear {{learnerName}},\n\nI hope you are doing well.\n\nWe noticed that you were unable to attend your most recent session on **{{lastSessionDate}}**, and we wanted to check in with you.\n\nTo help you stay on track with your **{{programme}}** programme, please get in touch with your coach, **{{coachName}}**, to discuss your next steps and arrange a suitable time to catch up.\n\nIf you\'ve been experiencing any difficulties or need additional support, please don\'t hesitate to reach out. We\'re here to help and support you throughout your studies.\n\nWe look forward to hearing from you.\n\nKind regards,\n\n{{senderName}}\nEngagement Coordinator\nKent Business College',
    kpiCategory: 'missed-session',
    mergeFields: ['learnerName', 'programme', 'coachName', 'lastSessionDate', 'senderName'],
  },
  {
    id: 'tpl-5',
    name: 'Recovery Session',
    subject: 'Your Catch-Up Session Details | {{programme}}',
    body: 'Dear {{learnerName}},\n\nI hope you are doing well.\n\nWe noticed that you were unable to attend your session on **{{lastSessionDate}}**, and we wanted to make sure you have the opportunity to catch up on the content you missed.\n\nA catch-up session has been arranged for:\n\n**Date & Time:** {{catchUpSessionDateTime}}\n\nYou can join the session using the details below:\n\n**Join Meeting:** {{catchUpSessionLink}}\n**Meeting ID:** {{meetingId}}\n**Passcode:** {{passcode}}\n\nWe encourage you to attend this session so you can stay on track with your studies. If you have any questions or need any support, please don\'t hesitate to get in touch—we\'re here to help.\n\nWe look forward to seeing you there.\n\nKind regards,\n\n{{senderName}}\nEngagement Coordinator\nKent Business College',
    kpiCategory: 'missed-session',
    mergeFields: ['learnerName', 'programme', 'lastSessionDate', 'catchUpSessionDateTime', 'catchUpSessionLink', 'meetingId', 'passcode', 'senderName'],
  },
  {
    id: 'tpl-2',
    name: 'Progress Review Booking Request',
    subject: 'Progress Review Due – Please Book | {{programme}}',
    body: 'Dear {{learnerName}},\n\nI hope you are doing well.\n\nThis is a friendly reminder that your **Progress Review** is due by **{{dueDate}}**, and we noticed that a meeting has not yet been booked.\n\nPlease use the booking button in this email to schedule your Progress Review at a time that works for you.\n\nYour Progress Review is an opportunity to discuss your progress, celebrate your achievements, address any challenges you may be facing, and ensure you have the support you need to stay on track with your studies.\n\nIf you have any questions or need any assistance, please don\'t hesitate to contact your coach, **{{coachName}}**.\n\nWe look forward to speaking with you soon.\n\nKind regards,\n\n{{senderName}}\nEngagement Coordinator\nKent Business College',
    kpiCategory: 'review-due',
    mergeFields: ['learnerName', 'programme', 'coachName', 'dueDate', 'senderName'],
  },
  {
    id: 'tpl-3',
    name: 'Monthly Coaching Meeting Request',
    subject: 'Monthly Coaching Meeting – Booking Required | {{programme}}',
    body: 'Dear {{learnerName}},\n\nI hope you are doing well.\n\nThis is a friendly reminder that your **Monthly Coaching Meeting** with **{{coachName}}** is now due.\n\nPlease use the booking button in this email to schedule your meeting at a time that suits you.\n\nYour Monthly Coaching Meeting is a great opportunity to discuss your progress, ask any questions you may have, and receive guidance and support to help you stay on track with your studies.\n\nIf you need any assistance, please don\'t hesitate to get in touch.\n\nWe look forward to speaking with you soon.\n\nKind regards,\n\n{{senderName}}\nEngagement Coordinator\nKent Business College',
    kpiCategory: 'coaching-due',
    mergeFields: ['learnerName', 'programme', 'coachName', 'senderName'],
  },
  {
    id: 'tpl-4',
    name: 'OTJH Catch-Up Guidance',
    subject: 'Off-the-Job Hours – Action Plan Needed | {{programme}}',
    body: 'Dear {{learnerName}},\n\nI hope you are doing well.\n\nOur records show that you are currently **{{behindPercent}}%** behind on your Off-the-Job Training (OTJ) hours.\n\nYour current progress is as follows:\n\n* **Expected hours:** {{expectedHours}}\n* **Hours logged:** {{actualHours}}\n\nTo help you get back on track, please arrange a discussion with your coach, **{{coachName}}**, and your line manager, **{{lineManagerName}}**, to agree on a catch-up plan.\n\nCatching up as early as possible will help ensure you continue making good progress towards completing your apprenticeship successfully.\n\nIf you have any questions or need any support, please don\'t hesitate to get in touch. We\'re here to help.\n\nKind regards,\n\n{{senderName}}\nEngagement Coordinator\nKent Business College',
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
      title: 'Monthly Coaching Required - Not Booked',
      count: coachingDue.length,
      total,
      percentage: total ? Math.round((coachingDue.length / total) * 100) : 0,
      trend: 3,
      accentClass: 'kpi-accent-coaching',
    },
    {
      id: 'otj-behind',
      title: 'OTJH Behind > 20%',
      count: otjBehind.length,
      total,
      percentage: total ? Math.round((otjBehind.length / total) * 100) : 0,
      trend: 0,
      accentClass: 'kpi-accent-otj',
    },
  ];
}
