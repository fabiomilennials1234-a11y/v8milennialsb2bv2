import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { CircleStop } from "lucide-react";
import { BaseNode } from "./BaseNode";
import type { EndNodeData } from "@/types/workflow";

function EndNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as EndNodeData;

  return (
    <BaseNode
      nodeType="end"
      icon={<CircleStop className="w-5 h-5 text-gray-400" />}
      title={nodeData.label || "Fim"}
      subtitle="Encerra o workflow"
      selected={selected}
      showSourceHandle={false}
    />
  );
}

export const EndNode = memo(EndNodeComponent);
