import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, ProtectedRoute } from "@/lib/auth";
import Dashboard from "./pages/Index";
import EmailCentre from "./pages/EmailCentre";
import ActivityReport from "./pages/ActivityReport";
import AdminPage from "./pages/AdminPage";
import CalendarPage from "./pages/CalendarPage";
import LoginPage from "./pages/LoginPage";
import NotFound from "./pages/NotFound";
// import DashboardPage from "@/pages/DashboardPage";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/email-centre" element={<ProtectedRoute><EmailCentre /></ProtectedRoute>} />
            <Route path="/activity-report" element={<ProtectedRoute><ActivityReport /></ProtectedRoute>} />
            <Route path="/administrator" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
            <Route path="/calendar" element={<ProtectedRoute><CalendarPage /></ProtectedRoute>} />
            <Route path="*" element={<ProtectedRoute><NotFound /></ProtectedRoute>} />
            {/* <Route path="/dashboard" element={<DashboardPage />} /> */}
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
