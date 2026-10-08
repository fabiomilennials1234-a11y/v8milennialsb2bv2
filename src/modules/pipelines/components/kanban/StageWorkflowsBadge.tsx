import { useNavigate } from "react-router-dom";
import { Zap, ExternalLink, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface StageWorkflowItem {
  id: string;
  name: string;
  is_active: boolean;
}

interface StageWorkflowsBadgeProps {
  /** Total de workflows vinculados a essa etapa */
  total: number;
  /** Quantidade de workflows ativos */
  active: number;
  /** Lista de workflows (lazy loaded quando popover abre) */
  workflows?: StageWorkflowItem[];
  /** Chamado quando o popover é aberto para carregar workflows */
  onOpen?: () => void;
  /** Pipe type para pré-configurar ao criar novo workflow */
  pipeType?: string;
  /** Pipeline ID para custom pipes */
  pipelineId?: string;
  /** Stage key para pré-configurar ao criar novo workflow */
  stageKey: string;
  /** Stage name for display */
  stageName: string;
}

export function StageWorkflowsBadge({
  total,
  active,
  workflows,
  pipeType,
  pipelineId,
  stageKey,
  stageName,
}: StageWorkflowsBadgeProps) {
  const navigate = useNavigate();

  const handleCreateWorkflow = () => {
    // Navigate to new workflow with pre-configured trigger
    const params = new URLSearchParams();
    params.set("trigger", "stage_changed");
    if (pipeType) params.set("pipe_type", pipeType);
    if (pipelineId) params.set("pipeline_id", pipelineId);
    params.set("stage", stageKey);
    params.set("stage_name", stageName);
    navigate(`/automacoes/novo?${params.toString()}`);
  };

  const hasWorkflows = total > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            hasWorkflows
              ? active > 0
                ? "bg-insights/10 text-insights hover:bg-insights/15"
                : "bg-muted text-muted-foreground hover:text-foreground"
              : "text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground"
          )}
          title={hasWorkflows ? `${total} automação(ões)` : "Criar automação"}
          aria-label={hasWorkflows ? `${total} automação(ões) na etapa ${stageName}` : `Criar automação na etapa ${stageName}`}
        >
          <Zap className="h-3 w-3" aria-hidden />
          {hasWorkflows && <span>{total}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 overflow-hidden p-0" sideOffset={8}>
        <div className="border-b px-3.5 py-3">
          <p className="text-sm font-bold tracking-tight">
            Automações — {stageName}
          </p>
          <p className="text-xs text-muted-foreground">
            {total === 0
              ? "Nenhuma automação vinculada"
              : `${total} automação(ões), ${active} ativa(s)`}
          </p>
        </div>

        {workflows && workflows.length > 0 && (
          <div className="max-h-48 overflow-y-auto p-1">
            {workflows.map((w) => (
              <button
                key={w.id}
                className="flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                onClick={() => navigate(`/automacoes/${w.id}`)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full flex-shrink-0",
                      w.is_active ? "bg-success" : "bg-muted-foreground/50"
                    )}
                  />
                  <span className="truncate">{w.name}</span>
                </div>
                <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              </button>
            ))}
          </div>
        )}

        <div className="p-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-xs"
            onClick={handleCreateWorkflow}
          >
            <Plus className="w-3.5 h-3.5" />
            Criar automação para esta etapa
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
