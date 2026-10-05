import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isMissingSchemaError } from "@/lib/rpc-errors";
import { toast } from "sonner";
import type { CorrecaoVendaHistorica } from "./types";

const errors: Record<string, string> = {
  access_denied: "Você não tem permissão para corrigir esta venda.",
  sale_not_found: "Venda não encontrada. Atualize a ficha.",
  not_historical_sale: "Só vendas registradas pelo histórico podem ser corrigidas aqui.",
  sale_state_changed: "A venda foi alterada por outra pessoa. Atualize a ficha antes de corrigir.",
  correction_reason_required: "Informe o motivo da correção.",
  invalid_sale_value: "Informe um valor maior que zero, com até duas casas decimais.",
  invalid_sale_date: "Informe uma data que não seja futura.",
  sale_link_ambiguous:
    "Não foi possível identificar o registro desta venda com segurança. Solicite a conferência ao suporte.",
};

export function correcaoVendaError(error: { message?: string; code?: string }) {
  if (isMissingSchemaError(error)) return "A correção de vendas ainda não está disponível neste ambiente.";
  return (
    Object.entries(errors).find(([code]) => error.message?.includes(code))?.[1] ??
    "Não foi possível salvar a correção. Atualize a ficha e tente novamente."
  );
}

export function useCorrigirVendaHistorica(dealId: string | null, organizationId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (correcao: CorrecaoVendaHistorica) => {
      // A versão é lida no instante de gravar: a trava otimista protege de edição
      // concorrente entre este clique e a RPC, não de uma ficha aberta há horas.
      const { data: atual, error: leitura } = await supabase
        .from("deals")
        .select("updated_at")
        .eq("id", dealId!)
        .eq("organization_id", organizationId!)
        .maybeSingle();
      if (leitura) throw new Error(correcaoVendaError(leitura));
      if (!atual) throw new Error(errors.sale_not_found);
      const { error } = await supabase.rpc(
        "corrigir_venda_historica" as never,
        {
          p_deal_id: dealId,
          p_expected_updated_at: atual.updated_at,
          p_value: correcao.valor,
          p_date: correcao.data,
          p_reason: correcao.motivo,
        } as never,
      );
      if (error) throw new Error(correcaoVendaError(error));
    },
    onSuccess: async () => {
      toast.success("Venda corrigida: negócio, receita e pedido foram atualizados.");
      await Promise.all(
        [
          "leads-deals",
          "leads-sales-metrics",
          "carteira_orders",
          "upsell_orders",
          "upsell_clients",
          "upsell-orders",
          "upsell-clients",
          "portfolio-clients",
          "portfolio-kpis",
          "portfolio-trends",
          "sales-metrics",
          "dashboard-metrics",
          "product-ranking",
          "metric-measure",
          "metrics-studio",
          "ranking-data",
          "command-metrics",
          "commission-ledger",
        ].map((key) => qc.invalidateQueries({ queryKey: [key] })),
      );
    },
  });
}
