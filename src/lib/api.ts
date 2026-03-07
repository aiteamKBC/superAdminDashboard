const API_BASE_URL = "/api";
const API_KEY = String((import.meta as any).env?.VITE_API_KEY || "").trim();

export async function fetchAllCoachesAnalytics() {
  const res = await fetch(`${API_BASE_URL}/coaches/all`, {
    headers: {
      "x-api-key": API_KEY,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`API Error: ${res.status} ${txt}`);
  }

  return res.json();
}