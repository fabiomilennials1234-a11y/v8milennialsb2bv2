import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { track } from "@/lib/analytics";
import { useOrganization } from "@/modules/identity";
interface GhostLeadsBannerProps {
  pipeType: "whatsapp" | "confirmacao" | "propostas" | "custom";
  ghostCount: number;
}

/**
 * Aviso visível para o usuário quando o funil contém entries cujo join com
 * `leads` é nulo — o registro do funil é visível mas o lead não.
 *
 * Antes: rows sem lead eram descartadas silenciosamente — o funil
 * simplesmente aparecia vazio/incompleto, sem indício de que havia um
 * problema de consistência (incidente 2026-04-23 funis bloqueados).
 *
 * Agora: (1) banner explícito ao usuário, (2) telemetria em `usage_events`
 * para rastrear em qual org + quantos cards ocorre em produção.
 *
 * ⚠️ Nos funis do SISTEMA este banner está inerte desde que as RPCs paginadas
 * entraram: `get_pipeline_page` devolve `lead` via INNER JOIN, então
 * `item.lead == null` virou impossível e o evento `pipe.ghost_leads_detected`
 * não é emitido desde 2026-05-13. O consumidor vivo é o funil personalizado
 * (`pipeType="custom"`), onde a entry é visível por org e o lead por
 * responsabilidade — ver `CustomPipeline.tsx`.
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
            ? "1 lead deste funil não aparece para você"
            : `${ghostCount} leads deste funil não aparecem para você`}
        </p>
        {/* O texto anterior dizia "inconsistência de permissão" e mandava pedir
            ao administrador para revisar. Na prática o caso dominante NÃO é
            inconsistência: é a organização tendo configurado que cada pessoa vê
            só a própria carteira. Aquele texto empurrava o admin a religar
            `leads.view_all` — ou seja, a desfazer a própria decisão. */}
        <p className="text-muted-foreground">
          São leads que não estão atribuídos a você. Sua organização configurou
          o acesso para que cada pessoa veja apenas a própria carteira — não é
          um erro. Se precisar de algum deles, fale com um administrador.
        </p>
      </div>
    </div>
  );
}
