import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Zap } from "lucide-react";
import { type SpeedConversionRow } from "@/modules/analytics/hooks/useAnalyticsEngajamento";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";
import { AT } from "../analytics-tokens";

interface Props {
  data: SpeedConversionRow[];
}

const BUCKET_COLORS: Record<string, { bar: string; bg: string; text: string }> = {
  "<2min":   { bar: "bg-success",    bg: "bg-success/10",    text: "text-success" },
  "2-5min":  { bar: "bg-blue-500",   bg: "bg-blue-500/10",   text: "text-blue-600 dark:text-blue-400" },
  "5-15min": { bar: "bg-warning",    bg: "bg-warning/10",    text: "text-warning" },
  ">15min":  { bar: "bg-destructive",bg: "bg-destructive/10",text: "text-destructive" },
};

const BUCKET_ICONS: Record<string, string> = {
  "<2min":   "⚡",
  "2-5min":  "🟢",
  "5-15min": "🟡",
  ">15min":  "🔴",
};

export function SpeedConversionCorrelation({ data }: Props) {
  if (!data.length) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
            <Zap className="h-4 w-4" />
            Velocidade × Conversão
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState
            message="Sem dados de velocidade de resposta"
            detail="Necessário histórico de mensagens WhatsApp para calcular."
          />
        </CardContent>
      </Card>
    );
  }

  // Insight: multiplier of <2min vs >15min
  const fastest = data.find((d) => d.bucket_label === "<2min");
  const slowest = data.find((d) => d.bucket_label === ">15min");
  const multiplier =
    fastest && slowest && slowest.conversion_rate > 0
      ? (fastest.conversion_rate / slowest.conversion_rate).toFixed(1)
      : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
          <Zap className="h-4 w-4" />
          Velocidade × Conversão
        </CardTitle>
        <p className={AT.chartSubtitle}>
          Impacto do tempo de resposta na taxa de fechamento
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.map((row) => {
          const colors = BUCKET_COLORS[row.bucket_label] ?? {
            bar: "bg-muted",
            bg: "bg-muted/40",
            text: "text-muted-foreground",
          };
          const icon = BUCKET_ICONS[row.bucket_label] ?? "";

          return (
            <div
              key={row.bucket_label}
              className={`rounded-lg p-3 ${colors.bg} border border-border/30`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold">
                  {icon} {row.bucket_label}
                </span>
                <div className="text-right">
                  <span className={`text-lg font-bold tabular-nums ${colors.text}`}>
                    {row.conversion_rate.toFixed(1)}%
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-1">fechamento</span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-2 bg-background/60 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${colors.bar}`}
                  style={{ width: `${Math.min(row.conversion_rate, 100)}%` }}
                />
              </div>

              <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground">
                <span>{row.lead_count} leads</span>
                <span>{row.converted_count} convertidos</span>
              </div>
            </div>
          );
        })}

        {/* Insight card */}
        {multiplier && parseFloat(multiplier) > 1 && (
          <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3 mt-1">
            <p className="text-xs font-medium text-green-700 dark:text-green-400">
              Responder em &lt;2min gera{" "}
              <span className="font-bold">{multiplier}x mais conversões</span> do que
              responder após 15min.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
