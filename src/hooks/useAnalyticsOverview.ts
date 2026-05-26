import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useAnalyticsFilters } from "./useAnalyticsFilters";
import { isMissingSchemaError } from "@/lib/rpc-errors";

export interface CohortRetentionPoint {
  month_index: number;
  pct: number;
}

export interface CohortRow {
  cohort_month: string;
  cohort_start: string;
  total_customers: number;
  retention: CohortRetentionPoint[];
}

export interface UnitEconomics {
  cac_estimate: number;
  ltv_estimate: number;
  ltv_cac_ratio: number;
  payback_months: number;
  churn_rate_estimate: number;
  revenue_churn_estimate: number;
}

export interface AttributionRow {
  origin: string;
  lead_count: number;
  sales_count: number;
  revenue: number;
  conversion_rate: number;
  cac_estimate: number;
}

export interface VelocityTransition {
  from_stage: string;
  to_stage: string;
  avg_days: number;
}

export interface SalesVelocity {
  transitions: VelocityTransition[];
  total_cycle_days: number;
  bottleneck_stage: string;
  bottleneck_pct: number;
  pipeline_velocity_per_day: number;
  forecast_30d: number;
}

export interface OverviewInsight {
  type: "oportunidade" | "alerta" | "tendencia" | "padrao";
  title: string;
  description: string;
}

export interface OverviewMetrics {
  cohort_data: CohortRow[];
  unit_economics: UnitEconomics;
  attribution: AttributionRow[];
  sales_velocity: SalesVelocity;
  insights: OverviewInsight[];
}

const EMPTY_UNIT_ECONOMICS: UnitEconomics = {
  cac_estimate: 0,
  ltv_estimate: 0,
  ltv_cac_ratio: 0,
  payback_months: 0,
  churn_rate_estimate: 0,
  revenue_churn_estimate: 0,
};

const EMPTY_VELOCITY: SalesVelocity = {
  transitions: [],
  total_cycle_days: 0,
  bottleneck_stage: "",
  bottleneck_pct: 0,
  pipeline_velocity_per_day: 0,
  forecast_30d: 0,
};

const EMPTY: OverviewMetrics = {
  cohort_data: [],
  unit_economics: EMPTY_UNIT_ECONOMICS,
  attribution: [],
  sales_velocity: EMPTY_VELOCITY,
  insights: [],
};

export function useAnalyticsOverview() {
  const { organizationId, isReady } = useOrganization();
  const { filters, startStr, endStr } = useAnalyticsFilters();

  return useQuery({
    queryKey: [
      "analytics-overview",
      organizationId,
      startStr,
      endStr,
      filters.memberId,
      filters.origin,
    ],
    queryFn: async (): Promise<OverviewMetrics> => {
      const { data, error } = await supabase.rpc(
        "get_analytics_overview_metrics" as any,
        {
          p_org_id: organizationId,
          p_start_date: startStr,
          p_end_date: endStr,
          p_member_id: filters.memberId,
          p_origin: filters.origin,
        },
      );

      if (error) {
        if (isMissingSchemaError(error)) {
          console.warn("âš ï¸ [useAnalyticsOverview] RPC ausente (migration pendente?):", error.message);
          return EMPTY;
        }
        console.error("âŒ [useAnalyticsOverview] RPC error:", error.message);
        throw new Error(`Analytics overview failed: ${error.message}`);
      }

      const raw = Array.isArray(data) && data.length > 0 ? data[0] : data;
      const metrics = (raw as OverviewMetrics) ?? EMPTY;

      return {
        cohort_data: metrics.cohort_data ?? [],
        unit_economics: metrics.unit_economics ?? EMPTY_UNIT_ECONOMICS,
        attribution: metrics.attribution ?? [],
        sales_velocity: metrics.sales_velocity ?? EMPTY_VELOCITY,
        insights: metrics.insights ?? [],
      };
    },
    enabled: isReady && !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
}
