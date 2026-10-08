import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { CorrecaoDataDoDesfecho } from "@/modules/leads/components/deal-card/types";
import { CHAVES_DA_VENDA, correcaoVendaError } from "./useCorrigirVendaHistorica";

/**
 * Corrige "Vendido em" / "Perdido em" pelo card.
 *
 * Uma RPC para os dois desfechos (`corrigir_data_do_desfecho`): no ganho ela
 * delega para `corrigir_venda_ganha` com o valor que o negócio já tem — receita,
 * pedido e comissão acompanham a data. Na perda ela estorna o `sale_lost` e grava
 * outro na data certa, que é o que os relatórios de perda leem.
 */
const errors: Record<string, string> = {
  deal_not_found: "Negócio não encontrado. Atualize a ficha.",
  deal_not_closed: "O negócio precisa estar ganho ou perdido para corrigir a data.",
  deal_state_changed: "O negócio foi alterado por outra pessoa. Atualize a ficha antes de corrigir.",
  invalid_outcome_date: "Informe uma data que não seja futura.",
  invalid_sale_value:
    "Este negócio está sem valor. Corrija data e valor juntos em \"Corrigir data e valor da venda\".",
};

export function correcaoDataError(error: { message?: string; code?: string }) {
  return (
    Object.entries(errors).find(([code]) => error.message?.includes(code))?.[1] ?? correcaoVendaError(error)
  );
}

export function useCorrigirDataDoDesfecho(
  dealId: string | null,
  organizationId: string | null,
  updatedAt: string | null = null,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (correcao: CorrecaoDataDoDesfecho) => {
      if (!dealId || !organizationId) throw new Error(errors.deal_not_found);
      const versao = correcao.versao ?? updatedAt;
      if (!versao) throw new Error(errors.deal_state_changed);
      const { data, error } = await supabase.rpc(
        "corrigir_data_do_desfecho" as never,
        {
          p_deal_id: dealId,
          p_expected_updated_at: versao,
          p_date: correcao.data,
          p_reason: correcao.motivo,
        } as never,
      );
      if (error) throw new Error(correcaoDataError(error));
      return (data ?? null) as { changed?: boolean; metric_event_corrected?: boolean } | null;
    },
    onSuccess: async (resultado) => {
      // Perda antiga sem evento no caderno: o card muda, o relatório não tinha
      // essa perda para mover. Dizer isso evita a pergunta "por que o relatório
      // não mudou?".
      if (resultado?.metric_event_corrected === false) {
        toast.success("Data corrigida no negócio. Esta perda é anterior ao registro de métricas e não aparece nos relatórios.");
      } else {
        toast.success("Data corrigida. Relatórios e métricas já usam a nova data.");
      }
      await Promise.all(CHAVES_DA_VENDA.map((key) => qc.invalidateQueries({ queryKey: [key] })));
    },
  });
}
