import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Resumo de vendas reais de uma org (master-scoped), via RPC
 * `master_get_org_sales_summary`. Métrica = COORTE: leads CRIADOS no período
 * (anchor created_at, não-deletados) que viraram venda no pipe system
 * 'propostas' — espelha get_funnel_health.stages.compraram (aba Saúde). `start`
 * e `end` são as bordas do período-calendário corrente. O gate de segurança vive
 * no RPC (is_master_user()): chamadas de não-master são rejeitadas pelo banco.
 */
export interface OrgSalesSummary {
  num_vendas: number;
  receita_total: number;
  ticket_medio: number;
  sale_values: number[];
  period_start: string;
  period_end: string;
}

/**
 * @param orgId org alvo (master seleciona); query desativada sem orgId.
 * @param start data inicial inclusiva (YYYY-MM-DD).
 * @param end   data final inclusiva (YYYY-MM-DD).
 */
export function useOrgSalesSummary(
  orgId: string | undefined,
  start: string,
  end: string,
) {
  return useQuery({
    queryKey: ["master-org-sales-summary", orgId, start, end],
    queryFn: async (): Promise<OrgSalesSummary> => {
      // RPC ainda não está nos types gerados (migration não aplicada) → cast.
      const { data, error } = await (supabase.rpc as any)(
        "master_get_org_sales_summary",
        { p_org_id: orgId, p_start: start, p_end: end },
      );
      if (error) throw error;
      return data as OrgSalesSummary;
    },
    enabled: !!orgId && !!start && !!end,
    staleTime: 60_000,
  });
}
