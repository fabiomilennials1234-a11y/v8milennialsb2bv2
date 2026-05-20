import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";

export type OrderLineItem = {
  product_id?: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  unit: string;
};

export function useLastOrder(clientId: string) {
  return useQuery({
    queryKey: ["last-order", clientId],
    queryFn: async () => {
      const { data: order } = await supabase
        .from("upsell_orders")
        .select("id, sale_value, sold_at, product_name, product_type")
        .eq("client_id", clientId)
        .eq("approval_status", "approved")
        .order("sold_at", { ascending: false })
        .limit(1)
        .single();

      if (!order) return null;

      const { data: items } = await supabase
        .from("client_purchase_items")
        .select("*")
        .eq("order_id", order.id);

      return { order, items: items ?? [] };
    },
    enabled: !!clientId,
  });
}

export function useCreateOrder() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      clientId: string;
      closerId?: string;
      items: OrderLineItem[];
      source: "manual" | "copilot";
    }) => {
      const totalValue = params.items.reduce((s, i) => s + i.quantity * i.unit_price, 0);

      const { data: order, error: orderError } = await supabase
        .from("upsell_orders")
        .insert({
          organization_id: organizationId!,
          client_id: params.clientId,
          closer_id: params.closerId,
          product_name: params.items.map((i) => i.product_name).join(", "),
          product_type: "unitario",
          sale_value: totalValue,
          source: params.source,
          origin: "upsell",
        })
        .select("id")
        .single();

      if (orderError) throw orderError;

      if (params.items.length > 0) {
        const { error: itemsError } = await supabase
          .from("client_purchase_items")
          .insert(
            params.items.map((item) => ({
              order_id: order.id,
              product_id: item.product_id,
              product_name: item.product_name,
              quantity: item.quantity,
              unit_price: item.unit_price,
              unit: item.unit,
            })),
          );
        if (itemsError) throw itemsError;
      }

      return order;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["upsell_orders"] });
      queryClient.invalidateQueries({ queryKey: ["upsell_clients"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-health"] });
      queryClient.invalidateQueries({ queryKey: ["last-order"] });
    },
  });
}
