export type KbcStudent = {
  ID?: string | number;
  id?: string | number;

  Email?: string;
  email?: string;
  emailAddress?: string;
  UserEmail?: string;
  LearnerEmail?: string;

  FullName?: string;
  fullName?: string;
  DisplayName?: string;
  displayName?: string;
  name?: string;

  Gender?: string;
  Overall?: string | number;
  overall?: string | number;

  CaseOwnerId?: string | number;
  LMSProgress?: string | number;
  AptemProgress?: string | number;

  ["Review Status1"]?: string;
  ["Review Status2"]?: string;
  ["Review Status3"]?: string;
  ["Review Status4"]?: string;
  ["Review Status5"]?: string;
  ["Review Status6"]?: string;
  ["Review Status7"]?: string;
  ["Review Status8"]?: string;
  ["Review Status9"]?: string;
  ["Review Status10"]?: string;
  ["Review Status11"]?: string;
  ["Review Status12"]?: string;
  ["Review Status13"]?: string;
  ["Review Status14"]?: string;
  ["Review Status15"]?: string;
  ["Review Status16"]?: string;

  ["Review Planned Date1"]?: string;
  ["Review Planned Date2"]?: string;
  ["Review Planned Date3"]?: string;
  ["Review Planned Date4"]?: string;
  ["Review Planned Date5"]?: string;
  ["Review Planned Date6"]?: string;
  ["Review Planned Date7"]?: string;
  ["Review Planned Date8"]?: string;
  ["Review Planned Date9"]?: string;
  ["Review Planned Date10"]?: string;
  ["Review Planned Date11"]?: string;
  ["Review Planned Date12"]?: string;
  ["Review Planned Date13"]?: string;
  ["Review Planned Date14"]?: string;
  ["Review Planned Date15"]?: string;
  ["Review Planned Date16"]?: string;

  [key: string]: any;
};

export type KbcCoach = {
  case_owner: string;
  owner_phone?: string;
  OwnerEmail?: string; 

  total_evidence?: number;
  evidence_submitted?: number;
  evidence_accepted?: number;
  evidence_referred?: number;

  completed_sessions?: Record<
    string,
    {
      students?: string[];
      student_count?: number;
      total_minutes?: number;
      total_seconds?: number;
      sessions_count?: number;
      total_formatted?: string;
    }
  >;

  cancelled_sessions?: { sessions?: { serviceName?: string; customerName?: string; cancelledAt?: string }[] };

  with_student?: string[];

  last_sub_date?: string;
  elapsed_days?: number;

  staff_id?: string;

  upcomming_sessions?: {
    meetings?: {
      id?: string;
      date?: string;
      timeFrom?: string;
      timeTo?: string;
      joinWebUrl?: string;
      serviceName?: string;
      customerName?: string;
    }[];
  };

  student_count?: number;

  avg_aptem?: string | number;
  avg_lms?: string | number;
  avg_overall?: string | number;

  rating?: string;

  distribution?: Record<string, number>;

  students?: KbcStudent[];

  tasks: any[];

  case_owner_id: number;

  attendance?: {
    learners?: {
      id?: string;
      Email?: string;
      FullName?: string;
      Attendance?: Record<string, { value?: number; module?: string }>;
    }[];
  };

  coach_booking_link?: string;

  booked_students_PR?: any;
  booked_students_MCM?: any;
  booked_students_StSupport?: any;

  calls?: Record<
    string,
    {
      call_id?: string;
      start_time?: string | null;
      end_time?: string | null;
      call_result?: string | null;
      callee_did_number?: string | null;
    }[]
  >;

  phone_numbers?: string[];

  learners_json?: any[] | string | null;

  overall_progress_review?: any;

  ["Today marking"]?: number | string | null;
  ["Yesterday marking"]?: number | string | null;
  ["-2 marking"]?: number | string | null;
  ["-3 marking"]?: number | string | null;
  ["-4 marking"]?: number | string | null;
  ["-5 marking"]?: number | string | null;
  ["-6 marking"]?: number | string | null;
  ["-7 marking"]?: number | string | null;

  ["Last Week PR"]?: number | string | null;
  ["Second Week PR"]?: number | string | null;
  ["Third Week PR"]?: number | string | null;
  ["Fourth Week PR"]?: number | string | null;

  ["Monthly Total PR Done"]?: number | string | null;
  ["Actually Monthly Done"]?: number | string | null;
  ["Monthly Total PR Required"]?: number | string | null;
  ["Completion Rate"]?: number | string | null;
};

// EmailRecipient type for KBC email sending
export type EmailRecipient = {
  learnerName: string;
  learnerEmail: string;
  programme?: string;
  coachName?: string;
  coachEmail?: string;
  lastSessionDate?: string;
  senderName?: string;
  lineManagerEmail?: string;
  hrEmail?: string;
  status?: string;
  riskCategories: string[];
};

// Progress Review Summary type
export type ProgressReviewSummaryRow = {
  id?: number | string;
  fullName?: string;
  email?: string;
  group?: string;
  caseOwner?: string;
  lastProgressReview?: string;
  nextReviewStatus?: string;
  nextPrDate?: string;
  nextPrState?: string;
  overduePrCount?: number;
  reviewStatus?: "Ahead" | "Normal" | "At Risk" | "Due" | string;
};