import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useAnalyticsFilters } from "./useAnalyticsFilters";
import { isMissingSchemaError } from "@/lib/rpc-errors";

export interface RevenueByType {
  product_type: string;
  total_revenue: number;
  deal_count: number;
  pct: number;
}

export interface MRREvolutionPoint {
  month_label: string;
  new_mrr: number;
  churned_mrr_estimate: number;
  net_mrr: number;
}

export interface SellerProfitability {
  member_id: string;
  member_name: string;
  revenue: number;
  commission_total: number;
  margin: number;
  roi: number;
}

export interface CACByOrigin {
  origin: string;
  lead_count: number;
  sales_count: number;
  total_sales_value: number;
  cac_estimate: number;
}

export interface TicketByType {
  month_label: string;
  product_type: string;
  avg_ticket: number;
}

export interface FinancialMetrics {
  revenue_by_type: RevenueByType[];
  mrr_evolution: MRREvolutionPoint[];
  seller_profitability: SellerProfitability[];
  cac_by_origin: CACByOrigin[];
  ticket_by_type: TicketByType[];
  total_revenue: number;
  total_mrr: number;
  new_customers: number;
}

const EMPTY: FinancialMetrics = {
  revenue_by_type: [],
  mrr_evolution: [],
  seller_profitability: [],
  cac_by_origin: [],
  ticket_by_type: [],
  total_revenue: 0,
  total_mrr: 0,
  new_customers: 0,
};

export function useAnalyticsFinanceiro() {
  const { organizationId, isReady } = useOrganization();
  const { filters, startStr, endStr } = useAnalyticsFilters();

  return useQuery({
    queryKey: [
      "analytics-financeiro",
      organizationId,
      startStr,
      endStr,
      filters.memberId,
      filters.origin,
    ],
    queryFn: async (): Promise<FinancialMetrics> => {
      const { data, error } = await supabase.rpc(
        "get_analytics_financial_metrics" as any,
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
          console.warn("âš ï¸ [useAnalyticsFinanceiro] RPC ausente (migration pendente?):", error.message);
          return EMPTY;
        }
        console.error("âŒ [useAnalyticsFinanceiro] RPC error:", error.message);
        throw new Error(`Analytics financeiro failed: ${error.message}`);
      }

      const raw = Array.isArray(data) && data.length > 0 ? data[0] : data;
      return (raw as FinancialMetrics) ?? EMPTY;
    },
    enabled: isReady && !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
}
