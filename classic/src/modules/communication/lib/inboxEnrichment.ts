/**
 * inboxEnrichment — política de "eu tenho o dado pra filtrar?" do inbox.
 *
 * `inboxFilterServer.ts` documenta o contrato "o servidor pré-filtra, o cliente
 * refina". A premissa que nunca foi escrita é **"o cliente TEM o dado pra
 * refinar"**. Quando ela quebra — o enriquecimento falha ou ainda não chegou —,
 * `applyInboxFilters` avalia funil/etapa/qualificação/vendedor sobre uma lista
 * vazia e descarta a página inteira. O usuário vê "Total: 0" sem uma linha de
 * erro na tela (incidente Goletric Pinheiros, 2026-07-31).
 *
 * A resposta NÃO é mudar o engine. Um fail-open dentro de `applyInboxFilters`
 * só seria correto enquanto a cláusula SQL da RPC continuasse idêntica ao
 * predicado do cliente — invariante que nada trava mecanicamente. A resposta é
 * admitir o estado "não sei" ANTES de filtrar, e a UI não mentir sobre ele.
 */
import type { InboxFilterState } from "./inboxFilter";

/** Estado de uma fonte de enriquecimento. */
export type EnrichmentStatus = "ready" | "pending" | "error";

/** Veredito do gate: o recorte exibido é confiável? */
export type InboxFilterGate = "ok" | "pending" | "error";

export interface InboxEnrichmentStatus {
  /** funis + etapa + qualificação — `useLeadInboxMeta`. */
  meta: EnrichmentStatus;
  /** vendedor — `useLeadResponsibleMap`. */
  vendor: EnrichmentStatus;
  /** etiquetas — enriquecidas DENTRO de `useWhatsAppContacts`, não num hook próprio. */
  tags: EnrichmentStatus;
  /** "pediu atendente" — a query `waiting-human-leads` do `ChatShellWithContext`. */
  waitingHuman: EnrichmentStatus;
}

export const READY_ENRICHMENT: InboxEnrichmentStatus = {
  meta: "ready",
  vendor: "ready",
  tags: "ready",
  waitingHuman: "ready",
};

/**
 * Só as dimensões ATIVAS pesam: filtro que ninguém pediu não pode segurar a
 * lista.
 *
 * O recorte por mobile não é detalhe de layout, é o conjunto de predicados que
 * roda: `ConversationList` só chama `applyInboxFilters` no desktop; no mobile
 * ela filtra à mão e avalia **apenas o vendedor** (header próprio), e
 * `ChatShellWithContext` nem empurra `serverFilter` lá. Então funil, etapa,
 * qualificação, etiqueta e "pediu atendente" são irrelevantes no mobile — e o
 * vendedor pesa nos dois.
 *
 * Toda dimensão que `applyInboxFilters` avalia a partir de dado enriquecido
 * PRECISA estar aqui. A primeira versão cobria só `meta` e `vendor`, e as duas
 * que faltavam (etiqueta e "pediu atendente") reencenavam o incidente inteiro
 * por outra porta: enriquecimento vazio → predicado reprova a página → o gate
 * dizia "ok" → "Total: 0" apresentado como resposta. `inboxEnrichment.test.ts`
 * trava essa correspondência.
 */
export function inboxFilterGate(
  filter: InboxFilterState,
  status: InboxEnrichmentStatus,
  opts: { isMobile: boolean },
): InboxFilterGate {
  const desktopOnly = !opts.isMobile;

  const relevant: EnrichmentStatus[] = [];
  if (desktopOnly && (filter.funnels.length > 0 || filter.stages.length > 0 || filter.tiers.length > 0))
    relevant.push(status.meta);
  if (filter.vendor !== "all") relevant.push(status.vendor);
  if (desktopOnly && filter.tags.length > 0) relevant.push(status.tags);
  if (desktopOnly && filter.needsHuman) relevant.push(status.waitingHuman);

  if (relevant.includes("error")) return "error";
  if (relevant.includes("pending")) return "pending";
  return "ok";
}
