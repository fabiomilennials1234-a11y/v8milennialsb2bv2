import { Handle, Position } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { WorkflowNodeType } from "@/types/workflow";
import { NODE_COLORS } from "@/types/workflow";

interface BaseNodeProps {
  nodeType: WorkflowNodeType;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  detail?: string;
  selected?: boolean;
  showSourceHandle?: boolean;
  showTargetHandle?: boolean;
  children?: React.ReactNode;
}

export function BaseNode({
  nodeType,
  icon,
  title,
  subtitle,
  detail,
  selected,
  showSourceHandle = true,
  showTargetHandle = true,
  children,
}: BaseNodeProps) {
  const colors = NODE_COLORS[nodeType];

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
