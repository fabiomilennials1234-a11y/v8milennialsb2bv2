import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isMissingSchemaError } from "@/lib/rpc-errors";
import { toast } from "sonner";
import type { AjustePedidoGanho } from "./AjustarPedidoGanho";

export interface AjusteRegistrado {
  id: string;
  reason: string;
  before_value: number;
  after_value: number;
  created_at: string;
}

const errors: Record<string, string> = {
  access_denied: "Você não tem permissão para ajustar este pedido.",
  order_not_found: "Pedido não encontrado. Atualize a ficha.",
  order_not_won: "O negócio precisa estar ganho para ajustar o pedido.",
  order_state_changed:
    "O pedido foi alterado por outra pessoa. Atualize a ficha antes de ajustar.",
  adjustment_reason_required: "Informe o motivo do ajuste.",
  invalid_sale_value: "Informe um valor válido maior que zero.",
  invalid_items: "Confira as quantidades, valores e descontos dos produtos.",
  order_erp_linked:
    "Este pedido tem vínculo com ERP. Atualize no sistema de origem para manter os valores sincronizados.",
  sale_link_ambiguous:
    "Não foi possível identificar a venda deste pedido com segurança. Solicite a conferência do histórico ao suporte.",
};

export function ajustePedidoError(error: { message?: string; code?: string }) {
  if (isMissingSchemaError(error))
    return "O ajuste de pedidos ainda não está disponível neste ambiente.";
  return (
    Object.entries(errors).find(([code]) =>
      error.message?.includes(code),
    )?.[1] ??
    "Não foi possível salvar o ajuste. Atualize a ficha e tente novamente."
  );
}

export function useAjustarPedidoGanho(
  dealId: string | null,
  entryId: string | null,
  updatedAt: string | null,
  organizationId: string | null,
) {
  const qc = useQueryClient();
  const historico = useQuery({
    queryKey: ["deal-order-adjustments", dealId, organizationId],
    enabled: !!dealId && !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deal_order_adjustments" as never)
        .select("id, reason, before_value, after_value, created_at")
        .eq("deal_id", dealId!)
        .eq("organization_id", organizationId!)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) {
        if (isMissingSchemaError(error)) return [];
        throw error;
      }
      return data as unknown as AjusteRegistrado[];
    },
  });
  const mutation = useMutation({
    mutationFn: async (ajuste: AjustePedidoGanho) => {
      const { error } = await supabase.rpc(
        "ajustar_pedido_ganho" as never,
        {
          p_deal_id: dealId,
          p_expected_updated_at: updatedAt,
          p_value: ajuste.valor,
          p_items: ajuste.itens,
          p_reason: ajuste.motivo,
        } as never,
      );
      if (error) throw new Error(ajustePedidoError(error));
    },
    onSuccess: async () => {
      toast.success("Pedido ajustado. A venda continua ganha.");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["deal-card-extras", entryId] }),
        ...[
          "deal-order-adjustments",
          "leads-deals",
          "leads-sales-metrics",
          "pipeline-page",
          "custom_pipe_entries",
          "carteira_orders",
          "upsell_orders",
          "upsell_clients",
          "portfolio-clients",
          "portfolio-kpis",
          "sales-metrics",
          "dashboard-metrics",
          "product-ranking",
          "metric-measure",
          "ranking-data",
          "command-metrics",
          "commission-ledger",
        ].map((key) => qc.invalidateQueries({ queryKey: [key] })),
      ]);
    },
  });
  return { ...mutation, historico: historico.data ?? [] };
}
