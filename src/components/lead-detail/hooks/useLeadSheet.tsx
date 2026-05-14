import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type DrawerVariant =
  | "whatsapp"
  | "confirmacao"
  | "propostas"
  | "followup"
  | "custom"
  | "upsell_client"
  | "upsell_campanha"
  | "leads";

interface LeadSheetState {
  isOpen: boolean;
  leadId: string | null;
  variant: DrawerVariant;
  pipeData: any;
  openLead: (leadId: string, variant: DrawerVariant, pipeData?: any) => void;
  close: () => void;
}

const LeadSheetContext = createContext<LeadSheetState | null>(null);

export function LeadPanelProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    isOpen: boolean;
    leadId: string | null;
    variant: DrawerVariant;
    pipeData: any;
  }>({
    isOpen: false,
    leadId: null,
    variant: "leads",
    pipeData: null,
  });

  const openLead = useCallback((leadId: string, variant: DrawerVariant, pipeData?: any) => {
    setState({ isOpen: true, leadId, variant, pipeData: pipeData ?? null });
  }, []);

  const close = useCallback(() => {
    setState({ isOpen: false, leadId: null, variant: "leads", pipeData: null });
  }, []);

  return (
    <LeadSheetContext.Provider value={{ ...state, openLead, close }}>
      {children}
    </LeadSheetContext.Provider>
  );
}

export function useLeadSheet(): LeadSheetState {
  const ctx = useContext(LeadSheetContext);
  if (!ctx) throw new Error("useLeadSheet must be used within LeadPanelProvider");
  return ctx;
}
