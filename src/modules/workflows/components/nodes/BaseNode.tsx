import { useCallback } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import { X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkflowNodeType } from "@/types/workflow";
import { DISCONTINUED_STEP_HINT, NODE_COLORS } from "@/types/workflow";
import { DiscontinuedBadge } from "../DiscontinuedNotice";
import { NODE_HANDLE_CLASS, nodeCardClassName } from "./node-style";

/** Chip do ícone no matiz do tipo. Força o ícone a herdar a cor do chip. */
export function NodeIconChip({ nodeType, children }: { nodeType: WorkflowNodeType; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-xl [&_svg]:h-[18px] [&_svg]:w-[18px] [&_svg]:text-current",
        NODE_COLORS[nodeType].chip,
      )}
    >
      {children}
    </span>
  );
}

/** Botão de excluir que aparece no hover — mesmo alvo em todos os nós. */
export function NodeDeleteButton({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute -right-2 -top-2 z-10 hidden h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-relevo transition-colors hover:bg-destructive/90 group-hover:flex focus-visible:flex"
      title="Excluir nó"
      aria-label="Excluir nó"
    >
      <X className="h-3 w-3" />
    </button>
  );
}

interface BaseNodeProps {
  nodeId?: string;
  nodeType: WorkflowNodeType;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  detail?: string;
  selected?: boolean;
  /** O que falta configurar neste nó. Presente = o nó impede a ativação. */
  warning?: string;
  /** Passo que não é mais oferecido (score/rating). Renderiza o selo e a dica. */
  discontinued?: boolean;
  showSourceHandle?: boolean;
  showTargetHandle?: boolean;
  children?: React.ReactNode;
}

export function BaseNode({
  nodeId,
  nodeType,
  icon,
  title,
  subtitle,
  detail,
  selected,
  warning,
  discontinued,
  showSourceHandle = true,
  showTargetHandle = true,
  children,
}: BaseNodeProps) {
  const ink = nodeType === "trigger";
  const { deleteElements } = useReactFlow();

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (nodeId) {
        deleteElements({ nodes: [{ id: nodeId }] });
      }
    },
    [nodeId, deleteElements]
  );

  return (
    <div className={nodeCardClassName({ nodeType, selected, warning: !!warning, className: "w-[280px]" })}>
      {nodeId && <NodeDeleteButton onClick={handleDelete} />}

      {showTargetHandle && <Handle type="target" position={Position.Top} className={NODE_HANDLE_CLASS} />}

      <div className="p-3">
        <div className="flex items-center gap-2.5">
          <NodeIconChip nodeType={nodeType}>{icon}</NodeIconChip>
          <div className="min-w-0 flex-1">
            <p className={cn("truncate text-sm font-bold tracking-[-0.01em]", ink ? "text-tinta-foreground" : "text-foreground")}>
              {title}
            </p>
            {subtitle && (
              <p className={cn("truncate text-xs", ink ? "text-tinta-muted" : "text-muted-foreground")}>{subtitle}</p>
            )}
          </div>
        </div>
        {detail && (
          <p className={cn("mt-2 truncate text-xs", ink ? "text-tinta-muted" : "text-muted-foreground")}>{detail}</p>
        )}
        {discontinued && (
          <div className="mt-2 space-y-1">
            <DiscontinuedBadge />
            <p className={cn("text-[11px] leading-snug", ink ? "text-tinta-muted" : "text-muted-foreground")}>
              {DISCONTINUED_STEP_HINT}
            </p>
          </div>
        )}
        {warning && (
          <p className={cn("mt-2 flex items-start gap-1.5 text-xs font-semibold", ink ? "text-warning" : "text-warning-strong")}>
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>{warning}</span>
          </p>
        )}
        {children}
      </div>

      {showSourceHandle && <Handle type="source" position={Position.Bottom} className={NODE_HANDLE_CLASS} />}
    </div>
  );
}
