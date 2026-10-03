import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { type MonthlyTrendRow } from "@/modules/analytics/hooks/useAnalyticsEngajamento";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";
import { formatResponseTime } from "./EngagementKPIs";
import { AT } from "../analytics-tokens";

interface Props {
  data: MonthlyTrendRow[];
}

type MetricKey = keyof Omit<MonthlyTrendRow, "month_label">;

interface MetricDef {
  key: MetricKey;
  label: string;
  format: (v: number) => string;
  lowerIsBetter: boolean;
}

const METRICS: MetricDef[] = [
  {
    key: "response_rate",
    label: "Taxa Resposta",
    format: (v) => `${v.toFixed(1)}%`,
    lowerIsBetter: false,
  },
  {
    key: "our_avg_response_seconds",
    label: "Nosso Tempo",
    format: (v) => formatResponseTime(v),
    lowerIsBetter: true,
  },
  {
    key: "client_avg_response_seconds",
    label: "Tempo Cliente",
    format: (v) => formatResponseTime(v),
    lowerIsBetter: true,
  },
  {
    key: "close_rate",
    label: "Taxa Fechamento",
    format: (v) => `${v.toFixed(1)}%`,
    lowerIsBetter: false,
  },
];

function cellColor(
  current: number,
  prev: number | undefined,
  lowerIsBetter: boolean,
): string {
  if (prev === undefined) return "bg-muted/30 text-foreground";
  const improved = lowerIsBetter ? current < prev : current > prev;
  const degraded = lowerIsBetter ? current > prev : current < prev;
  if (improved) return "bg-green-500/15 text-green-700 dark:text-green-400";
  if (degraded) return "bg-destructive/10 text-destructive";
  return "bg-muted/30 text-foreground";
}

function TrendIcon({
  current,
  prev,
  lowerIsBetter,
}: {
  current: number;
  prev?: number;
  lowerIsBetter: boolean;
}) {
  if (prev === undefined) return <Minus className="h-2.5 w-2.5 opacity-40" />;
  const improved = lowerIsBetter ? current < prev : current > prev;
  const degraded = lowerIsBetter ? current > prev : current < prev;
  if (improved) return <TrendingUp className="h-2.5 w-2.5 text-green-600" />;
  if (degraded) return <TrendingDown className="h-2.5 w-2.5 text-destructive" />;
  return <Minus className="h-2.5 w-2.5 opacity-40" />;
}

export function EngagementTrends({ data }: Props) {
  if (!data.length) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
            <TrendingUp className="h-4 w-4" />
            Tendências de Engajamento
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState
            message="Sem dados históricos de engajamento"
            detail="Os últimos 6 meses de dados aparecerão aqui."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
          <TrendingUp className="h-4 w-4" />
          Tendências de Engajamento (6 meses)
        </CardTitle>
        <p className={AT.chartSubtitle}>
          Verde = melhoria, Vermelho = piora em relação ao mês anterior
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left font-medium text-muted-foreground py-2 pr-3 whitespace-nowrap">
                  Métrica
                </th>
                {data.map((row) => (
                  <th
                    key={row.month_label}
                    className="text-center font-medium text-muted-foreground py-2 px-2 min-w-[60px]"
                  >
                    {row.month_label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRICS.map((metric) => (
                <tr key={metric.key} className="border-b border-border/30">
                  <td className="py-2 pr-3 font-medium text-muted-foreground whitespace-nowrap">
                    {metric.label}
                  </td>
                  {data.map((row, idx) => {
                    const current = row[metric.key] as number;
                    const prev =
                      idx > 0 ? (data[idx - 1][metric.key] as number) : undefined;
                    const cls = cellColor(current, prev, metric.lowerIsBetter);
                    return (
                      <td key={row.month_label} className="py-2 px-2 text-center">
                        <div className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 ${cls}`}>
                          <TrendIcon
                            current={current}
                            prev={prev}
                            lowerIsBetter={metric.lowerIsBetter}
                          />
                          <span className="tabular-nums font-medium text-[11px]">
                            {metric.format(current)}
                          </span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
