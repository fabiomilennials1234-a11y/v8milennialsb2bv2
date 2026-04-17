import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import { useAnalyticsFilters } from "./useAnalyticsFilters";

export interface MemberStat {
  member_id: string;
  member_name: string;
  leads_handled: number;
  meetings_attended: number;
  proposals_total: number;
  deals_won: number;
  revenue: number;
  avg_ticket: number;
}

export interface LossReason {
  loss_reason: string;
  cnt: number;
}

export interface OriginQuality {
  origin: string;
  lead_count: number;
  won_count: number;
  avg_ticket: number;
  conversion_rate: number;
}

export interface CommercialMetrics {
  member_stats: MemberStat[];
  loss_reasons: LossReason[];
  origin_quality: OriginQuality[];
  total_leads: number;
  total_won: number;
  total_lost: number;
  total_loss_reasons: number;
}

const EMPTY: CommercialMetrics = {
  member_stats: [],
  loss_reasons: [],
  origin_quality: [],
  total_leads: 0,
  total_won: 0,
  total_lost: 0,
  total_loss_reasons: 0,
};

export function useAnalyticsComercial() {
  const { organizationId, isReady } = useOrganization();
  const { filters, startStr, endStr } = useAnalyticsFilters();

  return useQuery({
    queryKey: [
      "analytics-comercial",
      organizationId,
      startStr,
      endStr,
      filters.memberId,
      filters.origin,
    ],
    queryFn: async (): Promise<CommercialMetrics> => {
      const { data, error } = await supabase.rpc(
        "get_analytics_commercial_metrics" as any,
        {
          p_org_id: organizationId,
          p_start_date: startStr,
          p_end_date: endStr,
          p_member_id: filters.memberId,
          p_origin: filters.origin,
        },
      );

      if (error) {
        console.error("❌ [useAnalyticsComercial] RPC error:", error.message);
        throw new Error(`Analytics comercial failed: ${error.message}`);
      }

      const raw = Array.isArray(data) && data.length > 0 ? data[0] : data;
      return (raw as CommercialMetrics) ?? EMPTY;
    },
    enabled: isReady && !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
}
