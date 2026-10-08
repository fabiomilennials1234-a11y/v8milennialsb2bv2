/**
 * O inspetor do editor sem passo selecionado: o resumo do workflow (gatilho,
 * passos, execuções desde a criação, última execução) e o convite para
 * selecionar um passo. Os números vêm de `useWorkflowStats` — os mesmos da
 * lista; workflow novo ainda não tem nenhum.
 */
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MousePointerClick, Zap } from "lucide-react";
import { IconChip } from "@/components/ui/bento";
import { useWorkflowStats } from "@/modules/workflows/hooks/useWorkflows";
import { TRIGGER_LABELS, type WorkflowTriggerType } from "@/types/workflow";

export function WorkflowInspectorEmpty({
  workflowId,
  triggerType,
  nodeCount,
  edgeCount,
}: {
  workflowId?: string;
  triggerType?: WorkflowTriggerType;
  nodeCount: number;
  edgeCount: number;
}) {
  const { data: stats } = useWorkflowStats(workflowId);
  const lastRun = stats?.lastRun?.started_at
    ? formatDistanceToNow(new Date(stats.lastRun.started_at), { addSuffix: true, locale: ptBR })
    : null;

  const rows: [string, string][] = [
    ["Gatilho", triggerType ? TRIGGER_LABELS[triggerType] ?? triggerType : "—"],
    ["Passos", `${nodeCount} ${nodeCount === 1 ? "nó" : "nós"} · ${edgeCount} ${edgeCount === 1 ? "conexão" : "conexões"}`],
    ["Execuções", workflowId ? (stats?.total ?? 0).toLocaleString("pt-BR") : "—"],
    ["Última execução", workflowId ? lastRun ?? "Nunca rodou" : "—"],
  ];

  return (
    <aside
      aria-label="Resumo do workflow"
      className="flex h-full w-[320px] min-w-0 flex-col rounded-card border border-card-border bg-card p-4 shadow-relevo"
    >
      <div className="flex items-center gap-2.5">
        <IconChip icon={Zap} tone="gold" />
        <p className="text-[15px] font-extrabold tracking-[-0.02em]">Resumo</p>
      </div>
      <dl className="mt-4 divide-y divide-border/60 rounded-2xl bg-muted/50">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
            <dt className="text-[12px] text-muted-foreground">{k}</dt>
            <dd className="truncate text-right text-[13px] font-bold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
        <MousePointerClick className="h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="text-[14px] font-bold">Selecione um passo</p>
        <p className="max-w-[230px] text-xs leading-relaxed text-muted-foreground">
          Clique num nó do canvas para configurar. Os blocos à esquerda entram no fluxo com um clique.
        </p>
      </div>
    </aside>
  );
}
