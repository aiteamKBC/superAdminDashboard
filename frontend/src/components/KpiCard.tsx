import {
  AlertTriangle,
  CalendarCheck2,
  CheckCircle2,
  ClipboardCheck,
  FileClock,
  LucideIcon,
  Minus,
  Target,
  TrendingDown,
  TrendingUp,
  UsersRound,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import type { KpiCardData } from "@/types/dashboard";

interface KpiCardProps {
  data: KpiCardData;
  onClick: () => void;
  active: boolean;
}

type KpiVisual = {
  accent: string;
  soft: string;
  text: string;
  icon: LucideIcon;
  subtitle: string;
};

const kpiVisuals: Record<KpiCardData["id"], KpiVisual> = {
  "missed-session": {
    accent: "#E05C68",
    soft: "#FFF1F3",
    text: "#B42332",
    icon: AlertTriangle,
    subtitle: "Learners needing attendance follow-up",
  },
  "review-due": {
    accent: "#2D73D5",
    soft: "#EEF5FF",
    text: "#184D91",
    icon: FileClock,
    subtitle: "Progress reviews due in the selected period",
  },
  "review-booked": {
    accent: "#1C9B7A",
    soft: "#ECFAF6",
    text: "#0F6F57",
    icon: CalendarCheck2,
    subtitle: "Progress review sessions already planned",
  },
  "coaching-due": {
    accent: "#7A61D1",
    soft: "#F3F0FF",
    text: "#5440A3",
    icon: UsersRound,
    subtitle: "Monthly coaching actions required",
  },
  "coaching-booked": {
    accent: "#0E8EC7",
    soft: "#ECF9FF",
    text: "#076B96",
    icon: CheckCircle2,
    subtitle: "Monthly coaching sessions booked",
  },
  "otj-behind": {
    accent: "#E4A11B",
    soft: "#FFF8E8",
    text: "#94610A",
    icon: Target,
    subtitle: "Learners behind their OTJH target",
  },
  "coach-marking-overdue": {
    accent: "#31506F",
    soft: "#EDF4FA",
    text: "#243F5A",
    icon: ClipboardCheck,
    subtitle: "Evidence waiting for coach marking",
  },
  "status-view": {
    accent: "#31506F",
    soft: "#EDF4FA",
    text: "#243F5A",
    icon: UsersRound,
    subtitle: "Learners matching the selected status",
  },
};

export default function KpiCard({ data, onClick, active }: KpiCardProps) {
  const visual = kpiVisuals[data.id];
  const Icon = visual.icon;

  const trendIcon =
    data.trend == null ? (
      <Minus className="h-3.5 w-3.5" />
    ) : data.trend > 0 ? (
      <TrendingUp className="h-3.5 w-3.5" />
    ) : data.trend < 0 ? (
      <TrendingDown className="h-3.5 w-3.5" />
    ) : (
      <Minus className="h-3.5 w-3.5" />
    );

  const trendText =
    data.trend == null
      ? "Live"
      : data.trend > 0
        ? `+${data.trend}`
        : data.trend < 0
          ? `${data.trend}`
          : "Stable";

  return (
    <Card
      onClick={onClick}
      className="group h-full cursor-pointer rounded-lg border border-[#DDE7F0] bg-white p-4 shadow-[0_8px_22px_rgba(20,38,74,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#B9C9DA] hover:shadow-[0_14px_30px_rgba(20,38,74,0.10)]"
      style={{
        background: active ? visual.soft : "#FFFFFF",
        boxShadow: active
          ? `inset 0 0 0 1px ${visual.accent}55, inset 4px 0 0 ${visual.accent}, 0 16px 34px rgba(20,38,74,0.12)`
          : undefined,
      }}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div
            className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg"
            style={{ backgroundColor: visual.soft, color: visual.text }}
          >
            <Icon className="h-[18px] w-[18px]" />
          </div>
          <p className="line-clamp-2 text-sm font-semibold leading-5 text-[#20344D]">
            {data.title}
          </p>
          <p className="mt-1 line-clamp-2 text-xs leading-4 text-[#71849A]">
            {visual.subtitle}
          </p>
        </div>

        <div
          className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ring-1"
          style={{
            backgroundColor: active ? "#FFFFFF" : visual.soft,
            color: data.trend && data.trend > 0 ? "#B42332" : visual.text,
            borderColor: `${visual.accent}33`,
          }}
        >
          {trendIcon}
          <span>{trendText}</span>
        </div>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold leading-none tracking-normal text-[#10233F]">
              {data.count}
            </span>
            <span className="text-sm font-medium text-[#8292A6]">of {data.total}</span>
          </div>
          <p className="mt-1 text-xs font-medium text-[#71849A]">{data.percentage}% of cohort</p>
        </div>

        <span
          className="rounded-full px-2.5 py-1 text-xs font-bold"
          style={{
            backgroundColor: active ? "#FFFFFF" : visual.soft,
            color: visual.text,
          }}
        >
          {active ? "Selected" : "Open"}
        </span>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#E8EEF5]">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.max(0, Math.min(data.percentage, 100))}%`,
            backgroundColor: visual.accent,
          }}
        />
      </div>
    </Card>
  );
}
