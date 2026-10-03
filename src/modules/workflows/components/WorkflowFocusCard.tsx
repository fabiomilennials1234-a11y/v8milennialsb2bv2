/**
 * WorkflowFocusCard — "Workflow em foco", o cartão de ouro da lista de
 * Automações.
 *
 * Mostra o que já existe sobre o workflow selecionado na lista em tinta:
 * nome, ativação (o MESMO `useToggleWorkflow` da lista antiga, com o mesmo
 * gate de nó incompleto no servidor do hook), o gatilho e a cadeia de nós em
 * pílulas, e as execuções desde a criação (`useWorkflowStats`). Exportar e
 * Excluir ficam no ⋯ com as permissões de hoje.
 */
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowRight, ChevronRight, Download, History, MoreHorizontal, Trash2, Zap } from "lucide-react";
import { FocusCard, FocusTile } from "@/components/ui/bento";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkflowStats } from "@/modules/workflows/hooks/useWorkflows";
import { DiscontinuedBadge } from "@/modules/workflows/components/DiscontinuedNotice";
import { NODE_LABELS, TRIGGER_LABELS } from "@/types/workflow";
import type { Workflow, WorkflowNodeType } from "@/types/workflow";
import { cn } from "@/lib/utils";

const CHAIN_LIMIT = 6;

/**
 * A cadeia em ordem de leitura: começa no gatilho e segue as arestas em
 * largura (o primeiro caminho de cada bifurcação vem antes). Nós soltos, sem
 * aresta, entram no fim — nada some da contagem.
 */
function workflowChain(workflow: Workflow): string[] {
  const nodes = workflow.definition?.nodes ?? [];
  const edges = workflow.definition?.edges ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.source, [...(out.get(e.source) ?? []), e.target]);

  const start = nodes.find((n) => n.type === "trigger") ?? nodes[0];
  const seen = new Set<string>();
  const order: string[] = [];
  const queue = start ? [start.id] : [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    order.push(id);
    queue.push(...(out.get(id) ?? []));
  }
  for (const n of nodes) if (!seen.has(n.id)) order.push(n.id);

  return order.map((id) => {
    const n = byId.get(id)!;
    const data = (n.data ?? {}) as { label?: unknown; type?: WorkflowNodeType };
    const label = typeof data.label === "string" && data.label.trim() ? data.label.trim() : null;
    return label ?? NODE_LABELS[(n.type ?? data.type) as WorkflowNodeType] ?? "Passo";
  });
}

interface WorkflowFocusCardProps {
  workflow: Workflow;
  triggerIcon: React.ElementType;
  discontinued: boolean;
  canDelete: boolean;
  togglePending: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onExecutions: () => void;
  onExport: () => void;
  onDelete: () => void;
}

const onGoldButton =
  "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-bold transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground [&_svg]:h-3.5 [&_svg]:w-3.5";

