import { createContext, useContext } from "react";
import type { SupportPrefill } from "@/shared/errors";

/**
 * O painel tem três telas, e a tela é derivada do estado — não um enum à parte
 * que possa discordar dele. `ticketId` nulo com `composing` falso é a lista.
 */
export interface SupportPanelContextType {
  isOpen: boolean;
  /** Chamado aberto no thread, se algum. */
  ticketId: string | null;
  /** Formulário de abertura visível. */
  composing: boolean;
  /** Rascunho com que o formulário abre, quando o Chamado nasce de um erro. */
  prefill: SupportPrefill | null;

  /** Abre o painel na lista. */
  open: () => void;
  /** Abre o painel direto no formulário — é o que o Cmd+K faz. */
  openNewTicket: () => void;
  /**
   * Abre o formulário já preenchido. Método à parte, e não um argumento opcional
   * de `openNewTicket`, porque este é passado direto como `onClick` e receberia
   * o evento do mouse como rascunho.
   */
  openNewTicketWith: (prefill: SupportPrefill) => void;
  /** Abre o thread de um chamado. */
  openTicket: (ticketId: string) => void;
  /** Volta para a lista sem fechar o painel. */
  backToList: () => void;
  close: () => void;
}

export const SupportPanelContext = createContext<SupportPanelContextType | null>(null);

export function useSupportPanel(): SupportPanelContextType {
  const ctx = useContext(SupportPanelContext);
  if (!ctx) {
    throw new Error("useSupportPanel precisa estar dentro de <SupportPanelProvider>");
  }
  return ctx;
}
