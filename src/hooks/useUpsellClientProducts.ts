import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeSubscription } from "./useRealtimeSubscription";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type UpsellClientProduct = Tables<"upsell_client_products">;
export type UpsellClientProductInsert = TablesInsert<"upsell_client_products">;
export type UpsellClientProductUpdate = TablesUpdate<"upsell_client_products">;

/**
 * Lista produtos de um cliente especifico.
 */
export function useUpsellClientProducts(clientId: string | undefined) {
  useRealtimeSubscription("upsell_client_products", ["upsell_client_products"]);

  return useQuery({
    queryKey: ["upsell_client_products", clientId],
    queryFn: async () => {
      if (!clientId) return [];
      const { data, error } = await supabase
        .from("upsell_client_products")
        .select("*, product:products(*)")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!clientId,
  });
}

/**
 * Adiciona um produto ao cliente.
 */
export function useCreateUpsellClientProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (product: UpsellClientProductInsert) => {
      const { data, error } = await supabase
        .from("upsell_client_products")
        .insert(product)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["upsell_client_products"] });
    },
  });
}

/**
 * Atualiza um produto do cliente (ex: cancelar).
 */
export function useUpdateUpsellClientProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: UpsellClientProductUpdate & { id: string }) => {
      const { data, error } = await supabase
        .from("upsell_client_products")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["upsell_client_products"] });
    },
  });
}

/**
 * Remove um produto do cliente.
 */
export function useDeleteUpsellClientProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("upsell_client_products")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["upsell_client_products"] });
    },
  });
}
