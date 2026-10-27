import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useFeatureFlag } from "@/modules/platform";

import { FLAG_LISTA_FRIA } from "../hooks/useListaFriaAcesso";

/**
 * Guarda da rota `/leads/lista-fria/:buscaId` pela flag da org.
 *
 * Mesmo desenho da `CobrancaRoute`: a Lista fria é piloto, org sem a flag nem
 * sabe que ela existe — volta para Leads. A permissão (`lista_fria.view`) é o
 * `PermissionProtectedRoute` por dentro, no App.tsx.
 */
export function ListaFriaRoute({ children }: { children: ReactNode }) {
  const { enabled, isLoading } = useFeatureFlag(FLAG_LISTA_FRIA);
  if (isLoading) {
    return (
      <div className="grid h-[50vh] place-items-center text-muted-foreground" role="status" aria-label="Carregando">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (!enabled) return <Navigate to="/leads" replace />;
  return <>{children}</>;
}
