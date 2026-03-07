import type { KbcCoach } from "@/lib/types/kbc";

export type UiCoach = {
  id: string;
  name: string;
  rating: string;
  programmes: string[];
  raw: any;
};

const parseProgrammeFromModule = (moduleStr: string) => {
  const s = String(moduleStr || "").trim();
  if (!s) return null;
  const parts = s.split(" - ").map(x => x.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
};

export function adaptCoach(c: KbcCoach): UiCoach {
  const programmes = new Set<string>();

  const learners = (c as any)?.attendance?.learners || [];
  for (const l of learners) {
    const att = l?.Attendance || {};
    for (const d of Object.keys(att)) {
      const mod = att?.[d]?.module;
      const p = parseProgrammeFromModule(mod);
      if (p) programmes.add(p);
    }
  }

  return {
    id: String((c as any)?.case_owner_id ?? (c as any)?.staff_id ?? (c as any)?.case_owner ?? ""),
    name: String((c as any)?.case_owner ?? "Unknown"),
    rating: String((c as any)?.rating ?? "Unknown"),
    programmes: Array.from(programmes).sort((a, b) => a.localeCompare(b)),
    raw: c,
  };
}