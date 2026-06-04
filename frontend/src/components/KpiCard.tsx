import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { KpiCardData } from "@/types/dashboard";
import { Card } from "@/components/ui/card";

interface KpiCardProps {
  data: KpiCardData;
  onClick: () => void;
  active: boolean;
}

function getKpiColor(id: KpiCardData["id"]) {
  switch (id) {
    case "missed-session":
      return "#9A6A13";
    case "review-due":
      return "#866CB6";
    case "coaching-due":
      return "#6D53A3";
    case "coaching-booked":
      return "#A78AD8";
    case "otj-behind":
      return "#C58412";
    case "review-booked":
      return "#b27715";
    case "coach-marking-overdue":
      return "#866CB6";
    default:
      return "#866CB6";
  }
}

function getKpiSoftBg(id: KpiCardData["id"]) {
  switch (id) {
    case "missed-session":
      return "#FFF9F0";
    case "review-due":
      return "#FCF8FF";
    case "review-booked":
      return "#F9F4EC";
    case "coaching-due":
      return "#F8F3FF";
    case "coaching-booked":
      return "#F8F3FF";
    case "otj-behind":
      return "#FFF8EE";
    case "coach-marking-overdue":
      return "#FCF8FF";
    default:
      return "#FCF8FF";
  }
}

function getKpiSubtitle(id: KpiCardData["id"]) {
  switch (id) {
    case "missed-session":
      return "Latest missed attendance signals";
    case "review-due":
      return "Learners matching PR rules";
    case "review-booked":
      return "Scheduled or completed PR activity";
    case "coaching-due":
      return "MCM activity required by period";
    case "coaching-booked":
      return "Scheduled or completed MCM activity";
    case "otj-behind":
      return "Learners behind OTJ target";
    case "coach-marking-overdue":
      return "Evidence awaiting marking";
    default:
      return "";
  }
}

export default function KpiCard({ data, onClick, active }: KpiCardProps) {
  const accent = getKpiColor(data.id);
  const softBg = getKpiSoftBg(data.id);
  const subtitle = getKpiSubtitle(data.id);

  const trendIcon =
    data.trend == null ? (
      <Minus className="h-3.5 w-3.5 text-[#8A8A8A]" />
    ) : data.trend > 0 ? (
      <TrendingUp className="h-3.5 w-3.5" style={{ color: "#D9485F" }} />
    ) : data.trend < 0 ? (
      <TrendingDown className="h-3.5 w-3.5" style={{ color: "#2E9E5B" }} />
    ) : (
      <Minus className="h-3.5 w-3.5 text-[#9A9A9A]" />
    );

  const trendText =
    data.trend == null ? "Live" : data.trend > 0 ? `+${data.trend}` : data.trend < 0 ? `${data.trend}` : "No change";

  return (
    <Card
      onClick={onClick}
      className="cursor-pointer rounded-2xl border-0 p-4 transition-all duration-200 hover:-translate-y-0.5"
      style={{
        backgroundColor: active ? softBg : "#FFFFFF",
        boxShadow: active
          ? `0 0 0 1px ${accent}55, inset 4px 0 0 ${accent}, 0 10px 24px rgba(20,20,20,0.08)`
          : "0 4px 14px rgba(20,20,20,0.04)",
      }}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-h-[46px] min-w-0 pr-2">
          <p className="text-sm font-semibold leading-5 text-[#686868] line-clamp-2">
            {data.title}
          </p>
          {subtitle && (
            <p className="mt-1 text-[11px] leading-4 text-[#9A9A9A] line-clamp-1">
              {subtitle}
            </p>
          )}
        </div>

        <div
          className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium"
          style={{
            backgroundColor: active ? "#FFFFFF" : "#F5F1FA",
            color: active ? accent : "#8A8A8A",
          }}
        >
          {trendIcon}
          <span>{trendText}</span>
        </div>
      </div>

      <div className="mb-3 flex items-end gap-2">
        <span className="text-[28px] font-bold leading-none text-[#2F2F2F]">
          {data.count}
        </span>
        <span className="mb-1 text-sm text-[#969696]">/ {data.total}</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#E8E8E8]">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${data.percentage}%`,
              backgroundColor: accent,
            }}
          />
        </div>

        <span className="min-w-[38px] text-right text-xs font-semibold text-[#8A8A8A]">
          {data.percentage}%
        </span>
      </div>

      <div className="mt-3 text-right">
        <span
          className="text-[11px] font-semibold"
          style={{ color: active ? accent : "#A78AD8" }}
        >
          {active ? "Selected" : "View"}
        </span>
      </div>
    </Card>
  );
}
