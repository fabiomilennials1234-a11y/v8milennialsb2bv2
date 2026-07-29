import type { LeadDeal } from "../hooks/useLeadsDeals";

/**
 * Rota do board onde o negócio aparece como card.
 *
 * Espelha `App.tsx`: funis system têm rota fixa (`/pipe-*`), custom entram por
 * slug em `/pipe/custom/:slug`. Devolve `null` quando não há board navegável
 * (ex.: Carteira, que é tabela legada própria) — quem chama esconde o link em
 * vez de renderizar uma rota morta.
 */

const SYSTEM_ROUTES: Record<string, string> = {
  whatsapp: "/pipe-whatsapp",
  confirmacao: "/pipe-confirmacao",
  propostas: "/pipe-propostas",
};

export function dealBoardPath(
  deal: Pick<LeadDeal, "isSystem" | "pipelineSlug">,
): string | null {
  if (deal.isSystem) return SYSTEM_ROUTES[deal.pipelineSlug] ?? null;
  return deal.pipelineSlug ? `/pipe/custom/${deal.pipelineSlug}` : null;
}
