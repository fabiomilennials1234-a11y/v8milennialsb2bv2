import { Loader2 } from "lucide-react";
import { Navigate } from "react-router-dom";

import { useFeatureFlag } from "@/modules/platform/hooks/useFeatureFlag";
import { IA_CONECTADA_DESTINO, PITSTOP_HUB_PATH } from "@/modules/platform/lib/navigation-model";

/**
 * `/ia-conectada` — atalho do Pitstop › Administração para criar um token de IA.
 *
 * Só redireciona: leva à seção de tokens de Configurações › API & Webhooks com o
 * diálogo "Novo token" aberto. Org sem a flag `crm_mcp` não tem a seção (e o banco
 * recusaria o token), então volta ao Pitstop. A permissão é a da própria tela de
 * Configurações, que o destino já exige.
 */
export function IaConectadaRoute() {
  const { enabled, isLoading } = useFeatureFlag("crm_mcp");
  if (isLoading) {
    return (
      <div className="grid h-[50vh] place-items-center text-muted-foreground" role="status" aria-label="Carregando">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  return <Navigate to={enabled ? IA_CONECTADA_DESTINO : PITSTOP_HUB_PATH} replace />;
}
