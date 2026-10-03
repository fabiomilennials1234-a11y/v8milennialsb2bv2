import { memo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { useNextBestActions, useDismissAction } from "@/modules/engagement";
import { useOrgFeaturesOptional } from "@/contexts/OrgFeaturesContext";
import { Skeleton } from "@/components/ui/skeleton";
import { recordOraculoSignal } from "@/modules/copilot";
import { useOrganization } from "@/modules/identity";

const PRIORITY_STYLE = (priority: number) => {
  if (priority >= 8) return { tag: "P0", cls: "text-destructive bg-destructive/10" };
  if (priority >= 5) return { tag: "P1", cls: "text-primary-soft-foreground bg-primary-soft" };
  return { tag: "P2", cls: "text-insights bg-insights/10" };
};

interface OraculoBriefingProps {
  /** Abre o chat do Oráculo (⌘J). Quando presente, mostra o input no rodapé. */
  onAsk?: () => void;
}

/**
 * Briefing do Oráculo — fila priorizada de next-best actions (P0/P1/P2) com
 * motivo e CTA, mais o atalho pra conversar com o Oráculo.
 */
function OraculoBriefingBase({ onAsk }: OraculoBriefingProps) {
  const { data: actions, isLoading } = useNextBestActions(5);
  const dismiss = useDismissAction();
  const navigate = useNavigate();
  const orgFeatures = useOrgFeaturesOptional();
  const { organizationId } = useOrganization();
  const openingRecorded = useRef(false);

  useEffect(() => {
    if (isLoading || !organizationId || openingRecorded.current) return;
    if (orgFeatures && !orgFeatures.hasFeature("oraculo")) return;
    openingRecorded.current = true;
    void recordOraculoSignal({
      organizationId,
      event: "briefing_opened",
    }).catch(() => undefined);
  }, [isLoading, orgFeatures, organizationId]);

  // Plan gate — Oráculo é exclusivo do plano Torque Copilot.
  if (orgFeatures && !orgFeatures.hasFeature("oraculo")) return null;

  if (isLoading) {
    return <Skeleton className="h-full min-h-[200px] rounded-2xl" />;
  }

  const list = actions ?? [];

  return (
    // Corpo da janela "Oráculo" — o título mora na moldura.
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">Próximas jogadas</span>
        {list.length > 0 && (
          <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-[11px] font-bold tabular-nums text-primary-soft-foreground">
            {list.length} aç{list.length === 1 ? "ão" : "ões"} na fila
          </span>
        )}
      </div>
      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {list.length === 0 && (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            Fila limpa — nenhuma ação prioritária agora.
          </p>
        )}
        {list.map((action, i) => {
          const p = PRIORITY_STYLE(action.priority);
          // Rows derivadas on-the-fly pela RPC não existem na tabela — dispensar não se aplica
          const isDerived = action.metadata?.derived === true;
          return (
            <div
              key={action.id}
              className="cmd-slidein group grid grid-cols-[28px_1fr_auto] items-center gap-3 rounded-2xl bg-sunken px-3 py-2.5"
              style={{ animationDelay: `${0.3 + i * 0.12}s` }}
            >
              <span className={`grid h-7 w-7 place-items-center rounded-[9px] text-[10.5px] font-extrabold tabular-nums ${p.cls}`}>
                {p.tag}
              </span>
              <p className="text-[12.5px] leading-[1.45] text-muted-foreground">
                <b className="font-bold text-foreground">{action.title}</b>
                {action.reason ? <> — {action.reason}</> : null}
                {action.lead_name && (
                  <span className="mt-[2px] block text-[11px] font-semibold text-muted-foreground">
                    Lead: {action.lead_name}
                  </span>
                )}
              </p>
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => action.lead_id && navigate(`/leads?leadId=${action.lead_id}`)}
                  className="whitespace-nowrap rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-semibold transition-colors hover:border-foreground/25"
                >
                  Abrir →
                </button>
                {!isDerived && (
                  <button
                    type="button"
                    aria-label="Dispensar"
                    onClick={() => dismiss.mutate(action.id)}
                    className="grid h-6 w-6 place-items-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {onAsk && (
        <button
          type="button"
          onClick={onAsk}
          className="mt-3 flex w-full cursor-text items-center gap-2 rounded-full border border-input bg-card px-3.5 py-2 text-left transition-[border-color,box-shadow] hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="text-[13px] text-muted-foreground">Perguntar ao Oráculo…</span>
          <kbd className="ml-auto rounded-md bg-muted px-1.5 py-0.5 font-sans text-[10px] font-bold text-muted-foreground">⌘ J</kbd>
        </button>
      )}
    </div>
  );
}

export const OraculoBriefing = memo(OraculoBriefingBase);
