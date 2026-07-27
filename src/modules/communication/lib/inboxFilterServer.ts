/**
 * inboxFilterServer — traduz o estado do filtro do inbox nos argumentos da RPC
 * `get_whatsapp_conversation_list`.
 *
 * Por que existe (issue #1277): o filtro era aplicado só no cliente, sobre a
 * página de 500 conversas mais recentes que a RPC devolvia. Toda conversa fora
 * dessa janela era invisível ao filtro — na Goletric Pinheiros, as 27 conversas
 * em "Qualificando" ocupavam as posições 507–869 e o inbox dizia "Total: 0".
 *
 * O contrato é assimétrico de propósito: **o servidor pré-filtra, o cliente
 * refina**. Os argumentos daqui têm que casar a semântica de `applyInboxFilters`
 * ou ser mais permissivos — nunca mais restritivos. Se as duas camadas
 * divergirem, o cliente corta a mais; o inverso sumiria com conversa legítima.
 *
 * Fora do contrato de propósito:
 *   - **Aba ativas/arquivadas** — os dois contadores ("Ativas (N)"/"Arquivadas
 *     (N)") saem da MESMA lista carregada. Filtrar a aba no servidor zeraria o
 *     contador da outra. Segue no cliente, coberto pelo teto maior.
 *   - **Grupo** — o engine do cliente sempre remove; a RPC não precisa saber.
 */
import type { InboxFilterState } from "./inboxFilter";

/** Argumentos de filtro da RPC. `null` = dimensão inativa. */
export interface InboxServerFilterArgs {
  p_funnels: string[] | null;
  p_stages: string[] | null;
  p_tags: string[] | null;
  p_tiers: string[] | null;
  p_vendor_id: string | null;
  p_unassigned: boolean | null;
  p_lead_presence: "com" | "sem" | null;
  p_needs_human: boolean | null;
  p_unread: boolean | null;
  p_waiting: boolean | null;
  p_source: "ia" | "humano" | null;
}

/** Página sem filtro: o mesmo teto de sempre. */
export const UNFILTERED_PAGE_LIMIT = 500;
/**
 * Página com filtro: teto da RPC. Com o pré-filtro server-side o universo já
 * chega cortado, então a folga é grande — mas é folga, não garantia. Org que
 * estoure isto numa dimensão só volta a truncar (paginação fica pra depois).
 */
export const FILTERED_PAGE_LIMIT = 1000;

export interface InboxServerFilter {
  args: InboxServerFilterArgs | null;
  limit: number;
  /**
   * Sufixo estável da queryKey. `""` quando não há dimensão empurrada — assim a
   * lista sem filtro compartilha cache com os outros consumidores da RPC
   * (command palette, bolha de chat), como antes.
   */
  cacheKey: string;
}

const EMPTY_ARGS: InboxServerFilterArgs = {
  p_funnels: null,
  p_stages: null,
  p_tags: null,
  p_tiers: null,
  p_vendor_id: null,
  p_unassigned: null,
  p_lead_presence: null,
  p_needs_human: null,
  p_unread: null,
  p_waiting: null,
  p_source: null,
};

/** Ordena pra a chave de cache não mudar só porque o usuário clicou noutra ordem. */
const orNull = (xs: string[]): string[] | null => (xs.length ? [...xs].sort() : null);

/**
 * @param state  filtro do inbox (persistido por org+usuário).
 * @param currentTeamMemberId  resolve `vendor: "mine"`.
 */
export function toServerFilter(
  state: InboxFilterState,
  currentTeamMemberId: string | null,
): InboxServerFilter {
  const args: InboxServerFilterArgs = { ...EMPTY_ARGS };

  args.p_funnels = orNull(state.funnels);
  args.p_stages = orNull(state.stages);
  args.p_tags = orNull(state.tags);
  args.p_tiers = orNull(state.tiers);

  // Vendedor. "mine" sem team_member resolvido não empurra nada: o cliente já
  // devolve lista vazia nesse caso, e o servidor não deve adivinhar.
  if (state.vendor === "unassigned") {
    args.p_unassigned = true;
  } else if (state.vendor === "mine") {
    if (currentTeamMemberId) args.p_vendor_id = currentTeamMemberId;
  } else if (state.vendor !== "all") {
    args.p_vendor_id = state.vendor;
  }

  if (state.lead) args.p_lead_presence = state.lead;
  if (state.needsHuman) args.p_needs_human = true;
  if (state.unread) args.p_unread = true;
  if (state.waiting) args.p_waiting = true;
  if (state.source) args.p_source = state.source;

  const active = Object.entries(args)
    .filter(([, v]) => v !== null)
    .sort(([a], [b]) => a.localeCompare(b));

  if (active.length === 0) {
    return { args: null, limit: UNFILTERED_PAGE_LIMIT, cacheKey: "" };
  }
  return {
    args,
    limit: FILTERED_PAGE_LIMIT,
    cacheKey: JSON.stringify(active),
  };
}
