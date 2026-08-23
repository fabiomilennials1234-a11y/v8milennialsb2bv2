import { useState, useCallback, type ReactNode } from "react";
import { DealSheetContext } from "./deal-sheet-context";

/** Provider do modal de negócio. Contrato e hook em `deal-sheet-context`. */
export function DealPanelProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    isOpen: boolean;
    entryId: string | null;
    leadId: string | null;
  }>({ isOpen: false, entryId: null, leadId: null });

  const openDeal = useCallback((entryId: string, leadId: string | null | undefined) => {
    setState({ isOpen: true, entryId, leadId: leadId ?? null });
  }, []);

  const close = useCallback(() => {
    setState({ isOpen: false, entryId: null, leadId: null });
  }, []);

  return (
    <DealSheetContext.Provider value={{ ...state, openDeal, close }}>
      {children}
    </DealSheetContext.Provider>
  );
}
