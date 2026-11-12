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

/**
 * Agregado do mapa — a base que quem chama vê, independente do período.
 *
 * O resultado depende de QUEM chama (a RPC aplica a visibilidade de leads), e
 * por isso a chave leva o usuário: trocar de conta na mesma aba nunca serve o
 * mapa de outra pessoa a partir do cache.
 */
export function useUfHeatmap() {
  const { organizationId } = useOrganization();
  const { userId } = useIdentity();

  return useQuery({
    queryKey: ["uf-heatmap", organizationId, userId],
    queryFn: async (): Promise<UfHeatmapRow[]> => {
      const { data, error } = await supabase.rpc("get_uf_heatmap", { p_org_id: organizationId ?? undefined });
      // O erro do PostgREST inteiro: `access_denied` vira a mensagem de
      // permissão do catálogo, e não "erro desconhecido".
      if (error) throw error;
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
    // Nome e telefone do que quem chama vê: a chave leva o usuário (ver acima).
    queryKey: ["uf-leads", organizationId, userId, uf],
    queryFn: async (): Promise<UfLeadRow[]> => {
      const { data, error } = await supabase.rpc("get_leads_by_uf", { p_uf: uf!, p_org_id: organizationId ?? undefined });
      if (error) throw error;
      return (data ?? []) as UfLeadRow[];
    },
    enabled: !!organizationId && !!userId && !!uf,
    staleTime: 60 * 1000,
  });
}
