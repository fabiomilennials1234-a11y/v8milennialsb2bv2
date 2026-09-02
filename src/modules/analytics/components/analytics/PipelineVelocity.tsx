import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Zap, Loader2, TrendingUp, Target, Timer, DollarSign } from "lucide-react";
import { usePipelineVelocity } from "@/modules/analytics/hooks/useAnalytics";
import { useAnalyticsFilters } from "@/modules/analytics/hooks/useAnalyticsFilters";
import { useAnalyticsPipelineOptions } from "@/modules/analytics/hooks/useAnalyticsPipelineOptions";
import { AT } from "./analytics-tokens";
import { AnalyticsEmptyState } from "./AnalyticsEmptyState";

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(1)}K`;
  return `R$ ${value.toFixed(0)}`;
}

export function PipelineVelocity() {
  // SCRUM-631: funis reais da org por pipeline_id. Default: o funil de
  // fechamento (slug 'propostas' enquanto existir — comportamento legado),
  // senão o funil padrão da org.
  const { options, closingDefault } = useAnalyticsPipelineOptions();
  const [pipeline, setPipeline] = useState<string | null>(null);
  const selectedPipeline = pipeline ?? closingDefault;
  const { startStr, endStr } = useAnalyticsFilters();
  const { data: velocity, isLoading } = usePipelineVelocity(selectedPipeline, startStr, endStr);

  const isEmpty = !velocity || velocity.total_closed === 0;

  // Velocity formula: (num_won * win_rate% * avg_deal_value) / cycle_length
  // Since we don't have cycle_length in this RPC, we display the raw metrics
  const velocityScore = useMemo(() => {
    if (!velocity || velocity.total_closed === 0) return 0;
    // Simplified: num_won * avg_deal_value / 100 (monthly throughput)
    return velocity.num_won * (velocity.avg_deal_value / 100);
  }, [velocity]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className={`${AT.chartTitle} flex items-center gap-2`}>
            <Zap className="h-4 w-4" />
            Velocidade do Pipeline
          </CardTitle>
          <Select value={selectedPipeline ?? undefined} onValueChange={setPipeline}>
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue placeholder="Funil" />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>
                  {opt.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className={AT.chartSubtitle}>
          Throughput do pipeline: deals x win rate x ticket médio
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : isEmpty ? (
          <AnalyticsEmptyState
            message="Sem dados de velocidade"
            detail="Necessário deals fechados (vendidos ou perdidos) neste pipeline."
          />
        ) : (
          <div className="space-y-4">
            {/* Velocity Score */}
            <div className="text-center py-3 rounded-lg border border-primary/20 bg-primary/5">
              <div className={`${AT.valueLg} text-primary`}>
                {formatCurrency(velocityScore)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Throughput no período
              </div>
            </div>

            {/* Metric Cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Target className="h-3 w-3 text-muted-foreground" />
                  <span className={AT.metricLabel}>Deals Fechados</span>
                </div>
                <div className={AT.valueMd}>{velocity!.total_closed}</div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <TrendingUp className="h-3 w-3 text-emerald-500" />
                  <span className={AT.metricLabel}>Ganhos</span>
                </div>
                <div className={`${AT.valueMd} text-emerald-500`}>{velocity!.num_won}</div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Timer className="h-3 w-3 text-muted-foreground" />
                  <span className={AT.metricLabel}>Win Rate</span>
                </div>
                <div className={AT.valueMd}>{velocity!.win_rate}%</div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <DollarSign className="h-3 w-3 text-muted-foreground" />
                  <span className={AT.metricLabel}>Ticket Médio</span>
                </div>
                <div className={AT.valueMd}>
                  {formatCurrency(velocity!.avg_deal_value / 100)}
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
