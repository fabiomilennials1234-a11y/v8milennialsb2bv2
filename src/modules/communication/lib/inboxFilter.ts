/**
 * inboxFilter — engine puro de filtragem do inbox WhatsApp.
 *
 * Toda a lógica de "qual conversa passa no filtro" vive aqui, isolada de React e
 * de rede, para ser testável e previsível. Semântica travada no grill (2026-07-23):
 *
 *   - **AND entre dimensões, OR dentro da dimensão.** Etapa=Novo|Abordado é OR;
 *     (Etapa AND Vendedor) é AND.
 *   - Grupos nunca aparecem — só conversas individuais.
 *   - "Aguardando resposta" = última mensagem foi do lead (incoming).
 *   - "Pediu atendente" = lead na fila de handoff da IA (waitingHumanLeadIds).
 *   - "Fonte" = quem mandou a última mensagem: IA (copilot/workflow) vs humano (manual).
 *
 * O contato já chega **enriquecido** (funis + qualification_tier) pela camada de
 * dados; o vendedor é resolvido via contexto (mapa lead→responsável), preservando
 * o modelo atual sem migração de schema.
 */
import type { ChatContact } from "@/modules/communication/hooks/chat/types";

// ─── Tipos de estado ────────────────────────────────────────────────────────

export type SourceFilter = "ia" | "humano";
export type LeadPresenceFilter = "com" | "sem";

/**
 * Recorte de escopo da lista — as abas do topo do inbox.
 *
 * `"grupos"` só existe para org com a flag `chat_abas_de_grupos`: sem ela a aba
 * não é renderizada e o valor nunca chega aqui. Ele é um TERCEIRO escopo, e não
 * um filtro somado aos outros, porque grupo não tem lead — funil, etapa,
 * vendedor e qualificação não têm o que recortar, e misturá-lo em "Ativas"
 * empurraria conversa individual para fora da página (grupo é ~40% das
 * mensagens).
 */
export type InboxTab = "active" | "archived" | "grupos";

/** Funil ativo em que o lead está, mais a etapa atual dentro dele. */
export interface ContactFunnelEntry {
  /** pipeline_id (uuid) — chave canônica que unifica pipes de sistema e custom. */
  pipelineId: string;
  /** stage_key atual do lead nesse funil. */
  stageKey: string;
}

/**
 * Estado serializável do filtro do inbox. Persistido por usuário (localStorage).
 * Listas vazias / null / false = dimensão inativa.
 */
export interface InboxFilterState {
  /** Só não-lidas (unread_count > 0). */
  unread: boolean;
  /** "all" | "mine" | "unassigned" | <teamMemberId>. */
  vendor: string;
  /** pipeline_ids selecionados (OR). */
  funnels: string[];
  /** stage_keys selecionados (OR). */
  stages: string[];
  /** tag ids selecionados (OR). */
  tags: string[];
  /** qualification_tier values selecionados (OR). */
  tiers: string[];
  /** Última mensagem foi do lead (incoming). */
  waiting: boolean;
  /** Lead pediu atendente humano (fila de handoff da IA). */
  needsHuman: boolean;
  /** Fonte da última mensagem. */
  source: SourceFilter | null;
  /** Com ou sem lead vinculado. */
  lead: LeadPresenceFilter | null;
}

export const DEFAULT_INBOX_FILTER: InboxFilterState = {
  unread: false,
  vendor: "all",
  funnels: [],
  stages: [],
  tags: [],
  tiers: [],
  waiting: false,
  needsHuman: false,
  source: null,
  lead: null,
};

/** Contexto de resolução que o engine não deriva do próprio contato. */
export interface InboxFilterContext {
  /** team_member id do usuário logado (habilita "mine"). */
  currentTeamMemberId: string | null;
  /** Resolve o vendedor (team_member id) dono da conversa via lead. */
  resolveVendorId: (contact: ChatContact) => string | null;
  /** Leads na fila de handoff humano. */
  waitingHumanLeadIds: Set<string>;
}

// ─── Predicados por dimensão ────────────────────────────────────────────────

function matchesVendor(c: ChatContact, state: InboxFilterState, ctx: InboxFilterContext): boolean {
  if (state.vendor === "all") return true;
  const vendorId = ctx.resolveVendorId(c);
  if (state.vendor === "mine") return vendorId != null && vendorId === ctx.currentTeamMemberId;
  if (state.vendor === "unassigned") return vendorId == null;
  return vendorId === state.vendor;
}

function matchesFunnel(c: ChatContact, funnels: string[]): boolean {
  if (funnels.length === 0) return true;
  // Defensivo: um contato de path sem enrichment pode chegar com funnels undefined.
  return (c.funnels ?? []).some((f) => funnels.includes(f.pipelineId));
}

