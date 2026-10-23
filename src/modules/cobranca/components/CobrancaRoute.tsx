import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useFeatureFlag } from "@/modules/platform";

import { FLAG_COBRANCA } from "../hooks/useCobrancaAcesso";

/**
 * Guarda das rotas `/cobranca/*` pela flag da org.
 *
 * Não é o `FeatureRoute` (tela de upgrade): a área é piloto interno, org sem a
 * flag nem sabe que ela existe — volta para o Comando. A permissão
 * (`cobranca.view`) é o `PermissionProtectedRoute` por dentro, no App.tsx.
 */
export function CobrancaRoute({ children }: { children: ReactNode }) {
  const { enabled, isLoading } = useFeatureFlag(FLAG_COBRANCA);
  if (isLoading) {
    return (
      <div className="grid h-[50vh] place-items-center text-muted-foreground" role="status" aria-label="Carregando">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (!enabled) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
