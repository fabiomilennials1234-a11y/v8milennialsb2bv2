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
  /**
   * Comentário a destacar quando o card abrir — vem do `?comment=` da
   * notificação de menção.
   *
   * Por que no CONTEXTO e não lido da URL lá embaixo: `LeadCardPanel` é montado
   * em 5 telas e `cards-nunca-empilham.test.tsx:114` o renderiza SEM Router.
   * Um `useSearchParams()` dentro da árvore do card derrubaria esse teste. Quem
   * lê a URL é a página, que já tem o hook; daqui para baixo é dado, não rota.
   */
  comentarioDestacadoId: string | null;
  openLead: (
    leadId: string,
    defaultExpandedPipeEntryId?: string | null,
    comentarioDestacadoId?: string | null,
  ) => void;
  close: () => void;
}

const LeadSheetContext = createContext<LeadSheetState | null>(null);

export function LeadPanelProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    isOpen: boolean;
    leadId: string | null;
    defaultExpandedPipeEntryId: string | null;
    comentarioDestacadoId: string | null;
  }>({
    isOpen: false,
    leadId: null,
    defaultExpandedPipeEntryId: null,
    comentarioDestacadoId: null,
  });

  const openLead = useCallback(
    (
      leadId: string,
      defaultExpandedPipeEntryId?: string | null,
      comentarioDestacadoId?: string | null,
    ) => {
      setState({
        isOpen: true,
        leadId,
        defaultExpandedPipeEntryId: defaultExpandedPipeEntryId ?? null,
        comentarioDestacadoId: comentarioDestacadoId ?? null,
      });
    },
    [],
  );

  const close = useCallback(() => {
    setState({
      isOpen: false,
      leadId: null,
      defaultExpandedPipeEntryId: null,
      comentarioDestacadoId: null,
    });
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
