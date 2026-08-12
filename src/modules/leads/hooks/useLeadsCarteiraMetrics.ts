import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

/**
 * Métricas de carteira exibidas no cluster "Dados" da lista de leads.
 *
 * Fonte: `upsell_clients` — as colunas já são mantidas pelo trigger
 * `trg_upsell_order_recalc_metrics` (dinheiro, síncrono) + cron
 * `calculate-portfolio-health` (health/segment/churn, 30min).
 * Ver `src/modules/carteira/CLAUDE.md`.
 *
 * Um lead sem linha em `upsell_clients` simplesmente não aparece no mapa —
 * é o estado "ainda não comprou", legítimo e majoritário.
 */
export interface LeadCarteiraMetrics {
  leadId: string;
  /** Receita acumulada do cliente (soma dos pedidos aprovados). */
  lifetimeValue: number;
  /** Ticket médio dos pedidos aprovados. */
  avgTicket: number;
  /** Quantidade de pedidos aprovados. */
  orderCount: number;
  /** Intervalo médio entre pedidos, em dias. */
  reorderCycleDays: number | null;
  /** Dias desde o último pedido. */
  daysSinceLastOrder: number | null;
  /** ouro | prata | novo | resgate | dormindo */
  segment: string | null;
}

export type LeadCarteiraMetricsMap = Record<string, LeadCarteiraMetrics>;

const num = (v: number | string | null): number => (v === null ? 0 : Number(v) || 0);

/**
 * Busca em lote as métricas de carteira dos leads visíveis na página.
 *
 * Chaveado pelos ids da página corrente (máx. `LEADS_PAGE_SIZE`), então o `IN`
 * nunca cresce sem limite. Multi-tenancy: filtra `organization_id` além da RLS.
 */
export function useLeadsCarteiraMetrics(leadIds: string[]) {
  const { organizationId, isReady } = useOrganization();

  // Ordena para a queryKey ser estável independente da ordem de renderização.
  const ids = [...leadIds].sort();

  return useQuery<LeadCarteiraMetricsMap>({
    queryKey: ["leads-carteira-metrics", organizationId, ids],
    queryFn: async () => {
      if (!organizationId || ids.length === 0) return {};

      const { data, error } = await supabase
        .from("upsell_clients")
        .select(
          "lead_id, lifetime_value, avg_ticket, order_count, reorder_cycle_days, days_since_last_order, segment",
        )
        .eq("organization_id", organizationId)
        .in("lead_id", ids);

      if (error) throw error;

      const map: LeadCarteiraMetricsMap = {};
      for (const row of data ?? []) {
        if (!row.lead_id) continue;
        map[row.lead_id] = {
          leadId: row.lead_id,
          lifetimeValue: num(row.lifetime_value),
          avgTicket: num(row.avg_ticket),
          orderCount: num(row.order_count),
          reorderCycleDays: row.reorder_cycle_days ?? null,
          daysSinceLastOrder: row.days_since_last_order ?? null,
          segment: row.segment ?? null,
        };
      }
      return map;
    },
    enabled: isReady && ids.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
