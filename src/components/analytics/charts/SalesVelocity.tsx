import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Zap, ArrowRight } from "lucide-react";
import { type SalesVelocity as SalesVelocityData } from "@/hooks/useAnalyticsOverview";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";
import { AT } from "../analytics-tokens";

interface Props {
  data: SalesVelocityData;
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(1)}K`;
  return `R$ ${value.toFixed(0)}`;
}

export function SalesVelocity({ data }: Props) {
  const isEmpty =
    !data ||
    data.transitions.length === 0 ||
    data.total_cycle_days === 0;

  if (isEmpty) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
            <Zap className="h-4 w-4" />
            Velocidade de Vendas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState
            message="Sem dados de ciclo de vendas completo."
            detail="Necessário leads com jornada completa até vendido."
          />
        </CardContent>
      </Card>
    );
  }

  const { transitions, total_cycle_days, bottleneck_stage, bottleneck_pct, pipeline_velocity_per_day, forecast_30d } = data;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
          <Zap className="h-4 w-4" />
          Velocidade de Vendas
        </CardTitle>
        <p className={AT.chartSubtitle}>
          Tempo médio entre etapas do funil (leads com jornada completa)
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Pipeline Flow Visualization */}
        <div className="overflow-x-auto pb-2">
          <div className="flex items-center gap-0 min-w-max">
            {transitions.map((t, i) => {
              const isBottleneck = `${t.from_stage} → ${t.to_stage}` === bottleneck_stage;
              return (
                <div key={i} className="flex items-center">
                  {/* Stage node */}
                  <div
                    className={`flex flex-col items-center rounded-lg px-3 py-2 border ${
                      isBottleneck
                        ? "border-destructive bg-destructive/10"
                        : "border-border bg-muted/40"
                    }`}
                  >
                    <span
                      className={`text-xs font-semibold ${
                        isBottleneck ? "text-destructive" : "text-foreground"
                      }`}
                    >
                      {t.from_stage}
                    </span>
                    {isBottleneck && (
                      <span className="text-[9px] text-destructive font-medium mt-0.5">
                        gargalo
                      </span>
                    )}
                  </div>
                  {/* Arrow with days */}
                  <div className="flex flex-col items-center mx-1">
                    <span
                      className={`text-[10px] font-semibold tabular-nums ${
                        isBottleneck ? "text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {t.avg_days.toFixed(1)}d
                    </span>
                    <ArrowRight
                      className={`h-3 w-3 ${
                        isBottleneck ? "text-destructive" : "text-muted-foreground"
                      }`}
                    />
                  </div>
                  {/* Last node */}
                  {i === transitions.length - 1 && (
                    <div className="flex flex-col items-center rounded-lg px-3 py-2 border border-success bg-success/10">
                      <span className="text-xs font-semibold text-success">
                        {t.to_stage}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Metric Cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground mb-1">Ciclo Médio Total</div>
            <div className="text-xl font-bold tabular-nums">
              {total_cycle_days.toFixed(1)}
              <span className="text-sm font-normal text-muted-foreground ml-1">dias</span>
            </div>
          </div>
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <div className="text-xs text-muted-foreground mb-1">Gargalo</div>
            <div className="text-sm font-bold text-destructive leading-tight">
              {bottleneck_stage}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {bottleneck_pct.toFixed(0)}% do ciclo
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground mb-1">Pipeline Velocity</div>
            <div className="text-xl font-bold tabular-nums">
              {formatCurrency(pipeline_velocity_per_day)}
              <span className="text-xs font-normal text-muted-foreground ml-1">/dia</span>
            </div>
          </div>
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="text-xs text-muted-foreground mb-1">Forecast 30d</div>
            <div className="text-xl font-bold tabular-nums text-primary">
              {formatCurrency(forecast_30d)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
