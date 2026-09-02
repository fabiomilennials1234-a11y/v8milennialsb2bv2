import type { LeadDeal } from "../hooks/useLeadsDeals";

/**
 * Rota do board onde o negócio aparece como card.
 *
 * Espelha `App.tsx`: funis system têm rota fixa (`/pipe-*`) até a paridade da
 * página unificada fechar (SCRUM-633/634 → 637); custom já navega pela rota
 * única `/funil/:slug` (SCRUM-632). Devolve `null` quando não há board
 * navegável (ex.: Carteira, que é tabela legada própria) — quem chama esconde
 * o link em vez de renderizar uma rota morta.
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
  return deal.pipelineSlug ? `/funil/${deal.pipelineSlug}` : null;
}
