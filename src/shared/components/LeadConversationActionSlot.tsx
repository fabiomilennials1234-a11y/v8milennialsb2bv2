import { createContext, useContext, type ReactNode } from "react";

/** A raiz fornece a ação de communication sem criar um ciclo com leads. */
export type LeadConversationActionRenderer = (lead: {
  id: string;
  telefone: string | null;
}) => ReactNode;

const LeadConversationActionContext = createContext<LeadConversationActionRenderer | null>(null);
export const LeadConversationActionProvider = LeadConversationActionContext.Provider;
// Provider e hook compartilham o mesmo contexto neutro, como LeadCallActionSlot.
// eslint-disable-next-line react-refresh/only-export-components
export function useLeadConversationAction(): LeadConversationActionRenderer | null {
  return useContext(LeadConversationActionContext);
}
