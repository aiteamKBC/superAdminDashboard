import { useNavigate } from "react-router-dom";
import { CalendarCheck2, ClipboardList, Ticket } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import BackButton from "@/components/BackButton";

const CARDS = [
  {
    key: "required",
    title: "Required MCM",
    description: "Learners with overdue monthly coaching meetings that need to be booked",
    icon: ClipboardList,
    path: "/coaching-meetings/required",
    iconBg: "bg-[#EDF3FA]",
    iconColor: "text-[#5F7288]",
    border: "border-[#DDE7F0] hover:border-[#9DB4CC]",
  },
  // Scheduled MCM is intentionally hidden from the user-facing MCM landing page.
  // {
  //   key: "scheduled",
  //   title: "Scheduled MCM",
  //   description: "Learners with upcoming monthly coaching sessions already booked",
  //   icon: CalendarCheck2,
  //   path: "/coaching-meetings/scheduled",
  //   iconBg: "bg-[#E7F2FC]",
  //   iconColor: "text-[#315D93]",
  //   border: "border-[#C9DFF3] hover:border-[#78AADB]",
  // },
  {
    key: "tickets",
    title: "MCM Ticket System",
    description: "Manage and track monthly coaching meeting support tickets",
    icon: Ticket,
    path: "/coaching-meetings/tickets",
    iconBg: "bg-[#E8F0F9]",
    iconColor: "text-[#315D93]",
    border: "border-[#C8D9EA] hover:border-[#7899BC]",
  },
];

export default function MCMPage() {
  const navigate = useNavigate();

  return (
    <AppLayout>
      <div className="min-h-full bg-[#F4F8FC]">
        <div className="border-b border-[#DDE7F0] bg-white px-4 pb-5 pt-4 sm:px-6">
          <BackButton to="/" label="Home" />
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E8F0F9]">
              <CalendarCheck2 className="h-5 w-5 text-[#315D93]" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#14264A]">Monthly Coaching Meetings</h1>
              <p className="mt-0.5 text-sm text-[#5F7288]">Schedule, track and manage coaching sessions</p>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                  <p className="text-base font-bold text-[#14264A] group-hover:text-[#315D93]">{title}</p>
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
