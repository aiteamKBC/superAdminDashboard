import { ReactNode, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Mail,
  BarChart3,
  GraduationCap,
  ShieldCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  LogOut,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, section: 'Operations' },
  { path: '/email-centre', label: 'Email Centre', icon: Mail, section: 'Operations' },
  { path: '/activity-report', label: 'Activity Report', icon: BarChart3, section: 'Reporting' },
  { path: '/calendar', label: 'Calendar', icon: CalendarDays, section: 'Reporting' },
  { path: '/administrator', label: 'Administrator', icon: ShieldCheck, section: 'Admin' },
];

const sections = ['Operations', 'Reporting', 'Admin'];

export default function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('kbc-sidebar-collapsed') === 'true';
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    window.localStorage.setItem('kbc-sidebar-collapsed', String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const handleSignOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const sidebar = (
    <aside
      className={`relative flex h-full shrink-0 flex-col overflow-visible border-r border-white/10 bg-gradient-to-b from-[#241453] via-[#442F73] to-[#866CB6] text-white shadow-[12px_0_36px_rgba(68,47,115,0.22)] transition-all duration-300 ${
        collapsed ? 'w-[76px]' : 'w-[264px]'
      }`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(255,255,255,0.18),transparent_28%),linear-gradient(135deg,rgba(178,119,21,0.18),transparent_42%)]" />
      <div
        className={`relative flex items-center border-b border-white/12 py-5 transition-all duration-300 ${
          collapsed ? 'justify-center px-3' : 'gap-3 px-5'
        }`}
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/16 text-white shadow-sm ring-1 ring-white/18 backdrop-blur-sm">
          <GraduationCap className="h-5 w-5" />
        </div>

        <div
          className={`min-w-0 overflow-hidden transition-all duration-300 ${
            collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
          }`}
        >
          <h1 className="whitespace-nowrap text-[14px] font-bold leading-tight text-white">
            Kent Business College
          </h1>
          <p className="mt-0.5 whitespace-nowrap text-[11px] font-medium text-[#E9D9BD]">
            Engagement Workspace
          </p>
        </div>
      </div>

      <nav
        className={`relative flex-1 overflow-y-auto py-4 transition-all duration-300 ${
          collapsed ? 'px-2' : 'px-3'
        }`}
        aria-label="Main navigation"
      >
        {sections.map((section) => {
          const items = navItems.filter((item) => item.section === section);

          return (
            <div key={section} className="mb-4 last:mb-0">
              <div
                className={`mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-white/48 transition-opacity ${
                  collapsed ? 'h-0 overflow-hidden opacity-0' : 'opacity-100'
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
                      className={`group relative flex min-h-11 items-center rounded-xl text-sm transition-all duration-200 ${
                        collapsed ? 'justify-center px-2' : 'gap-3 px-3'
                      } ${
                        active
                          ? 'bg-white text-[#442F73] shadow-[0_10px_22px_rgba(36,20,83,0.22)]'
                          : 'text-white/82 hover:bg-white/12 hover:text-white'
                      }`}
                    >
                      {active && !collapsed ? (
                        <span className="absolute left-0 top-2 h-7 w-1 rounded-r-full bg-[#B27715]" />
                      ) : null}
                      <item.icon
                        className={`h-[18px] w-[18px] shrink-0 ${
                          active ? 'text-[#B27715]' : 'text-white/74 group-hover:text-white'
                        }`}
                      />
                      <span
                        className={`truncate font-semibold transition-all duration-300 ${
                          collapsed ? 'w-0 overflow-hidden opacity-0' : 'w-auto opacity-100'
                        }`}
                      >
                        {item.label}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className={`relative border-t border-white/12 py-3 ${collapsed ? 'px-2' : 'px-3'}`}>
        <button
          type="button"
          onClick={handleSignOut}
          title={collapsed ? 'Sign out' : undefined}
          className={`flex w-full min-h-11 items-center rounded-xl text-sm text-white/82 transition-colors hover:bg-white/12 hover:text-white ${
            collapsed ? 'justify-center px-2' : 'gap-3 px-3'
          }`}
        >
          <LogOut className="h-[18px] w-[18px] shrink-0 text-white/74" />
          <span
            className={`min-w-0 text-left transition-all duration-300 ${
              collapsed ? 'w-0 overflow-hidden opacity-0' : 'w-auto opacity-100'
            }`}
          >
            <span className="block truncate text-xs font-bold">{user?.fullName || user?.username || 'KBC user'}</span>
            <span className="block truncate text-[11px] text-white/58">Sign out</span>
          </span>
        </button>
      </div>

      <button
        onClick={() => setCollapsed((c) => !c)}
        className="absolute -right-4 top-[84px] z-30 hidden h-8 w-8 items-center justify-center rounded-full border border-[#E6DDF4] bg-white text-[#644D93] shadow-[0_6px_18px_rgba(68,47,115,0.22)] transition-colors hover:bg-[#F9F4EC] md:flex"
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        type="button"
      >
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
      </button>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8F8F8]">
      <div className="hidden md:block">{sidebar}</div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/25"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative h-full">{sidebar}</div>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
            className="absolute left-[276px] top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#644D93] shadow-md"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <main className="flex-1 overflow-auto bg-[#F8F8F8]">
        <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-[#E8E2F0] bg-white/95 px-4 backdrop-blur md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E4E4E4] text-[#644D93]"
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="text-right">
            <p className="text-sm font-bold text-[#2F2F2F]">KBC Dashboard</p>
            <p className="text-[11px] text-[#808080]">Engagement Workspace</p>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
