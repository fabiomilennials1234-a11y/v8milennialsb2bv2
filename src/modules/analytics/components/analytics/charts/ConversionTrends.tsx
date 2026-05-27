import { TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type ConversionTrend } from "@/modules/analytics/hooks/useAnalyticsPipesFunis";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";
import { AT } from "../analytics-tokens";

interface Props {
  trends: ConversionTrend[];
}

const MAX_SPARKLINE_HEIGHT = 28; // px

function Sparkline({ months }: { months: ConversionTrend["months"] }) {
  if (!months || months.length === 0) return null;

  const maxRate = Math.max(...months.map((m) => m.rate), 1);

  return (
    <div className="flex items-end gap-1 h-8">
      {months.map((m, i) => {
        const heightPx = Math.max(
          Math.round((m.rate / maxRate) * MAX_SPARKLINE_HEIGHT),
          2,
        );
        const isLast = i === months.length - 1;
        return (
          <div
            key={m.month_label}
            title={`${m.month_label}: ${m.rate}%`}
            className="w-3 rounded-sm transition-all"
            style={{
              height: `${heightPx}px`,
              backgroundColor: isLast ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.35)",
            }}
          />
        );
      })}
    </div>
  );
}

function getTrend(months: ConversionTrend["months"]): "up" | "down" | "flat" {
  if (months.length < 2) return "flat";
  const last = months[months.length - 1].rate;
  const prev = months[months.length - 2].rate;
  if (last > prev + 0.5) return "up";
  if (last < prev - 0.5) return "down";
  return "flat";
}

export function ConversionTrends({ trends }: Props) {
  if (!trends || trends.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className={AT.chartTitle}>Tendências de Conversão</CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState
            message="Sem dados de tendência disponíveis"
            detail="Dados históricos dos últimos 6 meses aparecerão aqui."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={AT.chartTitle}>Tendências de Conversão (6 meses)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {trends.map((trend) => {
          const direction = getTrend(trend.months);
          const currentRate =
            trend.months.length > 0
              ? trend.months[trend.months.length - 1].rate
              : 0;

          const trendColor =
            direction === "up"
              ? "text-green-600 dark:text-green-400"
              : direction === "down"
              ? "text-destructive"
              : "text-muted-foreground";

          return (
            <div
              key={trend.transition_name}
              className="flex items-center gap-4 rounded-lg border border-border bg-card p-3"
            >
              {/* Sparkline */}
              <div className="shrink-0">
                <Sparkline months={trend.months} />
              </div>

              {/* Label */}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">
                  {trend.transition_name}
                </div>
                <div className="text-xs text-muted-foreground">
                  últimos 6 meses
                </div>
              </div>

              {/* Current value + trend icon */}
              <div className={`flex items-center gap-1 shrink-0 font-bold text-base ${trendColor}`}>
                {direction === "up" && <TrendingUp className="h-4 w-4" />}
                {direction === "down" && <TrendingDown className="h-4 w-4" />}
                {currentRate}%
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
