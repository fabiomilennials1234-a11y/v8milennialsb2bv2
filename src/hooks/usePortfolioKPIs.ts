import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";

export interface PortfolioKPIs {
  total_clients: number;
  total_recurring: number;
  overdue_count: number;
  overdue_revenue: number;
  avg_health: number;
  avg_ticket: number;
  expected_this_week: number;
  segment_counts: {
    ouro: number;
    prata: number;
    novo: number;
    resgate: number;
    dormindo: number;
  };
}

export function usePortfolioKPIs() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["portfolio-kpis", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_portfolio_kpis", {
        p_org_id: organizationId!,
      });
      if (error) throw error;
      return data as PortfolioKPIs;
    },
    enabled: !!organizationId,
    staleTime: 60_000,
  });
}
