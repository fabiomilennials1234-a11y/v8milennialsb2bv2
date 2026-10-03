import type { LeadCarteiraMetrics } from "@/modules/leads/hooks/useLeadsCarteiraMetrics";
import type { LeadSalesMetrics } from "@/modules/leads/hooks/useLeadsSalesMetrics";

/**
 * Une as duas fontes de "quanto esse cliente já comprou" — e a regra é
 * precedência, nunca soma.
 *
 * `sale_events` são as vendas fechadas **aqui dentro** (ADR-0017).
 * `upsell_clients` é histórico de pedido vindo de **ERP**.
 *
 * Somar dobraria o número nas 13 organizações que têm ERP: o mesmo pedido entra
 * pelos dois lados. Então o lead que fechou venda no funil mostra a venda do
 * funil, e o lead sem venda no funil continua mostrando a carteira — nunca os
 * dois ao mesmo tempo.
 *
 * `segment` (ouro/prata/novo/resgate) é exceção deliberada: só existe na
 * carteira, e sobrevive à precedência porque não é número, é rótulo.
 *
 * ── POR QUE ISTO VIVE AQUI ────────────────────────────────────────────────
 * A regra nasceu dentro de `Leads.tsx`, num `useMemo` da página. Quando o
 * cluster "Dados" saiu da lista para o drawer (ADR-0024 decisão 1), o drawer
 * passou a precisar do mesmo número — e copiar o `useMemo` teria criado duas
 * verdades sobre o mesmo valor, livres para divergir no primeiro ajuste. Uma
 * função pura, um lugar.
 */
export function mergeDataMetrics(
  carteira: Record<string, LeadCarteiraMetrics> | undefined,
  vendas: Record<string, LeadSalesMetrics> | undefined,
): Record<string, LeadCarteiraMetrics> {
  const out: Record<string, LeadCarteiraMetrics> = { ...(carteira ?? {}) };

  for (const [leadId, s] of Object.entries(vendas ?? {})) {
    out[leadId] = {
      leadId,
      lifetimeValue: s.totalValue,
      avgTicket: s.avgTicket,
      orderCount: s.saleCount,
      reorderCycleDays: s.cycleDays,
      daysSinceLastOrder: s.daysSinceLastSale,
      segment: carteira?.[leadId]?.segment ?? null,
    };
  }

  return out;
}
