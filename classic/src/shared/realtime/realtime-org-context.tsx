import { createContext, useContext, type ReactNode } from "react";

/**
 * Org-id corrente para scoping de subscriptions realtime.
 * Owned por shared/realtime, ALIMENTADO por identity no root do app (App.tsx).
 * Inverte o edge shared→module: o transport realtime não importa @/modules/identity.
 * Quebra o ciclo que gerava 27 no-circular no dep-cruise (slice 9.1b arch-deepening).
 */
const RealtimeOrgContext = createContext<string | null>(null);

export function RealtimeOrgProvider({
  organizationId,
  children,
}: {
  organizationId: string | null;
  children: ReactNode;
}) {
  return (
    <RealtimeOrgContext.Provider value={organizationId}>
      {children}
    </RealtimeOrgContext.Provider>
  );
}

/** Org-id corrente (null até a org carregar). Reativo a org switch via contexto. */
export function useRealtimeOrgId(): string | null {
  return useContext(RealtimeOrgContext);
}
