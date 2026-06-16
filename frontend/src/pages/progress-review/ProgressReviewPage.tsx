import { useNavigate } from "react-router-dom";
import { BookOpen, Calendar, Ticket } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import BackButton from "@/components/BackButton";

const CARDS = [
  {
    key: "required",
    title: "Required PR",
    description: "Learners with overdue or due progress reviews",
    icon: BookOpen,
    path: "/progress-review/required",
    iconBg: "bg-slate-100",
    iconColor: "text-slate-600",
    border: "border-slate-200 hover:border-slate-400",
  },
  {
    key: "scheduled",
    title: "Scheduled PR",
    description: "Learners with an upcoming scheduled progress review",
    icon: Calendar,
    path: "/progress-review/scheduled",
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600",
    border: "border-blue-200 hover:border-blue-400",
  },
  {
    key: "tickets",
    title: "Ticket System",
    description: "Manage and track progress review support tickets",
    icon: Ticket,
    path: "/progress-review/tickets",
    iconBg: "bg-violet-100",
    iconColor: "text-violet-600",
    border: "border-violet-200 hover:border-violet-400",
  },
];

export default function ProgressReviewPage() {
  const navigate = useNavigate();

  return (
    <AppLayout>
      <div className="min-h-full bg-[#F4F8FC]">
        <div className="border-b border-[#DDE7F0] bg-white px-4 pb-5 pt-4 sm:px-6">
          <BackButton to="/" label="Home" />
          <h1 className="text-xl font-bold text-[#14264A]">Progress Review</h1>
          <p className="mt-0.5 text-sm text-[#5F7288]">Monitor and manage learner progress reviews</p>
        </div>

        <div className="p-4 sm:p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
                  <p className="text-base font-bold text-[#14264A] group-hover:text-[#1E6ACB]">{title}</p>
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
