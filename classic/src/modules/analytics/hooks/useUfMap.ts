import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useIdentity, useOrganization } from "@/modules/identity";

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
  const { organizationId } = useOrganization();
  // O resultado depende de QUEM chama (a RPC aplica a visibilidade de leads,
  // 20280111000700): a chave leva o usuário para a troca de conta na mesma aba
  // nunca servir o mapa de outra pessoa a partir do cache.
  const { userId } = useIdentity();

  return useQuery({
    queryKey: ["uf-heatmap", organizationId, userId],
    queryFn: async (): Promise<UfHeatmapRow[]> => {
      const { data, error } = await supabase.rpc("get_uf_heatmap", { p_org_id: organizationId ?? undefined });
      if (error) throw new Error(`UF heatmap failed: ${error.message}`);
      return (data ?? []) as UfHeatmapRow[];
    },
    enabled: !!organizationId && !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

/** Relatório de um estado — leads + clientes + vendido, sob demanda no clique. */
export function useLeadsByUf(uf: string | null) {
  const { organizationId } = useOrganization();
  const { userId } = useIdentity();

  return useQuery({
    queryKey: ["uf-leads", organizationId, userId, uf],
    queryFn: async (): Promise<UfLeadRow[]> => {
      const { data, error } = await supabase.rpc("get_leads_by_uf", { p_uf: uf!, p_org_id: organizationId ?? undefined });
      if (error) throw new Error(`UF leads failed: ${error.message}`);
      return (data ?? []) as UfLeadRow[];
    },
    enabled: !!organizationId && !!userId && !!uf,
    staleTime: 60 * 1000,
  });
}
