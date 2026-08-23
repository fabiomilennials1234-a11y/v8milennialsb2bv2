/**
 * Os dois fatos que a aba de Leads é obrigada a declarar — ADR-0023 decisão 6.
 *
 * Módulo PURO, na mesma forma de `data-metrics.ts`: recebe o que os hooks da
 * página já carregaram e devolve os dois valores. Sem React, sem Supabase,
 * testável sem banco.
 *
 * **Relação** — `Lead` ou `Cliente`. Já comprou alguma vez. Monotônico.
 * **Situação** — `Em negociação` (com o funil do Negócio aberto mais avançado)
 * ou `Sem negócio aberto`.
 *
 * Os dois andam SEMPRE juntos e nunca colapsam num status só. Medido em prod
 * 2026-08-04: 180 leads são Cliente **e** estão em negociação agora. Um status
 * de valor único teria que escolher metade da verdade exatamente no caso que a
 * fatia 2 existe pra representar — o cliente que voltou e está sendo
 * trabalhado de novo.
 *
 * ── RELAÇÃO LÊ O LEDGER, NÃO A POSIÇÃO DO CARD ────────────────────────────
 * A implementação óbvia seria "tem card numa etapa `won`". Ela não é
 * monotônica, e a decisão 4 da mesma ADR piora isso de propósito: avançar
 * virou **move**, então o card SAI da etapa onde ganhou.
 *
 * Medido em prod: 342 leads têm venda em `sale_events`, mas só 223 têm card
 * parado numa etapa ganha. **119 venderam e o card já saiu** — lendo o board,
 * 35% dos clientes desapareceriam, e o número cresce a cada Negócio que
 * avança. Na direção contrária o ledger nunca perde: cards em etapa ganha sem
 * evento correspondente são 0.
 *
 * ── AS DUAS PROVAS DE COMPRA ──────────────────────────────────────────────
 * A ADR-0023 decisão 7 aceita duas: um Negócio ganho ou um **pedido** de ERP.
 * São populações quase disjuntas — 176 leads só pelo funil, 129 só pelo ERP,
 * 52 pelos dois. Usar só uma das provas erraria a maior parte dos 357
 * clientes.
 *
 * Atenção ao "pedido": não basta existir linha em `upsell_clients`. Das 735
 * linhas ligadas a lead vivo, **554 têm `order_count = 0` e valor zero** —
 * cliente cadastrado pela integração que nunca comprou. O contador é
 * confiável: batido contra `upsell_orders`, o drift é 0 nos dois sentidos.
 * Por isso a prova é `orderCount > 0`, não a existência da linha.
 *
 * ⚠️ A própria ADR-0023 §7 cita "739 rows exist in Carteira" como se fossem
 * clientes. São linhas, não pedidos. Com a regra fiel ao texto ("an ERP
 * order") a população de Cliente cai de ~1.019 para **357**.
 *
 * ── O QUE "MAIS AVANÇADO" QUER DIZER ──────────────────────────────────────
 * Dos 4.476 leads com mais de um Negócio aberto, **3.959 (88%) misturam funil
 * system e funil custom** — a comparação entre os dois não é caso de borda, é
 * o caso dominante.
 *
 * A cadeia system (`whatsapp` → `confirmacao` → `propostas`) existe em toda
 * org e é o caminho canônico até o dinheiro: `propostas` é onde `sale_value` e
 * `sale_events` são gravados. Um funil custom é uma cadeia paralela, definida
 * pela org, sem posição comparável dentro dessa progressão. Então funil system
 * ganha de custom, e custom só responde quando não há nenhum aberto em system
 * (60 leads hoje).
 *
 * Dentro do mesmo grupo desempata `stagePosition` (etapa mais à frente), e
 * depois o nome do funil — pra a resposta ser estável entre renders.
 */

import type { LeadDeal } from "../hooks/useLeadsDeals";
import type { LeadCarteiraMetrics } from "../hooks/useLeadsCarteiraMetrics";
import type { LeadSalesMetrics } from "../hooks/useLeadsSalesMetrics";

export type LeadRelacao = "lead" | "cliente";

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
}: DeriveStandingInput): LeadStanding {
  const porFunil = (vendas?.saleCount ?? 0) > 0;
  const porErp = (carteira?.orderCount ?? 0) > 0;

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
    relacao: prova ? "cliente" : "lead",
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
    deals?: Record<string, LeadDeal[]>;
    vendas?: Record<string, LeadSalesMetrics>;
    carteira?: Record<string, LeadCarteiraMetrics>;
  },
): Record<string, LeadStanding> {
  const out: Record<string, LeadStanding> = {};
  for (const id of leadIds) {
    out[id] = deriveLeadStanding({
      deals: fontes.deals?.[id],
      vendas: fontes.vendas?.[id],
      carteira: fontes.carteira?.[id],
    });
  }
  return out;
}
