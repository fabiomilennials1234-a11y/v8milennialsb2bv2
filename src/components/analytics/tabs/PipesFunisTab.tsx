import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useAnalyticsPipesFunis, type PipelineSelectorType } from "@/hooks/useAnalyticsPipesFunis";
import { AnalyticsErrorBoundary } from "../AnalyticsErrorBoundary";
import { PipelineSelector } from "../charts/PipelineSelector";
import { FullFunnel } from "../charts/FullFunnel";
import { StageAnalysis } from "../charts/StageAnalysis";
import { PipelineAging } from "../charts/PipelineAging";
import { WeightedForecast } from "../charts/WeightedForecast";
import { ConversionTrends } from "../charts/ConversionTrends";
import { WeeklyPipelineFlow } from "../charts/WeeklyPipelineFlow";

export function PipesFunisTab() {
  const [selectedPipeline, setSelectedPipeline] = useState<PipelineSelectorType>(null);
  const { data, isLoading } = useAnalyticsPipesFunis(selectedPipeline);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* Pipeline Selector */}
      <AnalyticsErrorBoundary>
        <PipelineSelector selected={selectedPipeline} onChange={setSelectedPipeline} />
      </AnalyticsErrorBoundary>

      {/* Row 1: Full Funnel + Stage Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalyticsErrorBoundary>
          <FullFunnel stages={data.funnel_stages} />
        </AnalyticsErrorBoundary>
        <AnalyticsErrorBoundary>
          <StageAnalysis stages={data.stage_analysis} />
        </AnalyticsErrorBoundary>
      </div>

      {/* Row 2: Pipeline Aging + Weekly Pipeline Flow */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalyticsErrorBoundary>
          <PipelineAging stages={data.pipeline_aging} />
        </AnalyticsErrorBoundary>
        <AnalyticsErrorBoundary>
          <WeeklyPipelineFlow stages={data.pipeline_aging} />
        </AnalyticsErrorBoundary>
      </div>

      {/* Row 3: Weighted Forecast + Conversion Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalyticsErrorBoundary>
          <WeightedForecast
            stages={data.weighted_forecast}
            forecastTotal={data.forecast_total}
          />
        </AnalyticsErrorBoundary>
        <AnalyticsErrorBoundary>
          <ConversionTrends trends={data.conversion_trends} />
        </AnalyticsErrorBoundary>
      </div>
    </div>
  );
}
