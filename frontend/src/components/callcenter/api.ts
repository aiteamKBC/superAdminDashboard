import { useCallback, useEffect, useState } from "react";

export type Case = {
  id: number; source_type: string; source_id: number | null; learner_email: string; learner_name: string;
  issue_name: string; issue_date: string | null;
  learner_phone: string; coach: string; organisation: string; programme: string; manager_name: string; manager_email: string;
  status: string; risk: string; claimed_by: string | null; claimed_agent_id: number | null;
  last_actor: string; last_action_at: string; attempts: number; next_followup_at: string | null;
  due_at: string; sla_breached: boolean; sla_days_overdue: number; learner_days_overdue: number; misses: number;
  booking_at: string | null; ai_summary: string; ai_confidence: number | null; resolution_option: string;
  resolved_at: string | null; resolved_by: string; archived: boolean; escalated: boolean;
  created_at: string; priority_why: string; source_data: Record<string, unknown>;
};
export type Config = {
  csrf_token: string; agent_id: number | null; is_manager: boolean; is_superuser: boolean; email_mode: string; ai_enabled: boolean;
  agents: {id: number; display_name: string; zoom_account: string; zoom_phone_number: string}[];
  sources: {name: string; last_success_at: string | null; details: {error?: string}}[];
  cycle: {last_success_at: string | null} | null;
};
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/callcentre/${path}`, {credentials: "include", cache: "no-store", ...options});
  const payload = await response.json().catch(() => ({detail: "The server returned an invalid response."}));
  if (!response.ok) throw new Error(payload.detail || "Request failed.");
  return payload as T;
}
export function useCallCentre<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => {
    if (!path) { setData(null); return; }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<T>(path, {signal: controller.signal}).then(value => {
      if (!controller.signal.aborted) setData(value);
    }).catch(e => {
      if (!controller.signal.aborted) { setError(e.message); setData(null); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, revision]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 60000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  return {data, error, loading, refresh};
}
export const stamp = (value: string | null) => value ? new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London",
}).format(new Date(value)) : "--";
export const category = (value: string) => ({attendance: "Lecture", pr: "PR", mcm: "MCM", otj: "OTJ", epa: "EPA", reminder: "Reminder", satisfaction: "Satisfaction"}[value] || value);
export type Issue = Pick<Case, "id" | "source_type" | "status" | "issue_name" | "issue_date">;
export function issueLabel(issue: Pick<Case, "source_type" | "issue_name" | "issue_date">) {
  const name = issue.issue_name?.trim() || category(issue.source_type);
  if (issue.source_type !== "attendance" || !issue.issue_date) return name;
  const date = new Intl.DateTimeFormat("en-GB", {day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/London"})
    .format(new Date(`${issue.issue_date}T12:00:00Z`));
  return `${name} - ${date}`;
}
export const statusLabel = (value: string) => value.replace(/_/g, " ");
export const londonDay = () => new Intl.DateTimeFormat("en-CA", {timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit"}).format(new Date());
export const hours = (seconds: number) => `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
