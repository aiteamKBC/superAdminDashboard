import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Mail,
  BarChart3,
  Settings,
  GraduationCap,
  ShieldCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/email-centre', label: 'Email Centre', icon: Mail },
  { path: '/activity-report', label: 'Activity Report', icon: BarChart3 },
  { path: '/calendar', label: 'Calendar', icon: CalendarDays },
  { path: '/administrator', label: 'Administrator', icon: ShieldCheck },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8F8F8]">
      <aside
        className={`relative shrink-0 flex flex-col bg-gradient-to-b from-[#24105A] via-[#30156E] to-[#4A2F81] text-white border-r border-white/10 shadow-xl transition-all duration-300 ${
          collapsed ? 'w-[68px]' : 'w-64'
        }`}
      >
        {/* Header */}
        <div
          className={`py-5 flex items-center border-b border-white/10 transition-all duration-300 ${
            collapsed ? 'px-3 justify-center' : 'px-5 gap-3'
          }`}
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/12 backdrop-blur-sm">
            <GraduationCap className="h-5 w-5 text-white" />
          </div>

          <div
            className={`min-w-0 overflow-hidden transition-all duration-300 ${
              collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
            }`}
          >
            <h1 className="text-[15px] font-bold leading-tight text-white whitespace-nowrap">
              Kent Business College
            </h1>
            <p className="text-[11px] text-white/65 whitespace-nowrap">
              Engagement Coordinator
            </p>
          </div>
        </div>

        {/* Nav */}
        <nav
          className={`flex-1 py-4 space-y-1 overflow-y-auto transition-all duration-300 ${
            collapsed ? 'px-2' : 'px-3'
          }`}
        >
          {navItems.map((item) => {
            const active = location.pathname === item.path;

            return (
              <Link
                key={item.path}
                to={item.path}
                title={collapsed ? item.label : undefined}
                className={`group flex items-center rounded-xl py-3 text-sm transition-all duration-200 ${
                  collapsed ? 'justify-center px-2' : 'gap-3 px-4'
                } ${
                  active
                    ? 'bg-[#A88CD9] text-white shadow-sm'
                    : 'text-white/88 hover:bg-white/10 hover:text-white'
                }`}
              >
                <item.icon
                  className={`h-[18px] w-[18px] shrink-0 ${
                    active ? 'text-white' : 'text-white/90'
                  }`}
                />
                <span
                  className={`truncate font-medium transition-all duration-300 ${
                    collapsed ? 'w-0 opacity-0 overflow-hidden' : 'w-auto opacity-100'
                  }`}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="absolute -right-3 top-[78px] z-20 flex h-6 w-6 items-center justify-center rounded-full bg-[#A88CD9] text-white shadow-md hover:bg-[#9678CC] transition-colors border-2 border-white/20"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <ChevronLeft className="h-3 w-3" />
          )}
        </button>
      </aside>

      <main className="flex-1 overflow-auto bg-[#F8F8F8]">
        {children}
      </main>
    </div>
  );
}
