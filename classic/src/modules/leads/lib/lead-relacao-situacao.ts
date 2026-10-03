/**
 * Relação e situação são fatos separados. Decisão CTO, 2026-09-08:
 * - ganho atual ou venda líquida histórica: Cliente, mesmo com perdas;
 * - todos os negócios perdidos, nenhum aberto/ganho: Perdido;
 * - nenhum negócio ou negociação ainda aberta, sem ganho: Lead.
 * Pedido de ERP isolado não classifica na Lei da Relação. A prova por pedido
 * é preservada somente quando usaLeiDoErp=true.
 * A lista recebe o valor canônico de relacao_negocios(leads), usado também
 * no filtro do banco; os cards derivam a mesma regra dos dados carregados.
 * Situação continua indicando o negócio aberto mais avançado, separadamente.
 */

import type { LeadDeal } from "../hooks/useLeadsDeals";
import type { LeadCarteiraMetrics } from "../hooks/useLeadsCarteiraMetrics";
import type { LeadSalesMetrics } from "../hooks/useLeadsSalesMetrics";

export type LeadRelacao = "lead" | "cliente" | "perdido";

/** Qual prova sustenta o `Cliente`. `null` quando ainda é `Lead`. */
export type ProvaDeCompra = "funil" | "erp" | "ambas";

export interface LeadStanding {
  relacao: LeadRelacao;
  prova: ProvaDeCompra | null;
  /** Há pelo menos um Negócio aberto. */
  emNegociacao: boolean;
  /** O Negócio aberto mais avançado. `null` quando não há aberto. */
  maisAvancado: LeadDeal | null;
}

/** Posição da cadeia system. Quanto maior, mais perto do dinheiro. */
const ORDEM_SYSTEM: Record<string, number> = {
  whatsapp: 0,
  confirmacao: 1,
  propostas: 2,
};

function estaAberto(deal: LeadDeal): boolean {
  return deal.outcome === "open";
}

/**
 * Compara dois Negócios abertos. Devolve > 0 quando `a` está mais avançado.
 *
 * Ordem de critérios: system antes de custom → posição na cadeia system →
 * `stagePosition` → nome do funil (só para não oscilar).
 */
function maisAvancadoQue(a: LeadDeal, b: LeadDeal): number {
  if (a.isSystem !== b.isSystem) return a.isSystem ? 1 : -1;

  if (a.isSystem && b.isSystem) {
    const ordemA = ORDEM_SYSTEM[a.pipelineSlug] ?? -1;
    const ordemB = ORDEM_SYSTEM[b.pipelineSlug] ?? -1;
    if (ordemA !== ordemB) return ordemA - ordemB;
  }

  const posA = a.stagePosition ?? -1;
  const posB = b.stagePosition ?? -1;
  if (posA !== posB) return posA - posB;

  // Empate real: decide pelo nome só para a escolha não mudar a cada render.
  return b.funnelName.localeCompare(a.funnelName, "pt-BR");
}

export interface DeriveStandingInput {
  /** A Lei do ERP mantém sua prova por pedido; Relação exige ganho. */
  usaLeiDoErp?: boolean;
  /** Valor canônico calculado pelo banco para a lista paginada. */
  relacao?: LeadRelacao;
  /** Negócios do lead — `useLeadsDeals`. */
  deals?: LeadDeal[];
  /** Vendas líquidas de estorno no funil — `useLeadsSalesMetrics`. */
  vendas?: LeadSalesMetrics;
  /** Pedidos vindos de ERP — `useLeadsCarteiraMetrics`. */
  carteira?: LeadCarteiraMetrics;
}

export function deriveLeadStanding({
  deals = [],
  vendas,
  carteira,
  usaLeiDoErp = false,
  relacao,
}: DeriveStandingInput): LeadStanding {
  const porFunil = (vendas?.saleCount ?? 0) > 0 || deals.some((d) => d.outcome === "won");
  const porErp = usaLeiDoErp && (carteira?.orderCount ?? 0) > 0;

  const prova: ProvaDeCompra | null =
    porFunil && porErp ? "ambas" : porFunil ? "funil" : porErp ? "erp" : null;

  const abertos = deals.filter(estaAberto);
  let maisAvancado: LeadDeal | null = null;
  for (const deal of abertos) {
    if (!maisAvancado || maisAvancadoQue(deal, maisAvancado) > 0) {
      maisAvancado = deal;
    }
  }

  return {
    relacao: relacao ?? (prova ? "cliente" : deals.length > 0 && deals.every((d) => d.outcome === "lost") ? "perdido" : "lead"),
    prova,
    emNegociacao: abertos.length > 0,
    maisAvancado,
  };
}

/**
 * Deriva os dois fatos para a página inteira de uma vez.
 *
 * Recebe os mapas que os três hooks já devolvem chaveados por lead. Um lead
 * ausente dos três mapas é `Lead · Sem negócio aberto` — o estado padrão, e o
 * majoritário: 33.036 de 35.154 linhas em prod.
 */
export function deriveLeadStandings(
  leadIds: string[],
  fontes: {
    usaLeiDoErp?: boolean;
    relacoes?: Record<string, LeadRelacao | undefined>;
    deals?: Record<string, LeadDeal[]>;
    vendas?: Record<string, LeadSalesMetrics>;
    carteira?: Record<string, LeadCarteiraMetrics>;
  },
): Record<string, LeadStanding> {
  const out: Record<string, LeadStanding> = {};
  for (const id of leadIds) {
    out[id] = deriveLeadStanding({
      usaLeiDoErp: fontes.usaLeiDoErp,
      relacao: fontes.relacoes?.[id],
      deals: fontes.deals?.[id],
      vendas: fontes.vendas?.[id],
      carteira: fontes.carteira?.[id],
    });
  }
  return out;
}
