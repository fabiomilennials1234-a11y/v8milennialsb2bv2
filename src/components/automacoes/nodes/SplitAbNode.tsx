import { memo, useCallback, useEffect } from "react";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position, useReactFlow, useUpdateNodeInternals } from "@xyflow/react";
import { Split, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NODE_COLORS, migrateSplitAbData } from "@/types/workflow";
import type { SplitAbNodeData } from "@/types/workflow";

// Colors for variant handles/labels — cycles if more than 6 variants
const VARIANT_COLORS = [
  { text: "text-pink-600 dark:text-pink-400", bg: "!bg-pink-500" },
  { text: "text-violet-600 dark:text-violet-400", bg: "!bg-violet-500" },
  { text: "text-blue-600 dark:text-blue-400", bg: "!bg-blue-500" },
  { text: "text-emerald-600 dark:text-emerald-400", bg: "!bg-emerald-500" },
  { text: "text-amber-600 dark:text-amber-400", bg: "!bg-amber-500" },
  { text: "text-cyan-600 dark:text-cyan-400", bg: "!bg-cyan-500" },
];

function SplitAbNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = migrateSplitAbData(data as unknown as Record<string, unknown>);
  const colors = NODE_COLORS.split_ab;
  const variants = nodeData.variants;

  // Force React Flow to recalculate handle positions when variants change
  const updateNodeInternals = useUpdateNodeInternals();
  const variantKey = variants.map((v) => v.id).join(",");
  useEffect(() => {
    // Small delay to ensure DOM has updated before recalculating
    const timer = setTimeout(() => updateNodeInternals(id), 0);
    return () => clearTimeout(timer);
  }, [id, variantKey, updateNodeInternals]);

  const { deleteElements } = useReactFlow();
  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      deleteElements({ nodes: [{ id }] });
    },
    [id, deleteElements]
  );

  // Build summary like "50% / 30% / 20%"
  const summary = variants.map((v) => `${v.percentage}%`).join(" / ");

  return (
    <div
      className={cn(
        "group relative rounded-xl shadow-md border-l-4 border bg-card transition-shadow",
        variants.length > 3 ? "w-[360px]" : "w-[280px]",
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
            <p className="text-xs text-muted-foreground truncate">{summary}</p>
          </div>
        </div>
      </div>

      {/* Dynamic variant outputs */}
      <div className="flex justify-between px-4 pb-2 gap-2">
        {variants.map((variant, index) => {
          const colorSet = VARIANT_COLORS[index % VARIANT_COLORS.length];
          return (
            <div key={variant.id} className="relative text-center flex-1">
              <span className={cn("text-[10px] font-medium", colorSet.text)}>
                {variant.label || `${index + 1}`} ({variant.percentage}%)
              </span>
              <Handle
                type="source"
                position={Position.Bottom}
                id={`variant_${variant.id}`}
                className={cn(
                  "!w-3 !h-3 !border-2 !border-background",
                  colorSet.bg
                )}
                style={{ left: "50%" }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const SplitAbNode = memo(SplitAbNodeComponent);
