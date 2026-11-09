import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

interface BoundaryProps {
  children: ReactNode;
}

interface BoundaryState {
  hasError: boolean;
}

class RouteErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("The current page could not be rendered.", error, info);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <section className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wider text-blue-700">Kent Business College</p>
          <h1 className="mt-3 text-2xl font-bold text-slate-950">This page could not be displayed</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Refresh the page to try again. If the issue continues, return to the dashboard and open the page again.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Refresh page
            </button>
            <a
              href="/"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Back to dashboard
            </a>
          </div>
        </section>
      </main>
    );
  }
}

export default function AppErrorBoundary({ children }: BoundaryProps) {
  const location = useLocation();

  return <RouteErrorBoundary key={location.pathname}>{children}</RouteErrorBoundary>;
}