/**
 * Etapa respeita o funil escolhido: quando há funil selecionado, a etapa só conta
 * se estiver num desses funis (honra "lead em múltiplos pipes"). Sem funil
 * selecionado, casa qualquer entrada com a etapa.
 */
function matchesStage(c: ChatContact, state: InboxFilterState): boolean {
  if (state.stages.length === 0) return true;
  return (c.funnels ?? []).some(
    (f) =>
      state.stages.includes(f.stageKey) &&
      (state.funnels.length === 0 || state.funnels.includes(f.pipelineId)),
  );
}

function matchesTags(c: ChatContact, tags: string[]): boolean {
  if (tags.length === 0) return true;
  return c.tags.some((t) => tags.includes(t.id));
}

function matchesTiers(c: ChatContact, tiers: string[]): boolean {
  if (tiers.length === 0) return true;
  return c.qualification_tier != null && tiers.includes(c.qualification_tier);
}

function matchesSource(c: ChatContact, source: SourceFilter | null): boolean {
  if (source == null) return true;
  const src = c.last_message_sent_source;
  if (source === "humano") return src === "manual";
  // "ia" = copilot ou workflow. Última msg sem fonte registrada não conta como IA.
  return src === "copilot" || src === "workflow";
}

function matchesLeadPresence(c: ChatContact, lead: LeadPresenceFilter | null): boolean {
  if (lead == null) return true;
  return lead === "com" ? c.lead_id != null : c.lead_id == null;
}

// ─── Engine ─────────────────────────────────────────────────────────────────

/**
 * Aplica o estado de filtro + a busca textual + a tab de escopo a uma lista de
 * contatos. Retorna nova lista (não muta).
 *
 * Grupo só aparece na aba `"grupos"`, que por sua vez só existe na org flagada.
 * Nas outras duas abas a recusa continua sendo a de #1632.
 */
export function applyInboxFilters(
  contacts: ChatContact[],
  state: InboxFilterState,
  ctx: InboxFilterContext,
  opts: { searchQuery?: string; tab?: InboxTab } = {},
): ChatContact[] {
  const search = (opts.searchQuery ?? "").trim().toLowerCase();
  const tab = opts.tab ?? "active";

  return contacts.filter((c) => {
    // GRUPO É ESCOPO PRÓPRIO, e o default continua sendo escondê-lo.
    //
    // Histórico: em 23/07/2026 (6356ef92) o desktop passou a esconder grupo por
    // acidente; um toggle "Grupos" foi reposto para desfazer isso; em #1632 a
    // exclusão virou incondicional em toda camada. O que volta agora NÃO é
    // aquele toggle — é uma aba, ligada por org (`chat_abas_de_grupos`), sem
    // estado persistido por membro. Org sem a flag nunca passa `tab: "grupos"`,
    // e para ela esta função devolve exatamente o que devolvia antes.
    if (tab === "grupos") {
      if (!c.is_group) return false;
      // Arquivar grupo é possível (a conversa existe em `whatsapp_conversations`),
      // e arquivada não é "ativa" em aba nenhuma — inclusive nesta.
      if (c.archived_at) return false;
    } else {
      if (c.is_group) return false;
    }

    if (tab === "active" && c.archived_at) return false;
    if (tab === "archived" && !c.archived_at) return false;

    if (state.unread && c.unread_count <= 0) return false;
    if (state.waiting && c.last_message_direction !== "incoming") return false;
    if (state.needsHuman && !(c.lead_id != null && ctx.waitingHumanLeadIds.has(c.lead_id))) return false;

    if (!matchesVendor(c, state, ctx)) return false;
    if (!matchesFunnel(c, state.funnels)) return false;
    if (!matchesStage(c, state)) return false;
    if (!matchesTags(c, state.tags)) return false;
    if (!matchesTiers(c, state.tiers)) return false;
    if (!matchesSource(c, state.source)) return false;
    if (!matchesLeadPresence(c, state.lead)) return false;

    if (search) {
      const name = (c.lead_name ?? c.push_name ?? "").toLowerCase();
      if (!c.phone_number.includes(search) && !name.includes(search)) return false;
    }
    return true;
  });
}

/** Nº de dimensões ativas (fora vendor="all"/unread — todas contam se != default). */
export function countActiveFilters(state: InboxFilterState): number {
  let n = 0;
  if (state.unread) n++;
  if (state.vendor !== "all") n++;
  if (state.funnels.length) n++;
  if (state.stages.length) n++;
  if (state.tags.length) n++;
  if (state.tiers.length) n++;
  if (state.waiting) n++;
  if (state.needsHuman) n++;
  if (state.source) n++;
  if (state.lead) n++;
  return n;
}

export function isDefaultFilter(state: InboxFilterState): boolean {
  return countActiveFilters(state) === 0;
}
