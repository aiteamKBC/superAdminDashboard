import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import {
  Award,
  BookOpen,
  BriefcaseBusiness,
  CalendarCheck2,
  CheckSquare,
  ClipboardList,
  GraduationCap,
  TrendingUp,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";

const cards = [
  {
    label: "Attendance",
    description: "Track and manage learner attendance records",
    icon: ClipboardList,
    path: "/attendance",
    accent: "#5B47D5",
    bg: "from-white to-[#F0EEFF]",
    iconBg: "linear-gradient(135deg, #7B5CF0, #5B47D5)",
  },
  {
    label: "Progress Review",
    description: "Monitor and record learner progress reviews",
    icon: BookOpen,
    path: "/progress-review",
    accent: "#4338CA",
    bg: "from-white to-[#EDEAFF]",
    iconBg: "linear-gradient(135deg, #6366F1, #4338CA)",
  },
  {
    label: "Monthly Coaching Meetings",
    description: "Schedule and log monthly coaching sessions",
    icon: CalendarCheck2,
    path: "/coaching-meetings",
    accent: "#6D28D9",
    bg: "from-white to-[#F2EDFF]",
    iconBg: "linear-gradient(135deg, #8B5CF6, #6D28D9)",
  },
  {
    label: "Off The Job Hours",
    description: "Record and verify off-the-job training hours",
    icon: BriefcaseBusiness,
    path: "/otj-hours",
    accent: "#D97706",
    bg: "from-white to-[#FFF8ED]",
    iconBg: "linear-gradient(135deg, #F59E0B, #D97706)",
  },
  {
    label: "Marking",
    description: "Grade and provide feedback on submitted work",
    icon: CheckSquare,
    path: "/marking",
    accent: "#0369A1",
    bg: "from-white to-[#EFF8FF]",
    iconBg: "linear-gradient(135deg, #0EA5E9, #0369A1)",
  },
  {
    label: "Active Learners",
    description: "View and manage all currently active learners",
    icon: GraduationCap,
    path: "/active-learners",
    accent: "#059669",
    bg: "from-white to-[#ECFDF5]",
    iconBg: "linear-gradient(135deg, #10B981, #059669)",
  },
  {
    label: "Gateway (EPA)",
    description: "Manage end-point assessment readiness and gateway progress",
    icon: Award,
    path: "/gateway",
    accent: "#DC2626",
    bg: "from-white to-[#FEF2F2]",
    iconBg: "linear-gradient(135deg, #EF4444, #DC2626)",
  },
  {
    label: "Learner Progress",
    description: "PR, MCR, and OTJH in one learner snapshot",
    icon: TrendingUp,
    path: "/learner-progress",
    accent: "#5B47D5",
    bg: "from-white to-[#F0EEFF]",
    iconBg: "linear-gradient(135deg, #7B5CF0, #5B47D5)",
  },
];

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <AppLayout>
      <div className="min-h-full bg-[#F5F4FB] p-6 sm:p-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8">
            <p className="text-xs font-bold uppercase tracking-widest text-[#9B87D8] mb-1">
              Kent Business College
            </p>
            <h1 className="text-2xl font-bold text-[#1D1050] sm:text-3xl">
              Engagement Dashboard
            </h1>
            <p className="mt-1 text-sm text-[#6E6D8A]">
              Select a section to get started
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {cards.map(({ label, description, icon: Icon, path, accent, bg, iconBg }) => (
              <button
                key={path}
                onClick={() => navigate(path)}
                className={`group relative flex flex-col rounded-2xl bg-gradient-to-br ${bg} border border-[#E2DCF8] p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-[#C4B8F0] hover:shadow-[0_16px_36px_rgba(29,16,80,0.12)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5B47D5] focus-visible:ring-offset-2`}
                style={{ "--ring-color": accent } as CSSProperties}
              >
                <div
                  className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl text-white shadow-[0_4px_12px_rgba(0,0,0,0.15)]"
                  style={{ background: iconBg }}
                >
                  <Icon className="h-5 w-5" />
                </div>

                <h2 className="text-sm font-bold leading-snug" style={{ color: accent }}>
                  {label}
                </h2>

                <p className="mt-1.5 text-xs leading-relaxed text-[#6E6D8A]">
                  {description}
                </p>

                <div
                  className="mt-4 flex items-center gap-1 text-xs font-semibold opacity-0 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0.5"
                  style={{ color: accent }}
                >
                  Open
                  <svg
                    className="h-3 w-3"
                    viewBox="0 0 16 16"
                    fill="none"
                  >
                    <path
                      d="M3 8h10M9 4l4 4-4 4"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
