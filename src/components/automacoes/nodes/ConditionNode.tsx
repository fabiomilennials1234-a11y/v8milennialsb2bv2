import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import { GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import { NODE_COLORS, CONDITION_OPERATOR_LABELS } from "@/types/workflow";
import type { ConditionNodeData } from "@/types/workflow";

function ConditionNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as ConditionNodeData;
  const colors = NODE_COLORS.condition;
  const operatorLabel = nodeData.operator
    ? CONDITION_OPERATOR_LABELS[nodeData.operator]
    : "";
  const subtitle = nodeData.field
    ? `${nodeData.field} ${operatorLabel} ${nodeData.value || ""}`
    : "Configure a condição";

  return (
    <div
      className={cn(
        "w-[280px] rounded-xl shadow-md border-l-4 border bg-card transition-shadow",
        colors.border,
        colors.bgLight,
        colors.bgDark,
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-lg"
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-muted-foreground/50 !border-2 !border-background"
      />

      <div className="p-3">
        <div className="flex items-center gap-2.5">
          <div className={cn("p-1.5 rounded-lg", colors.bgLight, colors.bgDark)}>
            <GitBranch className="w-5 h-5 text-yellow-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground truncate">
              {nodeData.label || "Condição"}
            </p>
            <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
          </div>
        </div>
      </div>

      {/* Duas saídas: Sim (esquerda) e Não (direita) */}
      <div className="flex justify-between px-6 pb-2">
        <div className="relative">
          <span className="text-[10px] font-medium text-green-600 dark:text-green-400">
            Sim
          </span>
          <Handle
            type="source"
            position={Position.Bottom}
            id="yes"
            className="!w-3 !h-3 !bg-green-500 !border-2 !border-background !left-2"
          />
        </div>
        <div className="relative">
          <span className="text-[10px] font-medium text-red-500 dark:text-red-400">
            Não
          </span>
          <Handle
            type="source"
            position={Position.Bottom}
            id="no"
            className="!w-3 !h-3 !bg-red-500 !border-2 !border-background !left-2"
          />
        </div>
      </div>
    </div>
  );
}

export const ConditionNode = memo(ConditionNodeComponent);
