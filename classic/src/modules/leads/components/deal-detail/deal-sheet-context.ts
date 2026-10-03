import { createContext, useContext } from "react";
import type { DealCardAba } from "../deal-card/types";

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
  /**
   * Aba pedida para a PRÓXIMA abertura. `null` = o card escolhe (a primeira).
   *
   * Existe porque há gestos que já dizem o assunto: "Checklists" no menu do
   * card não pede o negócio, pede os checklists DELE. Abrir na primeira aba e
   * deixar a pessoa procurar é o que fazia o item parecer quebrado.
   */
  aba: DealCardAba | null;
  openDeal: (entryId: string, leadId: string | null | undefined) => void;
  /**
   * Pede a aba do painel. Chamada DEPOIS de `openDeal` (que zera o pedido),
   * no mesmo handler — as duas atualizações são aplicadas em ordem.
   */
  pedirAba: (aba: DealCardAba) => void;
  close: () => void;
}

export const DealSheetContext = createContext<DealSheetState | null>(null);

export function useDealSheet(): DealSheetState {
  const ctx = useContext(DealSheetContext);
  if (!ctx) throw new Error("useDealSheet must be used within DealPanelProvider");
  return ctx;
}

/**
 * O mesmo contexto, sem exigir o provider.
 *
 * O `LeadCard` é montado em superfícies que têm o painel de negócio (os quatro
 * funis) e em superfícies que não têm. Ele precisa PEDIR uma aba quando dá, e
 * seguir sem ela quando não dá — `useDealSheet` lança nesse segundo caso, o que
 * derrubaria o card inteiro por causa de um item de menu.
 */
export function useDealSheetOpcional(): DealSheetState | null {
  return useContext(DealSheetContext);
}
