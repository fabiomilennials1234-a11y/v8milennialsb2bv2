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
 *   - **Grupo** — era "o cliente sempre remove, a RPC não precisa saber". Deixou
 *     de ser: a aba de grupos (flag `chat_abas_de_grupos`, por org) precisa que
 *     a linha de grupo CHEGUE. Como o recorte da RPC é anterior ao LIMIT, filtrar
 *     só no cliente traria a página cheia de conversa individual e a aba nasceria
 *     vazia. Então `p_include_groups` é a única dimensão daqui que AMPLIA o
 *     conjunto em vez de estreitá-lo — e o cliente continua sendo quem escolhe
 *     qual das duas metades mostrar, por aba.
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
  /**
   * `true` = a página pode conter grupo (a org tem a aba). `null` = comportamento
   * de sempre, e é o que TODO outro consumidor da RPC continua mandando.
   *
   * ⚠️ Depende da migration `20270916000000_conversation_list_grupos_por_org`.
   * Enquanto ela não estiver em prod, mandar este argumento leva `PGRST202` —
   * `useWhatsAppContacts` tem queda para a chamada sem ele, senão o inbox
   * INTEIRO da org flagada ficaria vazio por causa de uma aba.
   */
  p_include_groups: boolean | null;
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
  p_include_groups: null,
};

/** Ordena pra a chave de cache não mudar só porque o usuário clicou noutra ordem. */
const orNull = (xs: string[]): string[] | null => (xs.length ? [...xs].sort() : null);

/**
 * @param state  filtro do inbox (persistido por org+usuário).
 * @param currentTeamMemberId  resolve `vendor: "mine"`.
 * @param opcoes.incluirGrupos  a org tem a aba de grupos (`chat_abas_de_grupos`).
 *   Não é dimensão de filtro: é o universo que a página pode conter. Entra na
 *   `cacheKey` porque muda o CONJUNTO devolvido — sem isso a lista com grupo e a
 *   lista sem grupo dividiriam a mesma entrada de cache com a bolha do kanban e
 *   o command palette, e qual das duas ganharia dependeria de quem montou antes.
 */
export function toServerFilter(
  state: InboxFilterState,
  currentTeamMemberId: string | null,
  opcoes: { incluirGrupos?: boolean } = {},
): InboxServerFilter {
  const args: InboxServerFilterArgs = { ...EMPTY_ARGS };

  if (opcoes.incluirGrupos) args.p_include_groups = true;

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
  // Org com a aba, sem nenhum chip: `p_include_groups` sozinho já tira a lista do
  // teto de 500 e leva pro de 1000. É o que se quer — grupo é ~40% das mensagens,
  // então uma página de 500 com grupo dentro mostraria MENOS conversa individual
  // que a de hoje. O teto da RPC é 1000; acima disso volta a truncar (paginação
  // continua pendente, como no resto do filtro).
  return {
    args,
    limit: FILTERED_PAGE_LIMIT,
    cacheKey: JSON.stringify(active),
  };
}
