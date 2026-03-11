import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { KpiCardData } from "@/types/dashboard";
import { Card } from "@/components/ui/card";

interface KpiCardProps {
  data: KpiCardData;
  onClick: () => void;
  active: boolean;
}

function getKpiBarColor(id: KpiCardData["id"]) {
  switch (id) {
    case "missed-session":
      return "var(--kpi-missed)";
    case "review-due":
      return "var(--kpi-review)";
    case "coaching-due":
      return "var(--kpi-coaching)";
    case "coaching-booked":
      return "#0ea5e9";
    case "otj-behind":
      return "var(--kpi-otj)";
    case "coach-marking-overdue":
      return "#8b5cf6";
    default:
      return "var(--kpi-review)";
  }
}

export default function KpiCard({ data, onClick, active }: KpiCardProps) {
  const trendIcon =
    data.trend > 0 ? (
      <TrendingUp className="w-3.5 h-3.5 text-severity-critical" />
    ) : data.trend < 0 ? (
      <TrendingDown className="w-3.5 h-3.5 text-severity-normal" />
    ) : (
      <Minus className="w-3.5 h-3.5 text-muted-foreground" />
    );

  const trendText = data.trend > 0 ? `+${data.trend}` : data.trend < 0 ? `${data.trend}` : "0";

  return (
    <Card
      onClick={onClick}
      className={`cursor-pointer border-l-4 ${data.accentClass} p-5 transition-all hover:shadow-md ${
        active ? "ring-2 ring-ring shadow-md" : ""
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <p className="text-sm font-medium text-muted-foreground leading-tight pr-2">{data.title}</p>
        <div className="flex items-center gap-1 shrink-0 text-xs text-muted-foreground">
          {trendIcon}
          <span>{trendText}</span>
        </div>
      </div>

      <div className="flex items-end gap-2">
        <span className="text-3xl font-bold text-foreground animate-count-up">{data.count}</span>
        <span className="text-sm text-muted-foreground mb-1">/ {data.total}</span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${data.percentage}%`,
              backgroundColor: getKpiBarColor(data.id),
            }}
          />
        </div>
        <span className="text-xs font-medium text-muted-foreground">{data.percentage}%</span>
      </div>
    </Card>
  );
}