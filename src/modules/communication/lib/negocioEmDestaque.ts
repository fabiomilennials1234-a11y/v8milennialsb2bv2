/**
 * Qual Negócio o bloco de ouro do chat mostra (CTO, 02/10 — P8a).
 *
 * O lead pode ter vários Negócios, um por funil (e até dois no mesmo funil —
 * recompra, ADR-0023). O bloco tem lugar para UM, só leitura. A regra:
 *
 *   1. aberto antes de fechado — é o que a conversa ainda pode mover;
 *   2. entre abertos, o que se mexeu por último (`stageChangedAt`, com queda
 *      para `enteredAt`);
 *   3. sem nenhum aberto, o fechado mais recente, com o desfecho no rótulo;
 *   4. venda histórica (anterior ao CRM) nunca é destaque — não tem etapa.
 *
 * `outrosAbertos` existe para o bloco dizer "+N" em vez de fingir que é o
 * único. A lista completa continua na aba Infos (Funis do lead).
 */
import type { LeadDeal } from "@/modules/leads";

export interface NegocioEmDestaque {
  negocio: LeadDeal;
  outrosAbertos: number;
}

function quando(d: LeadDeal): number {
  const iso = d.stageChangedAt ?? d.enteredAt;
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
}

export function negocioEmDestaque(deals: readonly LeadDeal[] | null | undefined): NegocioEmDestaque | null {
  const reais = (deals ?? []).filter((d) => !d.historicalSale);
  if (reais.length === 0) return null;

  const abertos = reais.filter((d) => d.outcome === "open").sort((a, b) => quando(b) - quando(a));
  if (abertos.length > 0) {
    return { negocio: abertos[0], outrosAbertos: abertos.length - 1 };
  }

  const fechados = [...reais].sort((a, b) => quando(b) - quando(a));
  return { negocio: fechados[0], outrosAbertos: 0 };
}
