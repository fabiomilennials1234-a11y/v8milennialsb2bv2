import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";

export interface VendedorStats {
  closer_id: string;
  name: string;
  role: string;
  total_clients: number;
  avg_health: number;
  avg_churn: number;
  avg_ticket: number;
  total_revenue: number;
  on_time_pct: number | null;
  segments: {
    ouro: number;
    prata: number;
    novo: number;
    resgate: number;
    dormindo: number;
  };
}

export function useVendedorRanking() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["vendedor-ranking", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_vendedor_ranking", {
        p_org_id: organizationId!,
      });
      if (error) throw error;
      return (data ?? []) as VendedorStats[];
    },
    enabled: !!organizationId,
    staleTime: 120_000,
  });
}
