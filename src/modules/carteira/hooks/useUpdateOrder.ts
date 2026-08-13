import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CARTEIRA_ORDER_INVALIDATION_KEYS } from "@/modules/carteira/hooks/useCarteiraOrders";
import { orderErrorMessage } from "@/modules/carteira/lib/order-errors";

export interface UpdateOrderPatch {
  sale_value?: number;
  sold_at?: string;
  product_name?: string;
  closer_id?: string | null;
  sale_responsible_id?: string | null;
  client_id?: string;
}

export interface UpdateOrderItem {
  product_id?: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  unit?: string;
}

export interface UpdateOrderInput {
  orderId: string;
  patch: UpdateOrderPatch;
  /**
   * `undefined` = não mexe nos itens. Um array = SUBSTITUI o conjunto inteiro e
   * o `sale_value` passa a ser a soma (a RPC recalcula; o valor no patch é
   * ignorado nesse caso). Nunca mande `[]` — a RPC recusa com `items_required`.
   */
  items?: UpdateOrderItem[];
}

/**
 * Edita pedido da Carteira. Permitido para admin E membro.
 *
 * Só vale para pedido MANUAL: a RPC recusa pedido com vínculo ERP com
 * `order_erp_linked` (o ERP é a fonte da verdade). A UI já esconde o botão
 * nesse caso, mas o gate real é do banco.
 *
 * Cabeçalho e itens vão na MESMA chamada de propósito: a RPC os grava numa só
 * transação. Duas chamadas separadas poderiam falhar no meio e deixar
 * `sale_value` divergindo da soma dos itens — que é exatamente o estado
 * "faturado errado" que esta feature existe para consertar.
 */
export function useUpdateOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ orderId, patch, items }: UpdateOrderInput) => {
      const { data, error } = await (supabase.rpc as any)("carteira_update_order", {
        p_order_id: orderId,
        p_patch: patch,
        p_items: items ?? null,
      });

      if (error) throw error;
      return data as {
        id: string;
        client_id: string;
        previous_client_id: string;
        items_changed: boolean;
      };
    },
    onSuccess: (data) => {
      // Trocar de cliente é a edição de maior consequência e merece ser
      // nomeada. A descrição fala de MÉTRICA DE CARTEIRA, não de receita:
      // editar pedido aprovado não emite correção em `sale_events`, então
      // afirmar que "a receita passou a contar no novo cliente" seria falso
      // para org com `carteira_emits_revenue_enabled`. Ver limitação declarada
      // no cabeçalho de 20270813120000_carteira_order_edit.sql.
      if (data && data.client_id !== data.previous_client_id) {
        toast.success("Pedido movido", {
          description: "As métricas de carteira dos dois clientes foram recalculadas",
        });
      } else {
        toast.success("Pedido atualizado");
      }
      for (const queryKey of CARTEIRA_ORDER_INVALIDATION_KEYS) {
        queryClient.invalidateQueries({ queryKey: [...queryKey] });
      }
      // Mover o pedido de cliente recalcula os DOIS clientes no banco; o detalhe
      // de cliente precisa refazer a leitura ou mostra número velho.
      queryClient.invalidateQueries({ queryKey: ["upsell_clients"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-trends"] });
    },
    onError: (error) => {
      toast.error(orderErrorMessage(error));
    },
  });
}
