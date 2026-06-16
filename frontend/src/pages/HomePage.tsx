
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
} from "lucide-react";
import AppLayout from "@/components/AppLayout";

const cards = [
  {
    label: "Attendance",
    description: "Track and manage learner attendance records",
    icon: ClipboardList,
    path: "/attendance",
    accent: "#1E6ACB",
    bg: "from-[#EEF7FF] to-[#DAEEFF]",
    iconBg: "#1E6ACB",
  },
  {
    label: "Progress Review",
    description: "Monitor and record learner progress reviews",
    icon: BookOpen,
    path: "/progress-review",
    accent: "#0369A1",
    bg: "from-[#EFF9FF] to-[#D6EFFD]",
    iconBg: "#0369A1",
  },
  {
    label: "Monthly Coaching Meetings",
    description: "Schedule and log monthly coaching sessions",
    icon: CalendarCheck2,
    path: "/coaching-meetings",
    accent: "#315D93",
    bg: "from-[#F1F6FC] to-[#DCE9F7]",
    iconBg: "#315D93",
  },
  {
    label: "Off The Job Hours",
    description: "Record and verify off-the-job training hours",
    icon: BriefcaseBusiness,
    path: "/otj-hours",
    accent: "#24557F",
    bg: "from-[#EFF6FB] to-[#D8E8F4]",
    iconBg: "#24557F",
  },
  {
    label: "Marking",
    description: "Grade and provide feedback on submitted work",
    icon: CheckSquare,
    path: "/marking",
    accent: "#475569",
    bg: "from-[#F1F5F9] to-[#E2E8F0]",
    iconBg: "#475569",
  },
  {
    label: "Active Learners",
    description: "View and manage all currently active learners",
    icon: GraduationCap,
    path: "/active-learners",
    accent: "#14264A",
    bg: "from-[#EEF3FA] to-[#D9E4F4]",
    iconBg: "#14264A",
  },
  {
    label: "Gateway (EPA)",
    description: "Manage end-point assessment readiness and gateway progress",
    icon: Award,
    path: "/gateway",
    accent: "#1E6ACB",
    bg: "from-[#EEF7FF] to-[#DAEEFF]",
    iconBg: "#1E6ACB",
  },
];

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <AppLayout>
      <div className="min-h-full bg-[#F4F8FC] p-6 sm:p-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[#14264A] sm:text-3xl">
              Welcome to Engagment Dashboard
            </h1>
            <p className="mt-1 text-sm text-[#5F7288]">
              Select a section to get started
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map(({ label, description, icon: Icon, path, accent, bg, iconBg }) => (
              <button
                key={path}
                onClick={() => navigate(path)}
                className={`group relative flex flex-col rounded-2xl bg-gradient-to-br ${bg} border border-white p-6 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2`}
                style={{ "--ring-color": accent } as CSSProperties}
              >
                <div
                  className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl text-white shadow-sm"
                  style={{ backgroundColor: iconBg }}
                >
                  <Icon className="h-6 w-6" />
                </div>

                <h2
                  className="text-base font-bold leading-snug"
                  style={{ color: accent }}
                >
                  {label}
                </h2>

                <p className="mt-1.5 text-xs leading-relaxed text-[#5F7288]">
                  {description}
                </p>

                <div
                  className="mt-5 flex items-center gap-1 text-xs font-semibold opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                  style={{ color: accent }}
                >
                  Open
                  <svg
                    className="h-3.5 w-3.5 translate-x-0 transition-transform duration-200 group-hover:translate-x-0.5"
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
