// All API calls now go through the Django backend
// The backend handles external API integration

const API_BASE_URL = "/api";

export async function fetchAllCoachesAnalytics() {
  const res = await fetch(`${API_BASE_URL}/coaches/all`, {
    headers: {
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