export function WorkflowFocusCard({
  workflow,
  triggerIcon: TriggerIcon,
  discontinued,
  canDelete,
  togglePending,
  onToggle,
  onOpen,
  onExecutions,
  onExport,
  onDelete,
}: WorkflowFocusCardProps) {
  const { data: stats, isLoading: statsLoading } = useWorkflowStats(workflow.id);
  const chain = workflowChain(workflow);
  const shown = chain.slice(0, CHAIN_LIMIT);
  const rest = chain.length - shown.length;
  const created = formatDistanceToNow(new Date(workflow.created_at), { addSuffix: true, locale: ptBR });
  const lastRun = stats?.lastRun?.started_at
    ? formatDistanceToNow(new Date(stats.lastRun.started_at), { addSuffix: true, locale: ptBR })
    : null;

  return (
    <FocusCard className="gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-primary-foreground/70">Workflow em foco · criado {created}</p>
          <h3 className="mt-1 line-clamp-2 text-[1.55rem] font-extrabold leading-[1.12] tracking-[-0.03em] max-sm:text-[1.3rem]">
            {workflow.name}
          </h3>
          {workflow.description && (
            <p className="mt-1 line-clamp-2 text-[13px] text-primary-foreground/75">{workflow.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex h-9 items-center gap-2.5 rounded-full border border-primary-foreground/15 bg-primary-foreground/[.07] pl-3.5 pr-1.5 text-[13px] font-bold">
            {workflow.is_active ? "Ativo" : "Inativo"}
            <Switch
              checked={workflow.is_active}
              disabled={togglePending}
              onCheckedChange={onToggle}
              aria-label={workflow.is_active ? `Desativar ${workflow.name}` : `Ativar ${workflow.name}`}
              className="data-[state=checked]:bg-primary-foreground data-[state=unchecked]:bg-primary-foreground/20"
            />
          </label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Mais ações de ${workflow.name}`}
                className="grid h-9 w-9 place-items-center rounded-full border border-primary-foreground/15 bg-primary-foreground/[.07] transition-colors hover:bg-primary-foreground/[.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onExport} aria-label={`Exportar ${workflow.name}`}>
                <Download />
                Exportar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={onDelete}
                disabled={!canDelete}
                aria-label={`Excluir ${workflow.name}`}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 />
                Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Gatilho + cadeia de nós */}
      <FocusTile className="p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-primary-foreground text-primary">
            <TriggerIcon className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold text-primary-foreground/65">Gatilho</p>
            <p className="truncate text-[14px] font-bold">{TRIGGER_LABELS[workflow.trigger_type] ?? workflow.trigger_type}</p>
          </div>
          {discontinued && <DiscontinuedBadge className="bg-primary-foreground text-warning" />}
          <span className="shrink-0 text-[12px] font-bold tabular-nums text-primary-foreground/70">
            {chain.length} {chain.length === 1 ? "nó" : "nós"}
          </span>
        </div>
        {shown.length > 0 && (
          <ol className="mt-3.5 flex flex-wrap items-center gap-1.5" aria-label="Passos do workflow">
            {shown.map((label, i) => (
              <li key={`${label}-${i}`} className="flex items-center gap-1.5">
                <span className="inline-flex max-w-[200px] items-center gap-1.5 rounded-full border border-primary-foreground/15 bg-primary-foreground/[.07] px-2.5 py-1 text-[11.5px] font-bold">
                  {i === 0 && <Zap className="h-3 w-3 shrink-0" aria-hidden />}
                  <span className="truncate">{label}</span>
                </span>
                {(i < shown.length - 1 || rest > 0) && (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-primary-foreground/45" aria-hidden />
                )}
              </li>
            ))}
            {rest > 0 && (
              <li className="rounded-full bg-primary-foreground/[.12] px-2 py-1 text-[11px] font-extrabold tabular-nums">+{rest}</li>
            )}
          </ol>
        )}
      </FocusTile>

      <div className="grid grid-cols-2 gap-2">
        <FocusTile>
          <p className="text-[11px] font-bold text-primary-foreground/65">Execuções · desde a criação</p>
          <p className={cn("mt-1 text-[1.6rem] font-extrabold leading-none tracking-[-0.03em] tabular-nums", statsLoading && "animate-pulse opacity-50")}>
            {statsLoading ? "—" : (stats?.total ?? 0).toLocaleString("pt-BR")}
          </p>
        </FocusTile>
        <FocusTile>
          <p className="text-[11px] font-bold text-primary-foreground/65">Última execução</p>
          <p className="mt-1 truncate text-[1.05rem] font-extrabold leading-tight tracking-[-0.02em]">
            {statsLoading ? "—" : lastRun ?? "Nunca rodou"}
          </p>
          {stats?.lastRun?.status && (
            <p className="mt-1 text-[11px] text-primary-foreground/65">status: {stats.lastRun.status}</p>
          )}
        </FocusTile>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onExecutions}
          className={cn(onGoldButton, "border border-primary-foreground/15 bg-primary-foreground/[.07] hover:bg-primary-foreground/[.12]")}
        >
          <History />
          Ver execuções
        </button>
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Editar ${workflow.name}`}
          className={cn(onGoldButton, "ml-auto bg-tinta-foreground text-primary-foreground shadow-relevo hover:bg-tinta-foreground/90")}
        >
          Abrir no editor
          <ArrowRight />
        </button>
      </div>
    </FocusCard>
  );
}
