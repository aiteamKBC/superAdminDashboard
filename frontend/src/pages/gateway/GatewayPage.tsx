import { useNavigate } from "react-router-dom";
import { AlertTriangle, Award, CalendarClock, Medal, Ticket } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import BackButton from "@/components/BackButton";

const CARDS = [
  {
    key: "close",
    title: "Close to EPA",
    description: "Active learners with an End-Date in the next 60 days",
    icon: CalendarClock,
    path: "/gateway/close",
    iconBg: "bg-blue-50",
    iconColor: "text-blue-700",
    border: "border-blue-200 hover:border-blue-400",
  },
  {
    key: "overdue",
    title: "EPA Overdue",
    description: "Active learners still open more than 7 days after End-Date",
    icon: AlertTriangle,
    path: "/gateway/overdue",
    iconBg: "bg-amber-50",
    iconColor: "text-amber-700",
    border: "border-amber-200 hover:border-amber-400",
  },
  {
    key: "entered",
    title: "Entered EPA",
    description: "Learners currently in EPA stage",
    icon: Medal,
    path: "/gateway/entered-epa",
    iconBg: "bg-violet-50",
    iconColor: "text-violet-700",
    border: "border-violet-200 hover:border-violet-400",
  },
  {
    key: "tickets",
    title: "EPA Ticket System",
    description: "Auto-create and manage support tickets for overdue EPA learners",
    icon: Ticket,
    path: "/gateway/tickets",
    iconBg: "bg-[#E8F0F9]",
    iconColor: "text-[#315D93]",
    border: "border-[#C8D9EA] hover:border-[#7899BC]",
  },
];

export default function GatewayPage() {
  const navigate = useNavigate();

  return (
    <AppLayout>
      <div className="min-h-full bg-[#F4F8FC]">
        <div className="border-b border-[#DDE7F0] bg-white px-4 pb-5 pt-4 sm:px-6">
          <BackButton to="/" label="Home" />
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
              <Award className="h-5 w-5 text-blue-700" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#14264A]">Gateway (EPA)</h1>
              <p className="mt-0.5 text-sm text-[#5F7288]">Manage EPA readiness, deadlines and overdue follow-up</p>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {CARDS.map(({ key, title, description, icon: Icon, path, iconBg, iconColor, border }) => (
              <button
                key={key}
                onClick={() => navigate(path)}
                className={`group flex flex-col gap-4 rounded-2xl border bg-white p-6 text-left shadow-sm transition-all duration-150 hover:shadow-md active:scale-[0.98] ${border}`}
              >
                <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${iconBg}`}>
                  <Icon className={`h-6 w-6 ${iconColor}`} />
                </div>
                <div>
                  <p className="text-base font-bold text-[#14264A] group-hover:text-blue-700">{title}</p>
                  <p className="mt-1 text-sm text-[#5F7288]">{description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
