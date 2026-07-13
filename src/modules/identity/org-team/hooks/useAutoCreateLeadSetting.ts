/**
 * Toggle POR ORGANIZAÇÃO: "Criar lead automaticamente ao receber mensagem
 * no WhatsApp" (coluna organizations.auto_create_lead_on_inbound).
 *
 * Semântica (ver migration 20270211000000):
 *   ON  → inbound de telefone desconhecido cria lead sozinho (mesmo sem IA).
 *   OFF → comportamento legado (default de todas as orgs).
 *
 * Vale pra CONTA INTEIRA — não é por-aba/por-funil. Escrita via UPDATE em
 * `organizations` (mesma superfície de `useOrganizationSettings`; a RLS de
 * UPDATE de organizations libera admin — precedente confirmado).
 *
 * RESILIÊNCIA: se a query falhar porque a coluna ainda não foi aplicada no DB
 * (migration pendente no ambiente), tratamos como `false` e NÃO quebramos a
 * página — o toggle renderiza mesmo assim (permite verificação visual no
 * localhost antes da migration rodar).
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";

const QUERY_KEY = "org-auto-create-lead" as const;

export interface AutoCreateLeadSetting {
  autoCreateLead: boolean;
  isLoading: boolean;
  /** true quando a leitura falhou (ex.: coluna ainda não aplicada) — UI resiliente. */
  isUnavailable: boolean;
  setAutoCreateLead: (value: boolean) => Promise<unknown>;
  isUpdating: boolean;
}

export function useAutoCreateLeadSetting(): AutoCreateLeadSetting {
  const { organizationId, isReady } = useOrganization();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [QUERY_KEY, organizationId],
    queryFn: async (): Promise<{ value: boolean; unavailable: boolean }> => {
      if (!organizationId) return { value: false, unavailable: false };
      const { data, error } = await supabase
        .from("organizations")
        .select("auto_create_lead_on_inbound")
        .eq("id", organizationId)
        .single();

      if (error) {
        // Coluna ausente (migration pendente) ou row não encontrada:
        // degrada pra OFF sem estourar erro na página.
        if (error.code === "PGRST116" || error.message?.includes("column")) {
          return { value: false, unavailable: true };
        }
        throw error;
      }

      return { value: data?.auto_create_lead_on_inbound === true, unavailable: false };
    },
    enabled: isReady && !!organizationId,
    // Falhas transientes não devem manter a página quebrada — mantemos OFF.
    retry: 1,
  });

  const updateMutation = useMutation({
    mutationFn: async (value: boolean) => {
      if (!organizationId) throw new Error("Sem organização");
      const { data, error } = await supabase
        .from("organizations")
        .update({ auto_create_lead_on_inbound: value })
        .eq("id", organizationId)
        .select("auto_create_lead_on_inbound")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, organizationId] });
    },
  });

  return {
    autoCreateLead: query.data?.value ?? false,
    isLoading: query.isLoading,
    isUnavailable: query.isError || query.data?.unavailable === true,
    setAutoCreateLead: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
  };
}
