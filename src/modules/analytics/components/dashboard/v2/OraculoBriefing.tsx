import { memo } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { useNextBestActions, useDismissAction } from "@/modules/engagement";
import { Skeleton } from "@/components/ui/skeleton";

const PRIORITY_STYLE = (priority: number) => {
  if (priority >= 8) return { tag: "P0", cls: "text-destructive bg-destructive/10" };
  if (priority >= 5) return { tag: "P1", cls: "text-primary bg-primary/15" };
  return { tag: "P2", cls: "text-chart-5 bg-chart-5/10" };
};

/**
 * Briefing do Oráculo — fila priorizada de next-best actions (P0/P1/P2) com
 * motivo e CTA. Substitui o NextBestActionsPanel genérico na Inteligência.
 */
function OraculoBriefingBase() {
  const { data: actions, isLoading } = useNextBestActions(5);
  const dismiss = useDismissAction();
  const navigate = useNavigate();

  if (isLoading) {
    return <Skeleton className="h-[300px] rounded-2xl" />;
  }

  const list = actions ?? [];

  return (
    <div className="cmd-cell cmd-rise p-5" style={{ animationDelay: ".1s" }}>
      <div className="flex items-center justify-between">
        <span className="cmd-lbl">Briefing do Oráculo — próximas jogadas</span>
        {list.length > 0 && (
          <span className="rounded-full bg-primary/15 px-[9px] py-[3px] text-[10.5px] font-extrabold text-primary tabular-nums">
            {list.length} aç{list.length === 1 ? "ão" : "ões"} na fila
          </span>
        )}
      </div>
      <div className="mt-3.5 flex flex-col gap-[9px]">
        {list.length === 0 && (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            Fila limpa — nenhuma ação prioritária agora.
          </p>
        )}
        {list.map((action, i) => {
          const p = PRIORITY_STYLE(action.priority);
          return (
            <div
              key={action.id}
              className="cmd-slidein group grid grid-cols-[26px_1fr_auto] items-center gap-3 rounded-[11px] border border-border/70 bg-card px-[13px] py-[11px]"
              style={{ animationDelay: `${0.3 + i * 0.12}s` }}
            >
              <span className={`cmd-mono flex h-[26px] w-[26px] items-center justify-center rounded-md text-[10px] font-extrabold ${p.cls}`}>
                {p.tag}
              </span>
              <p className="text-[12.5px] leading-[1.45] text-muted-foreground">
                <b className="font-bold text-foreground">{action.title}</b>
                {action.reason ? <> — {action.reason}</> : null}
                {action.lead_name && (
                  <span className="mt-[2px] block text-[10.5px] font-semibold text-muted-foreground/60">
                    Lead: {action.lead_name}
                  </span>
                )}
              </p>
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => action.lead_id && navigate(`/leads?leadId=${action.lead_id}`)}
                  className="whitespace-nowrap text-[11.5px] font-bold text-primary"
                >
                  Abrir →
                </button>
                <button
                  type="button"
                  aria-label="Dispensar"
                  onClick={() => dismiss.mutate(action.id)}
                  className="text-muted-foreground/40 opacity-0 transition-opacity hover:text-muted-foreground group-hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const OraculoBriefing = memo(OraculoBriefingBase);
