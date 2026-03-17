import { memo, useCallback } from "react";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import { Split, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NODE_COLORS } from "@/types/workflow";
import type { SplitAbNodeData } from "@/types/workflow";

function SplitAbNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as SplitAbNodeData;
  const colors = NODE_COLORS.split_ab;
  const percentA = nodeData.splitPercentA ?? 50;
  const percentB = 100 - percentA;

  const { deleteElements } = useReactFlow();
  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      deleteElements({ nodes: [{ id }] });
    },
    [id, deleteElements]
  );

  return (
    <div
      className={cn(
        "group relative w-[280px] rounded-xl shadow-md border-l-4 border bg-card transition-shadow",
        colors.border,
        colors.bgLight,
        colors.bgDark,
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-lg"
      )}
    >
      <button
        onClick={handleDelete}
        className="absolute -top-2 -right-2 z-10 hidden group-hover:flex items-center justify-center w-5 h-5 rounded-full bg-destructive text-destructive-foreground shadow-md hover:bg-destructive/90 transition-colors"
        title="Excluir nó"
      >
        <X className="w-3 h-3" />
      </button>

      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-muted-foreground/50 !border-2 !border-background"
      />

      <div className="p-3">
        <div className="flex items-center gap-2.5">
          <div className={cn("p-1.5 rounded-lg", colors.bgLight, colors.bgDark)}>
            <Split className="w-5 h-5 text-pink-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground truncate">
              {nodeData.label || "Split A/B"}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {percentA}% / {percentB}%
            </p>
          </div>
        </div>
      </div>

      {/* Duas saídas: A e B */}
      <div className="flex justify-between px-6 pb-2">
        <div className="relative">
          <span className="text-[10px] font-medium text-pink-600 dark:text-pink-400">
            {nodeData.variantALabel || "A"} ({percentA}%)
          </span>
          <Handle
            type="source"
            position={Position.Bottom}
            id="variant_a"
            className="!w-3 !h-3 !bg-pink-500 !border-2 !border-background !left-6"
          />
        </div>
        <div className="relative">
          <span className="text-[10px] font-medium text-violet-600 dark:text-violet-400">
            {nodeData.variantBLabel || "B"} ({percentB}%)
          </span>
          <Handle
            type="source"
            position={Position.Bottom}
            id="variant_b"
            className="!w-3 !h-3 !bg-violet-500 !border-2 !border-background !left-6"
          />
        </div>
      </div>
    </div>
  );
}

export const SplitAbNode = memo(SplitAbNodeComponent);
