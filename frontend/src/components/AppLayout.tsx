import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Mail,
  BarChart3,
  Settings,
  GraduationCap,
  ShieldCheck,
} from 'lucide-react';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/email-centre', label: 'Email Centre', icon: Mail },
  { path: '/activity-report', label: 'Activity Report', icon: BarChart3 },
  { path: '/administrator', label: 'Administrator', icon: ShieldCheck },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation();

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8F8F8]">
      <aside className="w-64 shrink-0 flex flex-col bg-gradient-to-b from-[#24105A] via-[#30156E] to-[#4A2F81] text-white border-r border-white/10 shadow-xl">
        <div className="px-5 py-5 flex items-center gap-3 border-b border-white/10">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/12 backdrop-blur-sm">
            <GraduationCap className="h-5 w-5 text-white" />
          </div>

          <div className="min-w-0">
            <h1 className="text-[15px] font-bold leading-tight text-white">
              Kent Business College
            </h1>
            <p className="text-[11px] text-white/65">
              Engagement Coordinator
            </p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-2 overflow-y-auto">
          {navItems.map((item) => {
            const active = location.pathname === item.path;

            return (
              <Link
                key={item.path}
                to={item.path}
                className={`group flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition-all duration-200 ${
                  active
                    ? 'bg-[#A88CD9] text-white shadow-sm'
                    : 'text-white/88 hover:bg-white/10 hover:text-white'
                }`}
              >
                <item.icon
                  className={`h-4 w-4 shrink-0 ${
                    active ? 'text-white' : 'text-white/90'
                  }`}
                />
                <span className="truncate font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className="flex-1 overflow-auto bg-[#F8F8F8]">
        {children}
      </main>
    </div>
  );
}