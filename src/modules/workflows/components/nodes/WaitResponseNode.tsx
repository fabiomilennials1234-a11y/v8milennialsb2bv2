import { memo, useCallback } from "react";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import { MessageCircle } from "lucide-react";
import { NodeDeleteButton, NodeIconChip } from "./BaseNode";
import { NODE_HANDLE_CLASS, nodeCardClassName } from "./node-style";
import type { WaitResponseNodeData } from "@/types/workflow";

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  meta: "Meta (IG/FB)",
  any: "Qualquer canal",
};

function WaitResponseNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as WaitResponseNodeData;
  const channelLabel = CHANNEL_LABELS[nodeData.channel] || "Qualquer canal";

  const timeoutParts: string[] = [];
  if (nodeData.timeoutHours) timeoutParts.push(`${nodeData.timeoutHours}h`);
  if (nodeData.timeoutMinutes) timeoutParts.push(`${nodeData.timeoutMinutes}min`);
  const timeoutText = timeoutParts.length > 0 ? timeoutParts.join(" ") : "sem timeout";

  const { deleteElements } = useReactFlow();
  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      deleteElements({ nodes: [{ id }] });
    },
    [id, deleteElements]
  );

  return (
    <div className={nodeCardClassName({ nodeType: "wait_response", selected, className: "w-[280px]" })}>
      <NodeDeleteButton onClick={handleDelete} />

      <Handle type="target" position={Position.Top} className={NODE_HANDLE_CLASS} />

      <div className="p-3">
        <div className="flex items-center gap-2.5">
          <NodeIconChip nodeType="wait_response">
            <MessageCircle />
          </NodeIconChip>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold tracking-[-0.01em] text-foreground">
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
          <span className="text-[10px] font-bold text-success">
            Respondeu
          </span>
          <Handle
            type="source"
            position={Position.Bottom}
            id="replied"
            className="!w-3 !h-3 !bg-success !border-2 !border-background !left-4"
          />
        </div>
        <div className="relative">
          <span className="text-[10px] font-bold text-destructive">
            Timeout
          </span>
          <Handle
            type="source"
            position={Position.Bottom}
            id="timeout"
            className="!w-3 !h-3 !bg-destructive !border-2 !border-background !left-3"
          />
        </div>
      </div>
    </div>
  );
}

export const WaitResponseNode = memo(WaitResponseNodeComponent);
