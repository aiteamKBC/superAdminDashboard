import type { KbcCoach } from "@/lib/types/kbc";
import { adaptCoach, type UiCoach } from "@/lib/adapters/kbcToUi";

type CoachesResponse =
  | KbcCoach[]
  | {
      success?: boolean;
      count?: number;
      rows?: KbcCoach[];
    };

/**
 * All API calls now go through the Django backend.
 * The backend handles external KBC API integration.
 */

const API_BASE_URL = "/api";

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${path}`;

  const headers = new Headers(init.headers || {});
  headers.set("accept", "application/json");

  const res = await fetch(url, { cache: "no-store", ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} ${text}`);
  }
  return (await res.json()) as T;
}

export async function fetchRawKbcCoaches(): Promise<KbcCoach[]> {
  const payload = await requestJson<CoachesResponse>("/coaches/all");

  const rows: KbcCoach[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.rows)
      ? payload.rows
      : [];

  return rows;
}

export async function fetchUiCoaches(): Promise<UiCoach[]> {
  const rows = await fetchRawKbcCoaches();
  return rows.map(adaptCoach).sort((a, b) => a.name.localeCompare(b.name));
}
