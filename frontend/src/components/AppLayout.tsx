import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  ShieldCheck,
  UserPen,
  X,
} from "lucide-react";

import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/lib/auth";

const navItems = [
  { path: "/", label: "Home", icon: LayoutDashboard, section: "Operations" },
  { path: "/email-centre", label: "Email Centre", icon: Mail, section: "Operations" },
  { path: "/activity-report", label: "Activity Report", icon: BarChart3, section: "Reporting" },
  { path: "/calendar", label: "Calendar", icon: CalendarDays, section: "Reporting" },
  { path: "/administrator", label: "Administrator", icon: ShieldCheck, section: "Admin" },
];

const sections = ["Operations", "Reporting", "Admin"];

type SidebarExternalLinkProps = {
  href: string;
  collapsed: boolean;
  icon: "fa-user-pen";
  label: string;
  onClick?: () => void;
};

function SidebarExternalLink({
  href,
  collapsed,
  icon,
  label,
  onClick,
}: SidebarExternalLinkProps) {
  const Icon = icon === "fa-user-pen" ? UserPen : UserPen;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={collapsed ? label : undefined}
      onClick={onClick}
      className={`group relative flex min-h-11 items-center rounded-lg text-sm text-[#D9E7F6] transition-all duration-200 hover:bg-white/10 hover:text-white ${
        collapsed ? "justify-center px-2" : "gap-3 px-3"
      }`}
    >
      <Icon className="h-[18px] w-[18px] shrink-0 text-[#A9C7E8] group-hover:text-white" />
      <span
        className={`truncate font-semibold transition-all duration-300 ${
          collapsed ? "w-0 overflow-hidden opacity-0" : "w-auto opacity-100"
        }`}
      >
        {label}
      </span>
    </a>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const isMobile = useIsMobile();
  const isDesktop = !isMobile;
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("kbc-sidebar-collapsed") === "true";
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    window.localStorage.setItem("kbc-sidebar-collapsed", String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const handleSignOut = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const sidebar = (
    <aside
      className={`relative flex h-full shrink-0 flex-col overflow-visible border-r border-[#1F385B] bg-[#14264A] text-white shadow-[10px_0_28px_rgba(15,35,67,0.18)] transition-all duration-300 ${
        collapsed ? "w-[76px]" : "w-[252px]"
      }`}
    >
      <div
        className={`flex items-center border-b border-white/10 py-5 transition-all duration-300 ${
          collapsed ? "justify-center px-3" : "gap-3 px-4"
        }`}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#EAF5FF] text-[#14264A] shadow-sm">
          <LayoutDashboard className="h-5 w-5" />
        </div>

        <div
          className={`min-w-0 overflow-hidden transition-all duration-300 ${
            collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
          }`}
        >
          <h1 className="whitespace-nowrap text-sm font-bold leading-tight text-white">
            Kent Business College
          </h1>
          <p className="mt-0.5 whitespace-nowrap text-[11px] font-semibold text-[#A9C7E8]">
            Engagment Dashboard
          </p>
        </div>
      </div>

      <nav
        className={`flex-1 overflow-y-auto py-4 transition-all duration-300 ${
          collapsed ? "px-2" : "px-3"
        }`}
        aria-label="Main navigation"
      >
        {sections.map((section) => {
          const items = navItems.filter((item) => item.section === section);

          return (
            <div key={section} className="mb-5 last:mb-0">
              <div
                className={`mb-2 px-3 text-[10px] font-bold uppercase text-[#7EA6CF] transition-opacity ${
                  collapsed ? "h-0 overflow-hidden opacity-0" : "opacity-100"
                }`}
              >
                {section}
              </div>

              <div className="space-y-1">
                {items.map((item) => {
                  const active = location.pathname === item.path;

                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      title={collapsed ? item.label : undefined}
                      className={`group relative flex min-h-11 items-center rounded-lg text-sm transition-all duration-200 ${
                        collapsed ? "justify-center px-2" : "gap-3 px-3"
                      } ${
                        active
                          ? "bg-white text-[#14264A] shadow-[0_10px_22px_rgba(6,18,38,0.24)]"
                          : "text-[#D9E7F6] hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      {active && !collapsed ? (
                        <span className="absolute left-0 top-2 h-7 w-1 rounded-r-full bg-[#E4A11B]" />
                      ) : null}
                      <item.icon
                        className={`h-[18px] w-[18px] shrink-0 ${
                          active ? "text-[#1E6ACB]" : "text-[#A9C7E8] group-hover:text-white"
                        }`}
                      />
                      <span
                        className={`truncate font-semibold transition-all duration-300 ${
                          collapsed ? "w-0 overflow-hidden opacity-0" : "w-auto opacity-100"
                        }`}
                      >
                        {item.label}
                      </span>
                    </Link>
                  );
                })}
                {section === "Operations" ? (
                  <SidebarExternalLink
                    href="https://studentportal.kentbusinesscollege.net/"
                    collapsed={collapsed && isDesktop}
                    icon="fa-user-pen"
                    label="Edit Students Attendance"
                    onClick={() => !isDesktop && setMobileOpen(false)}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </nav>

      <div className={`border-t border-white/10 py-3 ${collapsed ? "px-2" : "px-3"}`}>
        <button
          type="button"
          onClick={handleSignOut}
          title={collapsed ? "Sign out" : undefined}
          className={`flex w-full min-h-11 items-center rounded-lg text-sm text-[#D9E7F6] transition-colors hover:bg-white/10 hover:text-white ${
            collapsed ? "justify-center px-2" : "gap-3 px-3"
          }`}
        >
          <LogOut className="h-[18px] w-[18px] shrink-0 text-[#A9C7E8]" />
          <span
            className={`min-w-0 text-left transition-all duration-300 ${
              collapsed ? "w-0 overflow-hidden opacity-0" : "w-auto opacity-100"
            }`}
          >
            <span className="block truncate text-xs font-bold">
              {user?.fullName || user?.username || "KBC user"}
            </span>
            <span className="block truncate text-[11px] text-[#8FB3D8]">Sign out</span>
          </span>
        </button>
      </div>

      <button
        onClick={() => setCollapsed((c) => !c)}
        className="absolute -right-4 top-[84px] z-30 hidden h-8 w-8 items-center justify-center rounded-full border border-[#D7E5F3] bg-white text-[#24486D] shadow-[0_8px_18px_rgba(20,38,74,0.18)] transition-colors hover:bg-[#F5FAFF] md:flex"
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        type="button"
      >
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
      </button>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-[#F4F8FC]">
      <div className="hidden md:block">{sidebar}</div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-[#061226]/45"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative h-full">{sidebar}</div>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
            className="absolute left-[264px] top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#24486D] shadow-md"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <main className="flex-1 overflow-auto bg-[#F4F8FC]">
        <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-[#DDE7F0] bg-white/95 px-4 backdrop-blur md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#D7E5F3] text-[#24486D]"
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="text-right">
            <p className="text-sm font-bold text-[#14264A]">KBC Dashboard</p>
            <p className="text-[11px] text-[#71849A]">Engagment Dashboard</p>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
