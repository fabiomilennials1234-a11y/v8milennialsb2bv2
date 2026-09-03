import type { LeadDeal } from "../hooks/useLeadsDeals";

/**
 * Rota do board onde o negócio aparece como card.
 *
 * SCRUM-637 (flip): TODO funil navega pela rota única `/funil/:slug` — as
 * rotas `/pipe-*` viraram redirects. Devolve `null` quando não há board
 * navegável (Carteira/upsell é tabela legada própria, não funil de negócio) —
 * quem chama esconde o link em vez de renderizar uma rota morta.
 */

export function dealBoardPath(
  deal: Pick<LeadDeal, "isSystem" | "pipelineSlug">,
): string | null {
  if (deal.isSystem && deal.pipelineSlug === "upsell") return null;
  return deal.pipelineSlug ? `/funil/${deal.pipelineSlug}` : null;
}
