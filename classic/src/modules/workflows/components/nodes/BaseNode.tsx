import { useCallback } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import { X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkflowNodeType } from "@/types/workflow";
import { NODE_COLORS } from "@/types/workflow";

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
  showSourceHandle = true,
  showTargetHandle = true,
  children,
}: BaseNodeProps) {
  const colors = NODE_COLORS[nodeType];
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
    <div
      className={cn(
        "group relative w-[280px] rounded-xl shadow-md border-l-4 border bg-card transition-shadow",
        colors.border,
        colors.bgLight,
        colors.bgDark,
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-lg",
        // Nó incompleto: o autor precisa achar ESTE nó entre vinte. Recusar sem
        // apontar seria trocar um defeito por outro.
        warning && "ring-2 ring-amber-500/70 ring-offset-2 ring-offset-background"
      )}
    >
      {nodeId && (
        <button
          onClick={handleDelete}
          className="absolute -top-2 -right-2 z-10 hidden group-hover:flex items-center justify-center w-5 h-5 rounded-full bg-destructive text-destructive-foreground shadow-md hover:bg-destructive/90 transition-colors"
          title="Excluir nó"
        >
          <X className="w-3 h-3" />
        </button>
      )}

      {showTargetHandle && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !bg-muted-foreground/50 !border-2 !border-background"
        />
      )}

      <div className="p-3">
        <div className="flex items-center gap-2.5">
          <div className={cn("p-1.5 rounded-lg", colors.bgLight, colors.bgDark)}>
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground truncate">{title}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
            )}
          </div>
        </div>
        {detail && (
          <p className="text-xs text-muted-foreground mt-2 truncate">{detail}</p>
        )}
        {warning && (
          <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>{warning}</span>
          </p>
        )}
        {children}
      </div>

      {showSourceHandle && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3 !h-3 !bg-muted-foreground/50 !border-2 !border-background"
        />
      )}
    </div>
  );
}
