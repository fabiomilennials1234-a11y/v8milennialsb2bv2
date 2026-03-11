import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { NODE_COLORS } from "@/types/workflow";
import type { WaitResponseNodeData } from "@/types/workflow";

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  meta: "Meta (IG/FB)",
  any: "Qualquer canal",
};

function WaitResponseNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as WaitResponseNodeData;
  const colors = NODE_COLORS.wait_response;
  const channelLabel = CHANNEL_LABELS[nodeData.channel] || "Qualquer canal";

  const timeoutParts: string[] = [];
  if (nodeData.timeoutHours) timeoutParts.push(`${nodeData.timeoutHours}h`);
  if (nodeData.timeoutMinutes) timeoutParts.push(`${nodeData.timeoutMinutes}min`);
  const timeoutText = timeoutParts.length > 0 ? timeoutParts.join(" ") : "sem timeout";

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
            <MessageCircle className="w-5 h-5 text-orange-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground truncate">
              {nodeData.label || "Esperar Resposta"}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {channelLabel} &middot; Timeout: {timeoutText}
            </p>
          </div>
        </div>
      </div>

      {/* Duas saídas: Respondeu / Timeout */}
      <div className="flex justify-between px-6 pb-2">
        <div className="relative">
          <span className="text-[10px] font-medium text-green-600 dark:text-green-400">
            Respondeu
          </span>
          <Handle
            type="source"
            position={Position.Bottom}
            id="replied"
            className="!w-3 !h-3 !bg-green-500 !border-2 !border-background !left-4"
          />
        </div>
        <div className="relative">
          <span className="text-[10px] font-medium text-red-500 dark:text-red-400">
            Timeout
          </span>
          <Handle
            type="source"
            position={Position.Bottom}
            id="timeout"
            className="!w-3 !h-3 !bg-red-500 !border-2 !border-background !left-3"
          />
        </div>
      </div>
    </div>
  );
}

export const WaitResponseNode = memo(WaitResponseNodeComponent);
