import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
interface RiskWindow {
  total: number;
  count: number;
  ouro_total: number;
}

interface RiskClient {
  id: string;
  name: string;
  segment: string;
  avg_ticket: number;
  next_order_expected: string;
  churn_probability: number;
}

export interface RevenueAtRiskData {
  windows: {
    "7d": RiskWindow;
    "14d": RiskWindow;
    "30d": RiskWindow;
  };
  top_risk_clients: RiskClient[] | null;
}

export function useRevenueAtRisk() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["revenue-at-risk", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_revenue_at_risk", {
        p_org_id: organizationId!,
      });
      if (error) throw error;
      return data as RevenueAtRiskData;
    },
    enabled: !!organizationId,
    staleTime: 120_000,
  });
}
