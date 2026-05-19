import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import type { Tables } from "@/integrations/supabase/types";

export type UpsellClientRow = Tables<"upsell_clients">;

/**
 * Busca a row de `upsell_clients` pelo lead atual (ou null se o lead ainda
 * não foi promovido para a carteira). Usa lead_id como filtro — um lead tem
 * no máximo um upsell_client por org.
 */
export function useUpsellClientByLeadId(leadId: string | null | undefined) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["upsell_client_by_lead", leadId, organizationId],
    enabled: isReady && !!organizationId && !!leadId,
    staleTime: 30_000,
    queryFn: async (): Promise<UpsellClientRow | null> => {
      if (!organizationId || !leadId) return null;
      const { data, error } = await supabase
        .from("upsell_clients")
        .select("*")
        .eq("lead_id", leadId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return (data as UpsellClientRow | null) ?? null;
    },
  });
}
