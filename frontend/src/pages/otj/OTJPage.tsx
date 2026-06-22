import { useNavigate } from "react-router-dom";
import { BriefcaseBusiness, Ticket, Clock } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import BackButton from "@/components/BackButton";

const CARDS = [
  {
    key: "track",
    title: "Track OTJH",
    description: "Learners behind on off-the-job hours — status: At Risk",
    icon: Clock,
    path: "/otj-hours/track",
    iconBg: "bg-[#E5F0F7]",
    iconColor: "text-[#24557F]",
    border: "border-[#C7DCEB] hover:border-[#7198B7]",
  },
  {
    key: "tickets",
    title: "OTJH Ticket System",
    description: "Manage and track off-the-job hours support tickets",
    icon: Ticket,
    path: "/otj-hours/tickets",
    iconBg: "bg-[#EBF2F9]",
    iconColor: "text-[#315D93]",
    border: "border-[#CDDCEB] hover:border-[#7899BC]",
  },
];

export default function OTJPage() {
  const navigate = useNavigate();

  return (
    <AppLayout>
      <div className="min-h-full bg-[#F4F8FC]">
        <div className="border-b border-[#DDE7F0] bg-white px-4 pb-5 pt-4 sm:px-6">
          <BackButton to="/" label="Home" />
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E5F0F7]">
              <BriefcaseBusiness className="h-5 w-5 text-[#24557F]" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#14264A]">Off The Job Hours</h1>
              <p className="mt-0.5 text-sm text-[#5F7288]">Monitor and manage learner OTJH</p>
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
                  <p className="text-base font-bold text-[#14264A] group-hover:text-[#24557F]">{title}</p>
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
