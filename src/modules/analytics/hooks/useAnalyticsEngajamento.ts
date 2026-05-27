import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useAnalyticsFilters } from "./useAnalyticsFilters";
import { isMissingSchemaError } from "@/lib/rpc-errors";

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface EngagementKPIs {
  our_avg_response_seconds: number;
  client_avg_response_seconds: number;
  response_rate_pct: number;
  close_rate_pct: number;
}

export interface ResponseByOriginRow {
  origin: string;
  lead_count: number;
  sales_count: number;
  response_rate: number;
  close_rate: number;
  avg_response_seconds: number;
}

export interface TeamResponseTimeRow {
  member_id: string;
  member_name: string;
  avg_response_seconds: number;
  is_copilot: boolean;
}

export interface HourlyPatternRow {
  hour: number;
  response_count: number;
  response_rate: number;
}

export interface SpeedConversionRow {
  bucket_label: string;
  bucket_min_seconds: number;
  bucket_max_seconds: number | null;
  lead_count: number;
  converted_count: number;
  conversion_rate: number;
}

export interface MonthlyTrendRow {
  month_label: string;
  response_rate: number;
  our_avg_response_seconds: number;
  client_avg_response_seconds: number;
  close_rate: number;
}

export interface CopilotHumanStats {
  avg_response: number;
  response_rate: number;
  qualification_rate: number;
  coverage_pct: number;
  cost_per_lead: number;
}

export interface CopilotVsHuman {
  copilot: CopilotHumanStats | null;
  human: CopilotHumanStats | null;
}

export interface EngagementMetrics {
  kpi_cards: EngagementKPIs;
  response_by_origin: ResponseByOriginRow[];
  team_response_times: TeamResponseTimeRow[];
  hourly_pattern: HourlyPatternRow[];
  speed_conversion: SpeedConversionRow[];
  monthly_trends: MonthlyTrendRow[];
  copilot_vs_human: CopilotVsHuman;
}

// â”€â”€â”€ Defaults â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const EMPTY: EngagementMetrics = {
  kpi_cards: {
    our_avg_response_seconds: 0,
    client_avg_response_seconds: 0,
    response_rate_pct: 0,
    close_rate_pct: 0,
  },
  response_by_origin: [],
  team_response_times: [],
  hourly_pattern: [],
  speed_conversion: [],
  monthly_trends: [],
  copilot_vs_human: { copilot: null, human: null },
};

// â”€â”€â”€ Hook â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function useAnalyticsEngajamento() {
  const { organizationId, isReady } = useOrganization();
  const { filters, startStr, endStr } = useAnalyticsFilters();

  return useQuery({
    queryKey: [
      "analytics-engajamento",
      organizationId,
      startStr,
      endStr,
      filters.memberId,
      filters.origin,
    ],
    queryFn: async (): Promise<EngagementMetrics> => {
      const { data, error } = await supabase.rpc(
        "get_analytics_engagement_metrics" as any,
        {
          p_org_id:     organizationId,
          p_start_date: startStr,
          p_end_date:   endStr,
          p_member_id:  filters.memberId,
          p_origin:     filters.origin,
        },
      );

      if (error) {
        if (isMissingSchemaError(error)) {
          console.warn("âš ï¸ [useAnalyticsEngajamento] RPC ausente (migration pendente?):", error.message);
          return EMPTY;
        }
        console.error("âŒ [useAnalyticsEngajamento] RPC error:", error.message);
        throw new Error(`Analytics engajamento failed: ${error.message}`);
      }

      const raw = Array.isArray(data) && data.length > 0 ? data[0] : data;
      return (raw as EngagementMetrics) ?? EMPTY;
    },
    enabled: isReady && !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
}
