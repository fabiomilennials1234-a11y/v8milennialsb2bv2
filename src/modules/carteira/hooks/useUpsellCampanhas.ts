import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type UpsellCampanha = Tables<"upsell_campanhas">;
export type UpsellCampanhaInsert = TablesInsert<"upsell_campanhas">;
export type UpsellCampanhaUpdate = TablesUpdate<"upsell_campanhas">;

export type UpsellCampanhaWithRelations = UpsellCampanha & {
  client?: Tables<"upsell_clients"> | null;
  closer?: Tables<"team_members"> | null;
};

/**
 * Lista campanhas de upsell da organizacao.
 */
export function useUpsellCampanhas() {
  const { organizationId, isReady } = useOrganization();
  useRealtimeSubscription("upsell_campanhas", ["upsell_campanhas"]);

  return useQuery({
    queryKey: ["upsell_campanhas", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("upsell_campanhas")
        // `external_id` = código do cliente no ERP, exibido como prefixo do nome
        // no card (`erpCode`). Projeção explícita: sem ele o card da campanha
        // seria o único da Carteira sem o código.
        .select("*, client:upsell_clients(id, name, company, potencial, is_active, external_id), closer:team_members(id, name)")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as UpsellCampanhaWithRelations[];
    },
    enabled: isReady && !!organizationId,
  });
}

/**
 * Cria uma nova campanha de upsell.
 */
export function useCreateUpsellCampanha() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (campanha: UpsellCampanhaInsert) => {
      const { data, error } = await supabase
        .from("upsell_campanhas")
        .insert(campanha)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["upsell_campanhas"] });
    },
  });
}

/**
 * Atualiza uma campanha (inclui drag-and-drop).
 * Logica especial: primeira saida de "planejado" seta data_abordagem.
 */
export function useUpdateUpsellCampanha() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ id, ...updates }: UpsellCampanhaUpdate & { id: string }) => {
      let query = supabase
        .from("upsell_campanhas")
        .update(updates)
        .eq("id", id);

      if (organizationId) {
        query = query.eq("organization_id", organizationId);
      }

      const { data, error } = await query.select().single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["upsell_campanhas"] });
    },
  });
}

/**
 * Deleta uma campanha.
 */
export function useDeleteUpsellCampanha() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (id: string) => {
      let query = supabase
        .from("upsell_campanhas")
        .delete()
        .eq("id", id);

      if (organizationId) {
        query = query.eq("organization_id", organizationId);
      }

      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["upsell_campanhas"] });
    },
  });
}
