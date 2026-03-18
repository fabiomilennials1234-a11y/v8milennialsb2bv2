import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import { useAnalyticsFilters } from "./useAnalyticsFilters";

export type PipelineSelectorType = "whatsapp" | "confirmacao" | "propostas" | null;

// ─── Shape types returned by the RPC ─────────────────────────────────────────

export interface FunnelStage {
  stage_name: string;
  count: number;
  cumulative_pct: number;
  lost_count: number;
  avg_days: number;
}

export interface StageAnalysis {
  transition_name: string;
  conversion_pct: number;
  lost_count: number;
  primary_loss_status: string;
}

export interface PipelineAgingStage {
  stage_name: string;
  total: number;
  healthy_count: number;
  attention_count: number;
  risk_count: number;
  critical_count: number;
}

export interface WeightedForecastStage {
  stage_name: string;
  deal_count: number;
  total_value: number;
  win_probability: number;
  weighted_value: number;
}

export interface ConversionTrendMonth {
  month_label: string;
  rate: number;
}

export interface ConversionTrend {
  transition_name: string;
  months: ConversionTrendMonth[];
}

export interface PipelineFunnelMetrics {
  funnel_stages: FunnelStage[];
  stage_analysis: StageAnalysis[];
  pipeline_aging: PipelineAgingStage[];
  weighted_forecast: WeightedForecastStage[];
  conversion_trends: ConversionTrend[];
  pipeline_total: number;
  forecast_total: number;
}

const EMPTY: PipelineFunnelMetrics = {
  funnel_stages: [],
  stage_analysis: [],
  pipeline_aging: [],
  weighted_forecast: [],
  conversion_trends: [],
  pipeline_total: 0,
  forecast_total: 0,
};

export function useAnalyticsPipesFunis(pipelineType: PipelineSelectorType = null) {
  const { organizationId, isReady } = useOrganization();
  const { filters, startStr, endStr } = useAnalyticsFilters();

  return useQuery({
    queryKey: [
      "analytics-pipes-funis",
      organizationId,
      startStr,
      endStr,
      filters.memberId,
      pipelineType,
    ],
    queryFn: async (): Promise<PipelineFunnelMetrics> => {
      const { data, error } = await supabase.rpc(
        "get_analytics_pipeline_metrics" as any,
        {
          p_org_id: organizationId,
          p_start_date: startStr,
          p_end_date: endStr,
          p_pipeline_type: pipelineType ?? null,
          p_member_id: filters.memberId ?? null,
        },
      );

      if (error) {
        console.error("❌ [useAnalyticsPipesFunis] RPC error:", error.message);
        return EMPTY;
      }

      const raw = Array.isArray(data) && data.length > 0 ? data[0] : data;
      return (raw as PipelineFunnelMetrics) ?? EMPTY;
    },
    enabled: isReady && !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
}
