import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

export type UpsellOrder = Tables<"upsell_orders">;
export type UpsellOrderInsert = TablesInsert<"upsell_orders">;

/**
 * Lista todas as orders da organizacao.
 */
export function useUpsellOrders() {
  const { organizationId, isReady } = useOrganization();
  useRealtimeSubscription("upsell_orders", ["upsell_orders"]);

  return useQuery({
    queryKey: ["upsell_orders", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("upsell_orders")
        .select("*, client:upsell_clients(id, name, company), closer:team_members(id, name)")
        .eq("organization_id", organizationId)
        .eq("approval_status", "approved")
        .order("sold_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: isReady && !!organizationId,
  });
}

/**
 * Lista orders de um cliente especifico.
 */
export function useUpsellOrdersByClient(clientId: string | undefined) {
  return useQuery({
    queryKey: ["upsell_orders", "client", clientId],
    queryFn: async () => {
      if (!clientId) return [];
      const { data, error } = await supabase
        .from("upsell_orders")
        .select("*, closer:team_members(id, name)")
        .eq("client_id", clientId)
        .eq("approval_status", "approved")
        .order("sold_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!clientId,
  });
}

/**
 * Registra uma venda rapida (upsell).
 * Tambem insere o produto ativo no cliente.
 */
export function useCreateUpsellOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      order: UpsellOrderInsert;
      clientProduct?: {
        client_id: string;
        product_id?: string | null;
        product_name: string;
        product_type: string;
        sale_value: number;
        contract_duration?: number | null;
      };
    }) => {
      // 1. Criar order
      const { data: orderData, error: orderError } = await supabase
        .from("upsell_orders")
        .insert(params.order)
        .select()
        .single();

      if (orderError) throw orderError;

      // 2. Se tem produto, adicionar ao cliente
      if (params.clientProduct) {
        const { error: productError } = await supabase
          .from("upsell_client_products")
          .insert(params.clientProduct);

        if (productError) throw productError;
      }

      return orderData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["upsell_orders"] });
      queryClient.invalidateQueries({ queryKey: ["upsell_client_products"] });
      queryClient.invalidateQueries({ queryKey: ["upsell_clients"] });
    },
  });
}
