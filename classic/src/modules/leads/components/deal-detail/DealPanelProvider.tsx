import { useState, useCallback, type ReactNode } from "react";
import { DealSheetContext } from "./deal-sheet-context";
import type { DealCardAba } from "../deal-card/types";

/** Provider do modal de negócio. Contrato e hook em `deal-sheet-context`. */
export function DealPanelProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    isOpen: boolean;
    entryId: string | null;
    leadId: string | null;
    aba: DealCardAba | null;
  }>({ isOpen: false, entryId: null, leadId: null, aba: null });

  /**
   * Abrir SEMPRE zera a aba pedida: sem isto, um "Checklists" de meia hora
   * atrás faria o próximo negócio aberto no clique normal cair na aba errada.
   */
  const openDeal = useCallback((entryId: string, leadId: string | null | undefined) => {
    setState({ isOpen: true, entryId, leadId: leadId ?? null, aba: null });
  }, []);

  const pedirAba = useCallback((aba: DealCardAba) => {
    setState((s) => ({ ...s, aba }));
  }, []);

  const close = useCallback(() => {
    setState({ isOpen: false, entryId: null, leadId: null, aba: null });
  }, []);

  return (
    <DealSheetContext.Provider value={{ ...state, openDeal, pedirAba, close }}>
      {children}
    </DealSheetContext.Provider>
  );
}
