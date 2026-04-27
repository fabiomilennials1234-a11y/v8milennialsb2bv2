import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import { useRealtimeSubscription } from "./useRealtimeSubscription";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type UpsellClient = Tables<"upsell_clients">;
export type UpsellClientInsert = TablesInsert<"upsell_clients">;
export type UpsellClientUpdate = TablesUpdate<"upsell_clients">;

export type UpsellClientWithRelations = UpsellClient & {
  lead?: Tables<"leads"> | null;
  closer?: Tables<"team_members"> | null;
};

/**
 * Lista clientes da base de upsell da organizacao atual.
 * Inclui lead e closer como relacoes.
 */
export function useUpsellClients() {
  const { organizationId, isReady } = useOrganization();
  useRealtimeSubscription("upsell_clients", ["upsell_clients"]);

  return useQuery({
    queryKey: ["upsell_clients", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("upsell_clients")
        .select("*, lead:leads(*), closer:team_members(*)")
        .eq("organization_id", organizationId)
        .order("name");

      if (error) throw error;
      return data as UpsellClientWithRelations[];
    },
    enabled: isReady && !!organizationId,
  });
}

/**
 * Busca um cliente por ID.
 */
export function useUpsellClient(id: string | undefined) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["upsell_clients", id, organizationId],
    queryFn: async () => {
      if (!organizationId || !id) return null;
      const { data, error } = await supabase
        .from("upsell_clients")
        .select("*, lead:leads(*), closer:team_members(*)")
        .eq("id", id)
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (error) throw error;
      return data as UpsellClientWithRelations | null;
    },
    enabled: isReady && !!organizationId && !!id,
  });
}

/**
 * Cria um novo cliente na base de upsell.
 */
export function useCreateUpsellClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (client: UpsellClientInsert) => {
      const { data, error } = await supabase
        .from("upsell_clients")
        .insert(client)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["upsell_clients"] });
    },
  });
}

/**
 * Atualiza um cliente (inclui drag-and-drop do Kanban).
 */
export function useUpdateUpsellClient() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ id, ...updates }: UpsellClientUpdate & { id: string }) => {
      let query = supabase
        .from("upsell_clients")
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
      queryClient.invalidateQueries({ queryKey: ["upsell_clients"] });
    },
  });
}

/**
 * Deleta um cliente da base de upsell.
 */
export function useDeleteUpsellClient() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (id: string) => {
      let query = supabase
        .from("upsell_clients")
        .delete()
        .eq("id", id);

      if (organizationId) {
        query = query.eq("organization_id", organizationId);
      }

      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["upsell_clients"] });
    },
  });
}
