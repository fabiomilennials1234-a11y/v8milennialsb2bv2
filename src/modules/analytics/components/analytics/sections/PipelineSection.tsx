import { useState } from "react";
import { GitBranch, Loader2 } from "lucide-react";
import { useAnalyticsPipesFunis, type PipelineSelectorType } from "@/modules/analytics/hooks/useAnalyticsPipesFunis";
import { useAnalyticsOverview } from "@/modules/analytics/hooks/useAnalyticsOverview";
import { AnalyticsSectionHeader } from "../AnalyticsSectionHeader";
import { AnalyticsErrorBoundary } from "../AnalyticsErrorBoundary";
import { UnifiedFunnel } from "../UnifiedFunnel";
import { PipelineSelector } from "../charts/PipelineSelector";
import { StageAnalysis } from "../charts/StageAnalysis";
import { PipelineAging } from "../charts/PipelineAging";
import { SalesVelocity } from "../charts/SalesVelocity";
import { WeightedForecast } from "../charts/WeightedForecast";
import { ConversionTrends } from "../charts/ConversionTrends";
import { WeeklyPipelineFlow } from "../charts/WeeklyPipelineFlow";

export function PipelineSection() {
  const [selectedPipeline, setSelectedPipeline] = useState<PipelineSelectorType>(null);
  const { data, isLoading, isError, error } = useAnalyticsPipesFunis(selectedPipeline);
  const { data: overviewData, isError: overviewError } = useAnalyticsOverview();

  return (
    <div>
      <AnalyticsSectionHeader
        icon={GitBranch}
        title="Pipeline"
        description="Como está a saúde do seu pipeline?"
      />

      <AnalyticsErrorBoundary>
        <PipelineSelector selected={selectedPipeline} onChange={setSelectedPipeline} />
      </AnalyticsErrorBoundary>

      {(isError || overviewError) && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive mb-4">
          <p className="font-medium">Erro ao carregar pipeline</p>
          <p className="text-xs text-muted-foreground mt-1">{error?.message || "Verifique a conexão."}</p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      ) : data ? (
        <div className="space-y-4 mt-4">
          {/* Full funnel — full-width, detailed */}
          {data.funnel_stages.length > 0 && (
            <AnalyticsErrorBoundary>
              <UnifiedFunnel
                title="Funil Completo"
                variant="detailed"
                steps={data.funnel_stages.map((s, i) => ({
                  label: s.stage_name,
                  value: s.count,
                  color: ["#6366f1", "#3b82f6", "#22c55e", "#f59e0b", "#ef4444"][i % 5],
                  lostCount: s.lost_count,
                  avgDays: s.avg_days,
                }))}
              />
            </AnalyticsErrorBoundary>
          )}

          {/* Row 1: Stage Analysis + Pipeline Aging */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <AnalyticsErrorBoundary>
              <StageAnalysis stages={data.stage_analysis} />
            </AnalyticsErrorBoundary>
            <AnalyticsErrorBoundary>
              <PipelineAging stages={data.pipeline_aging} />
            </AnalyticsErrorBoundary>
          </div>

          {/* Row 2: Sales Velocity + Weighted Forecast */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {overviewData && (
              <AnalyticsErrorBoundary>
                <SalesVelocity data={overviewData.sales_velocity} />
              </AnalyticsErrorBoundary>
            )}
            <AnalyticsErrorBoundary>
              <WeightedForecast
                stages={data.weighted_forecast}
                forecastTotal={data.forecast_total}
              />
            </AnalyticsErrorBoundary>
          </div>

          {/* Full-width charts */}
          <AnalyticsErrorBoundary>
            <ConversionTrends trends={data.conversion_trends} />
          </AnalyticsErrorBoundary>
          <AnalyticsErrorBoundary>
            <WeeklyPipelineFlow stages={data.pipeline_aging} />
          </AnalyticsErrorBoundary>
        </div>
      ) : null}
    </div>
  );
}
