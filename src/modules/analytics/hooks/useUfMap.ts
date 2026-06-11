import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";

export interface UfHeatmapRow {
  uf: string;
  leads_count: number;
  clients_count: number;
  total_sold: number;
  unmapped_count: number;
}

export interface UfLeadRow {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  uf_source: string | null;
  is_client: boolean;
  sold_value: number;
  created_at: string;
}

/** Agregado do mapa — base inteira da org, independente do período. */
export function useUfHeatmap() {
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;

  return useQuery({
    queryKey: ["uf-heatmap", organizationId],
    queryFn: async (): Promise<UfHeatmapRow[]> => {
      const { data, error } = await supabase.rpc("get_uf_heatmap");
      if (error) throw new Error(`UF heatmap failed: ${error.message}`);
      return (data ?? []) as UfHeatmapRow[];
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
}

/** Relatório de um estado — leads + clientes + vendido, sob demanda no clique. */
export function useLeadsByUf(uf: string | null) {
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;

  return useQuery({
    queryKey: ["uf-leads", organizationId, uf],
    queryFn: async (): Promise<UfLeadRow[]> => {
      const { data, error } = await supabase.rpc("get_leads_by_uf", { p_uf: uf! });
      if (error) throw new Error(`UF leads failed: ${error.message}`);
      return (data ?? []) as UfLeadRow[];
    },
    enabled: !!organizationId && !!uf,
    staleTime: 60 * 1000,
  });
}
