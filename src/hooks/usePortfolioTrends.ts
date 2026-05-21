import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";

export interface RevenueMonthly {
  month: string;
  approved: number;
  pending: number;
}

export interface HealthDaily {
  date: string;
  avg_score: number;
}

export interface RetentionMonthly {
  month: string;
  rate: number;
}

export interface ChurnSummary {
  count: number;
  total_value: number;
}

export interface SegmentMonthly {
  month: string;
  ouro: number;
  prata: number;
  novo: number;
  resgate: number;
  dormindo: number;
}

export interface PortfolioTrends {
  revenue_monthly: RevenueMonthly[];
  health_daily: HealthDaily[];
  retention_monthly: RetentionMonthly[];
  churn_summary: ChurnSummary;
  segment_monthly: SegmentMonthly[];
}

export function usePortfolioTrends(months = 6) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["portfolio-trends", organizationId, months],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_portfolio_trends", {
        p_org_id: organizationId!,
        p_months: months,
      });
      if (error) throw error;
      return data as PortfolioTrends;
    },
    enabled: !!organizationId,
    staleTime: 120_000,
  });
}
