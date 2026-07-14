/**
 * Toggle POR ORGANIZAÇÃO: "Distribuir lead novo automaticamente (round-robin)"
 * (coluna organizations.auto_distribute_new_leads).
 *
 * Semântica (ver migration 20270317000000):
 *   ON  → lead novo SEM place_in_pipe (caso comum Meta Ads / n8n) é distribuído
 *         round-robin ao pré-venda pelo pool do pipe whatsapp no ingest
 *         (lead-webhook). Requer pool configurado em pipe_distribution_members.
 *   OFF → comportamento legado (lead novo cai sem dono).
 *
 * Vale pra CONTA INTEIRA. Escrita via UPDATE em `organizations` (mesma
 * superfície de useAutoCreateLeadSetting; a RLS de UPDATE libera admin).
 *
 * RESILIÊNCIA: se a coluna ainda não foi aplicada no DB, trata como `false` e
 * NÃO quebra a página — o toggle renderiza mesmo assim.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";

const QUERY_KEY = "org-auto-distribute-new-leads" as const;

export interface AutoDistributeSetting {
  autoDistribute: boolean;
  isLoading: boolean;
  /** true quando a leitura falhou (ex.: coluna ainda não aplicada) — UI resiliente. */
  isUnavailable: boolean;
  setAutoDistribute: (value: boolean) => Promise<unknown>;
  isUpdating: boolean;
}

export function useAutoDistributeSetting(): AutoDistributeSetting {
  const { organizationId, isReady } = useOrganization();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [QUERY_KEY, organizationId],
    queryFn: async (): Promise<{ value: boolean; unavailable: boolean }> => {
      if (!organizationId) return { value: false, unavailable: false };
      const { data, error } = await supabase
        .from("organizations")
        .select("auto_distribute_new_leads")
        .eq("id", organizationId)
        .single();

      if (error) {
        if (error.code === "PGRST116" || error.message?.includes("column")) {
          return { value: false, unavailable: true };
        }
        throw error;
      }

      return { value: data?.auto_distribute_new_leads === true, unavailable: false };
    },
    enabled: isReady && !!organizationId,
    retry: 1,
  });

  const updateMutation = useMutation({
    mutationFn: async (value: boolean) => {
      if (!organizationId) throw new Error("Sem organização");
      const { data, error } = await supabase
        .from("organizations")
        .update({ auto_distribute_new_leads: value })
        .eq("id", organizationId)
        .select("auto_distribute_new_leads")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, organizationId] });
    },
  });

  return {
    autoDistribute: query.data?.value ?? false,
    isLoading: query.isLoading,
    isUnavailable: query.isError || query.data?.unavailable === true,
    setAutoDistribute: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
  };
}
