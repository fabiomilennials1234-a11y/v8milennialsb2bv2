import { createContext, useContext } from "react";

/**
 * Contexto do modal de **negócio** — o que o card do funil abre.
 *
 * Separação decidida pelo CTO (2026-07-29): o modal do lead abre **só na aba
 * Leads**; no funil, o card abre o negócio. Antes os dois eram a mesma tela,
 * porque lead e card eram a mesma coisa — o que deixou de valer no modelo novo
 * (ver `08 — Backlog/em-progresso/lead-negocio-separacao-fluxo-e2e`).
 *
 * O negócio é identificado pela entry (`pipeline_entries.id`, que vira `deal_id`
 * na fatia 2); `leadId` viaja junto porque identidade e conversa continuam sendo
 * do lead — herança por referência (D2) e thread por pessoa (D5).
 *
 * Contexto e hook moram aqui, sem JSX, para o arquivo do provider exportar só o
 * componente (react-refresh).
 */
export interface DealSheetState {
  isOpen: boolean;
  /** `pipeline_entries.id` (system e custom) — o negócio clicado. */
  entryId: string | null;
  leadId: string | null;
  openDeal: (entryId: string, leadId: string | null | undefined) => void;
  close: () => void;
}

export const DealSheetContext = createContext<DealSheetState | null>(null);

export function useDealSheet(): DealSheetState {
  const ctx = useContext(DealSheetContext);
  if (!ctx) throw new Error("useDealSheet must be used within DealPanelProvider");
  return ctx;
}
