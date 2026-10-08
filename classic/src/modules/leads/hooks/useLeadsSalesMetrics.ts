import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

/**
 * Vendas do lead, lidas de `sale_events` — o ledger canônico de receita
 * (ADR-0017). É o que enche o cluster "Dados" da lista quando o negócio é
 * ganho no funil.
 *
 * Por que não `upsell_clients`: a carteira **não** é alimentada por ganhar
 * negócio. Medido em 2026-07-30, em prod e na branch: `handle_proposta_vendida`
 * existe como função e tem **zero triggers ligados** — o fluxo que a
 * documentação descreve ("proposta vendida → cliente de carteira") não roda.
 * Os 738 clientes de carteira de prod vieram de integração de ERP
 * (`tinyerp-*`, `erp-order-webhook`), não do funil. Ler carteira aqui deixaria
 * o número zerado pra sempre em toda org sem ERP.
 *
 * `sale_events`, ao contrário, já dispara certo: arrastar o card pra etapa com
 * `stage_role = 'won'` grava a linha com `sold_at` carimbado no instante do
 * arraste — que é exatamente a âncora que o CTO pediu pra "última venda".
 *
 * Estorno: uma linha com `reversed_event_id` preenchido cancela o evento que
 * ela aponta. Contamos só as vendas não canceladas — mesma semântica de
 * "sold_at líquido de estorno" que o painel de movimentações já usa.
 *
 * Multi-tenancy: filtra `organization_id` explicitamente além da RLS.
 */
export interface LeadSalesMetrics {
  leadId: string;
  /** Vendas líquidas de estorno. */
  saleCount: number;
  /** Soma de `sale_value` das vendas líquidas. Venda sem valor entra como 0. */
  totalValue: number;
  /** Média entre as vendas **que carregam valor** — venda sem valor não dilui. */
  avgTicket: number;
  /** `sold_at` da venda mais recente. */
  lastSaleAt: string | null;
  /** Dias desde a última venda. */
  daysSinceLastSale: number | null;
  /**
   * Intervalo médio entre vendas consecutivas, em dias.
   * `null` com menos de 2 vendas — a UI mostra "calculando", porque com uma
   * venda só ainda não existe intervalo a medir.
   */
  cycleDays: number | null;
}

export type LeadSalesMetricsMap = Record<string, LeadSalesMetrics>;

const num = (v: number | string | null | undefined): number =>
  v === null || v === undefined ? 0 : Number(v) || 0;

/** Linha crua de `sale_events` consumida pelo cálculo. */
export interface SaleEventRow {
  id: string;
  lead_id: string | null;
  event_type: string | null;
  sale_value: number | string | null;
  sold_at: string | null;
  reversed_event_id: string | null;
}

/**
 * Reduz eventos de venda a métricas por lead. Pura de propósito: `sale_events`
 * é append-only com `sold_at` carimbado pelo servidor
 * (`trg_sale_events_force_sold_at` força `now()` no INSERT e
 * `trg_sale_events_immutable` bloqueia UPDATE/DELETE), então não há como forjar
 * datas passadas para testar pela borda. O teste mora aqui.
 *
 * `agora` é injetável pelo mesmo motivo.
 */
export function computeSalesMetrics(
  rows: SaleEventRow[],
  agora: number = Date.now(),
): LeadSalesMetricsMap {
  // Estorno: `sale_events_reversal_coherence` garante que
  // `event_type = 'sale_reversed'` ⇔ `reversed_event_id IS NOT NULL`.
  const cancelados = new Set<string>();
  for (const r of rows) {
    if (r.reversed_event_id) cancelados.add(r.reversed_event_id);
  }

  const porLead = new Map<string, { valor: number; quando: number }[]>();

  for (const r of rows) {
    if (!r.lead_id || !r.sold_at) continue;
    if (r.reversed_event_id) continue; // é o estorno, não a venda
    if (cancelados.has(r.id)) continue; // venda estornada
    if (r.event_type && r.event_type !== "sale") continue; // sale_lost não conta

    const quando = new Date(r.sold_at).getTime();
    if (Number.isNaN(quando)) continue;

    const lista = porLead.get(r.lead_id) ?? [];
    lista.push({ valor: num(r.sale_value), quando });
    porLead.set(r.lead_id, lista);
  }

  const map: LeadSalesMetricsMap = {};

  for (const [leadId, vendas] of porLead) {
    if (vendas.length === 0) continue;
    vendas.sort((a, b) => a.quando - b.quando);

    const totalValue = vendas.reduce((s, v) => s + v.valor, 0);
    const comValor = vendas.filter((v) => v.valor > 0);
    const ultima = vendas[vendas.length - 1];

    // Intervalo médio entre vendas consecutivas. Com uma venda só não há
    // intervalo — fica `null` e a tela diz "calculando".
    let cycleDays: number | null = null;
    if (vendas.length >= 2) {
      const span = ultima.quando - vendas[0].quando;
      cycleDays = Math.max(0, Math.round(span / (vendas.length - 1) / 86_400_000));
    }

    map[leadId] = {
      leadId,
      saleCount: vendas.length,
      totalValue,
      avgTicket: comValor.length ? totalValue / comValor.length : 0,
      lastSaleAt: new Date(ultima.quando).toISOString(),
      daysSinceLastSale: Math.max(0, Math.floor((agora - ultima.quando) / 86_400_000)),
      cycleDays,
    };
  }

  return map;
}

/**
 * Busca em lote as vendas dos leads visíveis na página.
 *
 * Chaveado pelos ids da página corrente (máx. `LEADS_PAGE_SIZE`), então o `IN`
 * nunca cresce sem limite — mesmo contrato de `useLeadsCarteiraMetrics`.
 */
export function useLeadsSalesMetrics(leadIds: string[]) {
  const { organizationId, isReady } = useOrganization();

  // Ordena para a queryKey ser estável independente da ordem de renderização.
  const ids = [...leadIds].sort();

  return useQuery<LeadSalesMetricsMap>({
    queryKey: ["leads-sales-metrics", organizationId, ids],
    queryFn: async () => {
      if (!organizationId || ids.length === 0) return {};

      const { data, error } = await supabase
        .from("sale_events")
        .select("id, lead_id, event_type, sale_value, sold_at, reversed_event_id")
        .eq("organization_id", organizationId)
        .in("lead_id", ids);

      if (error) throw error;

      return computeSalesMetrics((data ?? []) as SaleEventRow[]);
    },
    enabled: isReady && ids.length > 0,
    staleTime: 30 * 1000,
  });
}
