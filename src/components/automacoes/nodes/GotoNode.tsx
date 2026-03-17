import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { CornerDownRight } from "lucide-react";
import { BaseNode } from "./BaseNode";
import type { GotoNodeData } from "@/types/workflow";

function GotoNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as GotoNodeData;

  return (
    <BaseNode
      nodeId={id}
      nodeType="goto"
      icon={<CornerDownRight className="w-5 h-5 text-teal-500" />}
      title={nodeData.label || "Ir Para"}
      subtitle={nodeData.targetNodeLabel || "Selecione o nó destino"}
      selected={selected}
      showSourceHandle={false}
    />
  );
}

export const GotoNode = memo(GotoNodeComponent);
