import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import type { OrderLineItem } from "@/modules/carteira/hooks/useQuickOrder";

export type NewOrderParams = {
  clientId: string;
  closerId?: string;
  campanhaId?: string;
  soldAt?: string;
  notes?: string;
  items: OrderLineItem[];
  source: "manual" | "copilot";
};

export function useNewOrder() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: NewOrderParams) => {
      if (!organizationId) throw new Error("No organization");

      const totalValue = params.items.reduce(
        (sum, item) => sum + item.quantity * item.unit_price,
        0,
      );

      const productName = params.items
        .map((i) => i.product_name)
        .join(", ");

      const { data: order, error: orderError } = await supabase
        .from("upsell_orders")
        .insert({
          organization_id: organizationId,
          client_id: params.clientId,
          closer_id: params.closerId || null,
          campanha_id: params.campanhaId || null,
          product_name: productName,
          product_type: "unitario",
          sale_value: totalValue,
          source: params.source,
          origin: "upsell",
          // Venda manual da carteira entra já aprovada — sem gate de aprovação
          // (o gate default 'pending' tornava a venda invisível pra métrica até
          // aprovação manual numa aba escondida). Ver migration recalc_upsell_client_metrics.
          approval_status: "approved",
          approved_at: new Date().toISOString(),
          sold_at: params.soldAt
            ? new Date(params.soldAt + "T12:00:00").toISOString()
            : undefined,
          notes: params.notes || null,
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

      const distinctProducts = new Map<string, OrderLineItem>();
      for (const item of params.items) {
        if (!distinctProducts.has(item.product_name)) {
          distinctProducts.set(item.product_name, item);
        }
      }

      const clientProducts = Array.from(distinctProducts.values()).map((item) => ({
        client_id: params.clientId,
        product_id: item.product_id || null,
        product_name: item.product_name,
        product_type: "unitario",
        sale_value: item.quantity * item.unit_price,
      }));

      if (clientProducts.length > 0) {
        await supabase
          .from("upsell_client_products")
          .insert(clientProducts);
      }

      return { orderId: order.id, totalValue, productName };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["upsell_orders"] });
      queryClient.invalidateQueries({ queryKey: ["upsell_clients"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-health"] });
      queryClient.invalidateQueries({ queryKey: ["last-order"] });
      queryClient.invalidateQueries({ queryKey: ["pending-orders"] });
      // Métricas da carteira recomputam via trigger no insert (order approved) —
      // invalidar pra refetch pegar os valores já atualizados.
      queryClient.invalidateQueries({ queryKey: ["portfolio-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-clients"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-trends"] });
    },
  });
}
