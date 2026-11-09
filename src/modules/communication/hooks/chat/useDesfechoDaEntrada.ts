/**
 * Desfecho atual (`deals.outcome`) de uma entrada de funil.
 *
 * Mesma chave e mesma leitura do menu do card (`DealLostMenuItem`): quem decide
 * o desfecho invalida `deal-menu-outcome` e este valor acompanha.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

export type DesfechoAtual = "open" | "won" | "lost";

export function useDesfechoDaEntrada(entryId: string, enabled = true) {
  const { organizationId, isReady } = useOrganization();
  return useQuery({
    queryKey: ["deal-menu-outcome", organizationId, entryId],
    enabled: enabled && isReady && !!organizationId,
    staleTime: 30_000,
    queryFn: async (): Promise<DesfechoAtual> => {
      const { data, error } = await supabase
        .from("pipeline_entries")
        .select("deal:deals(outcome)")
        .eq("organization_id", organizationId!)
        .eq("id", entryId)
        .single()
        .returns<{ deal: { outcome: DesfechoAtual } | null }>();
      if (error) throw new Error(error.message);
      // Entrada antiga sem deal ainda é negócio aberto.
      return data.deal?.outcome ?? "open";
    },
  });
}
