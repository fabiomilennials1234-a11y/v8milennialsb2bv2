import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { track } from "@/lib/analytics";
import { useOrganization } from "@/modules/identity";
interface GhostLeadsBannerProps {
  pipeType: "whatsapp" | "confirmacao" | "propostas";
  ghostCount: number;
}

/**
 * Aviso visível para o usuário quando o pipe contém rows cujo join com
 * `leads` é nulo por RLS divergente (o pipe é visível mas o lead não).
 *
 * Antes: rows sem lead eram descartadas silenciosamente — o funil
 * simplesmente aparecia vazio/incompleto, sem indício de que havia um
 * problema de consistência (incidente 2026-04-23 funis bloqueados).
 *
 * Agora: (1) banner explícito ao usuário, (2) telemetria em `usage_events`
 * para rastrear em qual org + quantos cards ocorre em produção.
 */
export function GhostLeadsBanner({ pipeType, ghostCount }: GhostLeadsBannerProps) {
  const { organizationId } = useOrganization();
  const lastTrackedRef = useRef<{ orgId: string | null; count: number } | null>(null);

  useEffect(() => {
    if (!organizationId || ghostCount <= 0) return;

    const last = lastTrackedRef.current;
    if (last && last.orgId === organizationId && last.count === ghostCount) return;
    lastTrackedRef.current = { orgId: organizationId, count: ghostCount };

    track({
      event: "pipe.ghost_leads_detected",
      organizationId,
      entityType: "pipe",
      metadata: { pipe_type: pipeType, ghost_count: ghostCount },
    });
  }, [organizationId, pipeType, ghostCount]);

  if (ghostCount <= 0) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      <div className="space-y-1">
        <p className="font-medium text-foreground">
          {ghostCount === 1
            ? "1 card está com inconsistência de permissão"
            : `${ghostCount} cards estão com inconsistência de permissão`}
        </p>
        <p className="text-muted-foreground">
          O funil contém registros cujos leads não são visíveis para você.
          Provável divergência entre responsável do lead e do pipe. Peça ao
          administrador para revisar ou entre em contato com o suporte.
        </p>
      </div>
    </div>
  );
}
