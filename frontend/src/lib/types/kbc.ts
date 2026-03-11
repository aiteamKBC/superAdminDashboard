export type KbcCoach = {
  case_owner: string;
  owner_phone?: string;

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

  students?: any[];

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