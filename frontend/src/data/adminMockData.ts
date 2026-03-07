import { Coordinator, LearnerAssignment, AssignmentAuditEntry, CoordinatorPerformance } from '@/types/admin';
import { mockLearners } from './mockData';

const coordinatorNames = ['Jane Cooper', 'Mark Sullivan', 'Lisa Patel', 'Tom Harrison', 'Anna Kowalski'];

export const mockCoordinators: Coordinator[] = coordinatorNames.map((name, i) => {
  const learnersPerCoord = Math.floor(mockLearners.length / coordinatorNames.length);
  const startIdx = i * learnersPerCoord;
  const assignedLearners = mockLearners.slice(startIdx, startIdx + learnersPerCoord);
  const active = assignedLearners.filter(l => l.status === 'Active');
  const total = active.length || 1;

  return {
    id: `coord-${i + 1}`,
    name,
    email: `${name.toLowerCase().replace(' ', '.')}@kbc.ac.uk`,
    role: 'Engagement Coordinator',
    active: i !== 4, // Anna is inactive
    caseloadSize: assignedLearners.length,
    workload: assignedLearners.length > 12 ? 'heavy' : assignedLearners.length > 8 ? 'normal' : 'light',
    kpiBreakdown: {
      'missed-session': Math.round((active.filter(l => l.riskCategories.includes('missed-session')).length / total) * 100),
      'review-due': Math.round((active.filter(l => l.riskCategories.includes('review-due')).length / total) * 100),
      'coaching-due': Math.round((active.filter(l => l.riskCategories.includes('coaching-due')).length / total) * 100),
      'otj-behind': Math.round((active.filter(l => l.riskCategories.includes('otj-behind')).length / total) * 100),
    },
  };
});

export const mockAssignments: LearnerAssignment[] = mockLearners.map((learner, i) => ({
  id: `assign-${i + 1}`,
  learnerId: learner.id,
  coordinatorId: `coord-${(i % coordinatorNames.length) + 1}`,
  assignedDate: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  assignedBy: 'admin-1',
}));

export const mockAuditLog: AssignmentAuditEntry[] = Array.from({ length: 20 }, (_, i) => ({
  id: `audit-${i + 1}`,
  learnerId: `learner-${(i % 48) + 1}`,
  fromCoordinatorId: `coord-${(i % 5) + 1}`,
  toCoordinatorId: `coord-${((i + 1) % 5) + 1}`,
  adminUserId: 'admin-1',
  adminUserName: 'Admin User',
  dateTime: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
  reason: ['Caseload rebalance', 'Coordinator on leave', 'Priority reassignment', 'New starter allocation'][i % 4],
}));

export function getCoordinatorPerformance(dateRange: 'today' | '7days' | '30days' | 'custom'): CoordinatorPerformance[] {
  const multiplier = dateRange === 'today' ? 1 : dateRange === '7days' ? 7 : 30;
  
  return mockCoordinators.filter(c => c.active).map(coord => {
    const calls = Math.floor((Math.random() * 8 + 4) * multiplier);
    const answered = Math.floor(calls * (0.5 + Math.random() * 0.3));
    const emails = Math.floor((Math.random() * 5 + 2) * multiplier);
    const resolutions = Math.floor(Math.random() * 3 * multiplier);
    const totalFlagged = coord.caseloadSize;

    return {
      coordinatorId: coord.id,
      coordinatorName: coord.name,
      assignedCaseload: coord.caseloadSize,
      callsMade: calls,
      answeredCalls: answered,
      notAnswered: calls - answered,
      emailsSent: emails,
      escalationsLM: Math.floor(Math.random() * 3 * multiplier),
      escalationsHR: Math.floor(Math.random() * multiplier),
      appointmentsBooked: Math.floor(Math.random() * 4 * multiplier),
      resolutionCount: resolutions,
      resolutionRate: totalFlagged > 0 ? Math.round((resolutions / totalFlagged) * 100) : 0,
      slaCompliance: Math.floor(70 + Math.random() * 30),
      avgTimeToFirstContact: Math.round((4 + Math.random() * 44) * 10) / 10,
      avgTimeToResolution: Math.round((24 + Math.random() * 168) * 10) / 10,
      outcomeBreakdown: {
        bookedAppointment: Math.floor(Math.random() * 4 * multiplier),
        emailedDetails: Math.floor(Math.random() * 5 * multiplier),
        escalated: Math.floor(Math.random() * 3 * multiplier),
        noAnswer: Math.floor(Math.random() * 6 * multiplier),
        other: Math.floor(Math.random() * 2 * multiplier),
      },
      caseloadHealth: {
        missedSession: Math.floor(Math.random() * 4),
        reviewDue: Math.floor(Math.random() * 3),
        coachingDue: Math.floor(Math.random() * 4),
        otjBehind: Math.floor(Math.random() * 3),
        highPriority: Math.floor(Math.random() * 3),
      },
      ageingBuckets: {
        '0-2': Math.floor(Math.random() * 4 + 2),
        '3-7': Math.floor(Math.random() * 3 + 1),
        '8-14': Math.floor(Math.random() * 2),
        '15+': Math.floor(Math.random() * 2),
      },
    };
  });
}

export function getCoordinatorForLearner(learnerId: string): string {
  const assignment = mockAssignments.find(a => a.learnerId === learnerId);
  return assignment?.coordinatorId || 'coord-1';
}

export function getLastContactDate(learnerId: string): string | null {
  // Simulate from mock actions
  const daysAgo = Math.floor(Math.random() * 14);
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

export function getNextFollowUpDate(learnerId: string): string | null {
  const daysAhead = Math.floor(Math.random() * 7) + 1;
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().split('T')[0];
}
