import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, TicketCheck } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import BackButton from "@/components/BackButton";

const cards = [
  {
    label: "Track Attendance",
    description: "View missed-session KPI with weekly filters and contact learners",
    icon: AlertTriangle,
    path: "/attendance/track",
    accent: "#334155",
    bg: "from-[#F1F5F9] to-[#E2E8F0]",
    iconBg: "#334155",
  },
  {
    label: "Ticket System",
    description: "Create and manage attendance support tickets linked to KBC attendance",
    icon: TicketCheck,
    path: "/attendance/tickets",
    accent: "#1E6ACB",
    bg: "from-[#EEF7FF] to-[#DAEEFF]",
    iconBg: "#1E6ACB",
  },
];

export default function AttendancePage() {
  const navigate = useNavigate();

  return (
    <AppLayout>
      <div className="min-h-full bg-[#F4F8FC] p-6 sm:p-8">
        <div className="mx-auto max-w-3xl">
          <BackButton to="/" label="Home" />

          <div className="mb-8">
            <p className="text-xs font-bold uppercase tracking-widest text-[#1E6ACB]">
              Attendance
            </p>
            <h1 className="mt-1 text-2xl font-bold text-[#14264A] sm:text-3xl">
              Attendance Management
            </h1>
            <p className="mt-1 text-sm text-[#5F7288]">
              Choose a section to manage learner attendance
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {cards.map(({ label, description, icon: Icon, path, accent, bg, iconBg }) => (
              <button
                key={path}
                onClick={() => navigate(path)}
                className={`group relative flex flex-col rounded-2xl bg-gradient-to-br ${bg} border border-white p-7 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-lg focus:outline-none`}
                style={{ "--accent": accent } as CSSProperties}
              >
                <div
                  className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-sm"
                  style={{ backgroundColor: iconBg }}
                >
                  <Icon className="h-7 w-7" />
                </div>

                <h2 className="text-lg font-bold leading-snug" style={{ color: accent }}>
                  {label}
                </h2>

                <p className="mt-2 text-sm leading-relaxed text-[#5F7288]">{description}</p>

                <div
                  className="mt-6 flex items-center gap-1 text-xs font-semibold opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                  style={{ color: accent }}
                >
                  Open
                  <svg className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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
