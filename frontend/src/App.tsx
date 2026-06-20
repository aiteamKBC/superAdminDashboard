import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, ProtectedRoute } from "@/lib/auth";
import HomePage from "./pages/HomePage";
import Dashboard from "./pages/Index";
import AttendancePage from "./pages/AttendancePage";
import TrackAttendancePage from "./pages/attendance/TrackAttendancePage";
import AttendanceTicketsPage from "./pages/attendance/AttendanceTicketsPage";
import EmailCentre from "./pages/EmailCentre";
import ActivityReport from "./pages/ActivityReport";
import AdminPage from "./pages/AdminPage";
import CalendarPage from "./pages/CalendarPage";
import LoginPage from "./pages/LoginPage";
import NotFound from "./pages/NotFound";
import ProgressReviewPage from "./pages/progress-review/ProgressReviewPage";
import RequiredPRPage from "./pages/progress-review/RequiredPRPage";
import ScheduledPRPage from "./pages/progress-review/ScheduledPRPage";
import PRTicketsPage from "./pages/progress-review/PRTicketsPage";
import OTJPage from "./pages/otj/OTJPage";
import TrackOTJPage from "./pages/otj/TrackOTJPage";
import OTJTicketsPage from "./pages/otj/OTJTicketsPage";
import MarkingPage from "./pages/MarkingPage";
import ActiveLearnersPage from "./pages/ActiveLearnersPage";
import MCMPage from "./pages/mcm/MCMPage";
import RequiredMCMPage from "./pages/mcm/RequiredMCMPage";
import ScheduledMCMPage from "./pages/mcm/ScheduledMCMPage";
import MCMTicketsPage from "./pages/mcm/MCMTicketsPage";
import GatewayPage from "./pages/gateway/GatewayPage";
import EPALearnersPage from "./pages/gateway/EPALearnersPage";
import EPATicketsPage from "./pages/gateway/EPATicketsPage";

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
            <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/attendance" element={<ProtectedRoute><AttendancePage /></ProtectedRoute>} />
            <Route path="/attendance/track" element={<ProtectedRoute><TrackAttendancePage /></ProtectedRoute>} />
            <Route path="/attendance/tickets" element={<ProtectedRoute><AttendanceTicketsPage /></ProtectedRoute>} />
            <Route path="/email-centre" element={<ProtectedRoute><EmailCentre /></ProtectedRoute>} />
            <Route path="/activity-report" element={<ProtectedRoute><ActivityReport /></ProtectedRoute>} />
            <Route path="/administrator" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
            <Route path="/calendar" element={<ProtectedRoute><CalendarPage /></ProtectedRoute>} />
            <Route path="/progress-review" element={<ProtectedRoute><ProgressReviewPage /></ProtectedRoute>} />
            <Route path="/progress-review/required" element={<ProtectedRoute><RequiredPRPage /></ProtectedRoute>} />
            <Route path="/progress-review/scheduled" element={<ProtectedRoute><ScheduledPRPage /></ProtectedRoute>} />
            <Route path="/progress-review/tickets" element={<ProtectedRoute><PRTicketsPage /></ProtectedRoute>} />
            <Route path="/otj-hours" element={<ProtectedRoute><OTJPage /></ProtectedRoute>} />
            <Route path="/otj-hours/track" element={<ProtectedRoute><TrackOTJPage /></ProtectedRoute>} />
            <Route path="/otj-hours/tickets" element={<ProtectedRoute><OTJTicketsPage /></ProtectedRoute>} />
            <Route path="/marking" element={<ProtectedRoute><MarkingPage /></ProtectedRoute>} />
            <Route path="/active-learners" element={<ProtectedRoute><ActiveLearnersPage /></ProtectedRoute>} />
            <Route path="/coaching-meetings" element={<ProtectedRoute><MCMPage /></ProtectedRoute>} />
            <Route path="/coaching-meetings/required" element={<ProtectedRoute><RequiredMCMPage /></ProtectedRoute>} />
            <Route path="/coaching-meetings/scheduled" element={<ProtectedRoute><ScheduledMCMPage /></ProtectedRoute>} />
            <Route path="/coaching-meetings/tickets" element={<ProtectedRoute><MCMTicketsPage /></ProtectedRoute>} />
            <Route path="/gateway" element={<ProtectedRoute><GatewayPage /></ProtectedRoute>} />
            <Route path="/gateway/close" element={<ProtectedRoute><EPALearnersPage mode="close" /></ProtectedRoute>} />
            <Route path="/gateway/overdue" element={<ProtectedRoute><EPALearnersPage mode="overdue" /></ProtectedRoute>} />
            <Route path="/gateway/entered-epa" element={<ProtectedRoute><EPALearnersPage mode="entered" /></ProtectedRoute>} />
            <Route path="/gateway/tickets" element={<ProtectedRoute><EPATicketsPage /></ProtectedRoute>} />
            <Route path="*" element={<ProtectedRoute><NotFound /></ProtectedRoute>} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
