import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

export type GestaoRule = Tables<"upsell_gestao_rules">;
export type GestaoRuleInsert = TablesInsert<"upsell_gestao_rules">;

/**
 * Lista regras de sincronização Base → Gestão da organização atual.
 */
export function useUpsellGestaoRules() {
  const { organizationId, isReady } = useOrganization();
  useRealtimeSubscription("upsell_gestao_rules", ["upsell_gestao_rules"]);

  return useQuery({
    queryKey: ["upsell_gestao_rules", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("upsell_gestao_rules")
        .select("*")
        .eq("organization_id", organizationId)
        .order("base_stage_key")
        .order("position");

      if (error) throw error;
      return data as GestaoRule[];
    },
    enabled: isReady && !!organizationId,
  });
}

/**
 * Salva regras de sincronização em batch (delete all + insert).
 * Mais simples que upsert individual para este caso.
 */
export function useSaveGestaoRules() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (rules: Omit<GestaoRuleInsert, "organization_id">[]) => {
      if (!organizationId) throw new Error("Organização não encontrada");

      // Delete existing rules for this org
      const { error: deleteError } = await supabase
        .from("upsell_gestao_rules")
        .delete()
        .eq("organization_id", organizationId);

      if (deleteError) throw deleteError;

      // Insert new rules (if any)
      if (rules.length > 0) {
        const rows = rules.map((r, i) => ({
          ...r,
          organization_id: organizationId,
          position: i,
        }));

        const { error: insertError } = await supabase
          .from("upsell_gestao_rules")
          .insert(rows);

        if (insertError) throw insertError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["upsell_gestao_rules"] });
    },
  });
}
