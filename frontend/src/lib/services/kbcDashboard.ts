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
 * CORE API, attendance, progress reviews, coaches
 * USERS API, learner profile, organisation, programme, OTJ
 *
 * CORE uses VITE_API_ORIGIN + VITE_API_KEY
 * USERS falls back to CORE unless VITE_USERS_API_ORIGIN (and optional VITE_USERS_API_KEY) are provided
 */

const CORE_API_ORIGIN =
  (import.meta as any).env?.VITE_API_ORIGIN?.toString().trim() || "/api";
const CORE_API_KEY =
  (import.meta as any).env?.VITE_API_KEY?.toString().trim() || "";

const USERS_API_ORIGIN =
  (import.meta as any).env?.VITE_USERS_API_ORIGIN?.toString().trim() ||
  CORE_API_ORIGIN;
const USERS_API_KEY =
  (import.meta as any).env?.VITE_USERS_API_KEY?.toString().trim() ||
  CORE_API_KEY;

function joinUrl(base: string, path: string) {
  const b = String(base || "").replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

async function requestJson<T>(
  base: string,
  apiKey: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const url = joinUrl(base, path);

  const headers = new Headers(init.headers || {});
  headers.set("accept", "application/json");
  if (apiKey) headers.set("x-api-key", apiKey);

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} ${text}`);
  }
  return (await res.json()) as T;
}

export async function fetchRawKbcCoaches(): Promise<KbcCoach[]> {
  const payload = await requestJson<CoachesResponse>(
    CORE_API_ORIGIN,
    CORE_API_KEY,
    "/coaches/all"
  );

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