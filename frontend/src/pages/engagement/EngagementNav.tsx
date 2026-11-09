import { Link, useLocation } from "react-router-dom";
import { BarChart3, PhoneCall, Users } from "lucide-react";

const items = [
  { path: "/activity-report", label: "Overview & cases", icon: BarChart3 },
  { path: "/engagement-centre/team", label: "Team performance", icon: Users },
  { path: "/engagement-centre/calls", label: "Call register", icon: PhoneCall },
];

export default function EngagementNav() {
  const location = useLocation();
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Engagement Centre administration">
      {items.map((item) => {
        const active = location.pathname === item.path
          || (item.path.includes("/team") && location.pathname.includes("/specialists/"));
        return (
          <Link
            key={item.path}
            to={item.path}
            className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-xs font-bold transition ${
              active
                ? "border-[#14264A] bg-[#14264A] text-white shadow-sm"
                : "border-[#D7E5F3] bg-white text-[#314A67] hover:border-[#8EB3D8] hover:bg-[#F7FBFF]"
            }`}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
