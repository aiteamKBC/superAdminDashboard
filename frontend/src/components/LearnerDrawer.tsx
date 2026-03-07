// Learners Data on the right
import { useState } from "react";
import { Learner, EngagementAction, CallOutcome } from "@/types/dashboard";
import { mockActions } from "@/data/mockData";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Phone,
  Mail,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  User,
  Building,
  BookOpen,
  Clock,
  MessageSquare,
} from "lucide-react";

interface LearnerDrawerProps {
  learner: Learner | null;
  open: boolean;
  onClose: () => void;
}

const kpiLabels: Record<string, string> = {
  "missed-session": "Missed Session",
  "review-due": "Review Due",
  "coaching-due": "Coaching Due",
  "otj-behind": "OTJ Behind",
};

const outcomeOptions: CallOutcome[] = [
  "Sent email with details",
  "Booked an appointment with the coach",
  "Escalated to line manager",
  "Escalated to HR",
  "No answer – voicemail left",
  "No answer – will try again",
  "Other (specify)",
];

const safeText = (v: unknown, fallback = "Unknown") => {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
};

export default function LearnerDrawer({ learner, open, onClose }: LearnerDrawerProps) {
  const [showCallLog, setShowCallLog] = useState(false);
  const [callOutcome, setCallOutcome] = useState<CallOutcome | "">("");
  const [callNotes, setCallNotes] = useState("");

  if (!learner) return null;

  const actions = mockActions
    .filter((a) => a.learnerId === learner.id)
    .sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime());

  const expected = learner.expectedOtjHours || 0;
  const actual = learner.actualOtjHours || 0;
  const behindPct = expected > 0 ? Math.round(((expected - actual) / expected) * 100) : 0;

  const iconForType = (type: EngagementAction["type"]) => {
    switch (type) {
      case "call":
        return <Phone className="w-3.5 h-3.5" />;
      case "email":
        return <Mail className="w-3.5 h-3.5" />;
      case "escalation":
        return <AlertTriangle className="w-3.5 h-3.5" />;
      case "appointment":
        return <Calendar className="w-3.5 h-3.5" />;
      case "resolved":
        return <CheckCircle2 className="w-3.5 h-3.5" />;
      default:
        return <MessageSquare className="w-3.5 h-3.5" />;
    }
  };

  const organisation = safeText(learner.organisation, "Unknown");
  const programme = safeText(learner.programme, "Unknown");

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-xl">
            {learner.firstName} {learner.lastName}
          </SheetTitle>

          <div className="flex gap-2 flex-wrap">
            {(learner.riskCategories || []).map((c) => (
              <Badge key={c} variant="outline" className="text-[11px]">
                {kpiLabels[c] || String(c)}
              </Badge>
            ))}

            {learner.priority !== "normal" && (
              <Badge
                className={`text-[11px] border-0 ${
                  learner.priority === "critical"
                    ? "bg-severity-critical-bg text-severity-critical-foreground"
                    : "bg-severity-overdue-bg text-severity-overdue-foreground"
                }`}
              >
                {learner.priority === "critical" ? "Critical" : "High Priority"}
              </Badge>
            )}
          </div>
        </SheetHeader>

        <div className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <User className="w-3.5 h-3.5" /> {safeText(learner.coach, "N/A")}
            </div>

            <div className="flex items-center gap-2 text-muted-foreground">
              <Building className="w-3.5 h-3.5" /> {organisation}
            </div>

            <div className="flex items-center gap-2 text-muted-foreground">
              <BookOpen className="w-3.5 h-3.5" /> {programme}
            </div>

            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="w-3.5 h-3.5" /> {safeText(learner.phone, "N/A")}
            </div>

            <div className="flex items-center gap-2 text-muted-foreground col-span-2">
              <Mail className="w-3.5 h-3.5" /> {safeText(learner.email, "N/A")}
            </div>
          </div>

          <div className="flex gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-xs">
              <span className="text-muted-foreground">Absence ratio:</span>
              <span
                className={`font-semibold ${
                  (learner.absenceRatio || 0) > 25
                    ? "text-severity-critical"
                    : (learner.absenceRatio || 0) > 15
                    ? "text-severity-overdue"
                    : "text-foreground"
                }`}
              >
                {learner.absenceRatio || 0}%
              </span>
            </div>

            <div className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-xs">
              <span className="text-muted-foreground">Missed (last 10):</span>
              <span
                className={`font-semibold ${
                  (learner.missedLast10Weeks || 0) >= 3
                    ? "text-severity-critical"
                    : (learner.missedLast10Weeks || 0) >= 2
                    ? "text-severity-overdue"
                    : "text-foreground"
                }`}
              >
                {learner.missedLast10Weeks || 0}
              </span>
            </div>

            <div className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-xs">
              <span className="text-muted-foreground">Missed in row:</span>
              <span
                className={`font-semibold ${
                  (learner.missedInRow || 0) >= 3
                    ? "text-severity-critical"
                    : (learner.missedInRow || 0) >= 2
                    ? "text-severity-overdue"
                    : "text-foreground"
                }`}
              >
                {learner.missedInRow || 0}
              </span>
            </div>
          </div>

          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
              <Clock className="w-3 h-3" /> OTJ Hours
            </p>
            <div className="flex items-center gap-4 text-sm">
              <div>
                <span className="font-semibold text-foreground">{actual}</span>
                <span className="text-muted-foreground">/{expected}h</span>
              </div>
              <div
                className={`font-semibold ${
                  behindPct > 40 ? "text-severity-critical" : behindPct > 20 ? "text-severity-overdue" : "text-severity-normal"
                }`}
              >
                {behindPct > 0 ? `${behindPct}% behind` : "On track"}
              </div>
            </div>
            <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${expected > 0 ? Math.min(100, (actual / expected) * 100) : 0}%` }}
              />
            </div>
          </div>

          <Separator />

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setShowCallLog(!showCallLog)} className="gap-1.5">
              <Phone className="w-3.5 h-3.5" /> Log a Call
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5">
              <Mail className="w-3.5 h-3.5" /> Send Email
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> Escalate
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5">
              <Calendar className="w-3.5 h-3.5" /> Book Appointment
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Mark Resolved
            </Button>
          </div>

          {showCallLog && (
            <div className="bg-muted/50 rounded-lg p-4 space-y-3 animate-fade-in">
              <p className="text-sm font-medium text-foreground">Log Call</p>

              <Select value={callOutcome} onValueChange={(v) => setCallOutcome(v as CallOutcome)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select outcome" />
                </SelectTrigger>
                <SelectContent>
                  {outcomeOptions.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Textarea
                placeholder="Notes..."
                value={callNotes}
                onChange={(e) => setCallNotes(e.target.value)}
                rows={3}
              />

              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setShowCallLog(false);
                    setCallOutcome("");
                    setCallNotes("");
                  }}
                >
                  Save Log
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowCallLog(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <Separator />

          <div>
            <p className="text-sm font-medium text-foreground mb-3">Engagement Timeline</p>
            <div className="space-y-3">
              {actions.length === 0 && <p className="text-sm text-muted-foreground">No actions recorded yet.</p>}
              {actions.slice(0, 10).map((a) => (
                <div key={a.id} className="flex gap-3 text-sm">
                  <div className="mt-1 w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
                    {iconForType(a.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground capitalize">{a.type}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(a.dateTime).toLocaleDateString()}{" "}
                        {new Date(a.dateTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    {a.outcome && <p className="text-muted-foreground text-xs">{a.outcome}</p>}
                    {a.notes && <p className="text-muted-foreground text-xs mt-0.5">{a.notes}</p>}
                    <p className="text-xs text-muted-foreground/60">by {a.userName}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}