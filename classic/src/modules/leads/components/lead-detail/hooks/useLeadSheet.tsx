import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

/**
 * Lead-centric modal context.
 *
 * The old `DrawerVariant` + `pipeData` payload was eliminated in PRD #284
 * (issue #300). Callers no longer indicate a pipe variant; instead they pass
 * an optional `defaultExpandedPipeEntryId` so the modal opens with that
 * pipe section already expanded inside the cross-pipe accordion.
 *
 * Call from a kanban card → pass the entry id you clicked on.
 * Call from a list/page without pipe origin → call with one arg.
 */
interface LeadSheetState {
  isOpen: boolean;
  leadId: string | null;
  defaultExpandedPipeEntryId: string | null;
  openLead: (leadId: string, defaultExpandedPipeEntryId?: string | null) => void;
  close: () => void;
}

const LeadSheetContext = createContext<LeadSheetState | null>(null);

export function LeadPanelProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    isOpen: boolean;
    leadId: string | null;
    defaultExpandedPipeEntryId: string | null;
  }>({
    isOpen: false,
    leadId: null,
    defaultExpandedPipeEntryId: null,
  });

  const openLead = useCallback(
    (leadId: string, defaultExpandedPipeEntryId?: string | null) => {
      setState({
        isOpen: true,
        leadId,
        defaultExpandedPipeEntryId: defaultExpandedPipeEntryId ?? null,
      });
    },
    [],
  );

  const close = useCallback(() => {
    setState({ isOpen: false, leadId: null, defaultExpandedPipeEntryId: null });
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
