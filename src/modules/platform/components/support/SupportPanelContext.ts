import { createContext, useContext } from "react";

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

  /** Abre o painel na lista. */
  open: () => void;
  /** Abre o painel direto no formulário — é o que o Cmd+K faz. */
  openNewTicket: () => void;
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
