import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Bot } from "lucide-react";
import { BaseNode } from "./BaseNode";
import type { CopilotNodeData } from "@/types/workflow";

function CopilotNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as CopilotNodeData;

  return (
    <BaseNode
      nodeType="copilot"
      icon={<Bot className="w-5 h-5 text-cyan-500" />}
      title={nodeData.label || "Copilot"}
      subtitle={nodeData.agentName || "Selecione o agente"}
      detail="Transfere controle para o agente"
      selected={selected}
      showSourceHandle={false}
    />
  );
}

export const CopilotNode = memo(CopilotNodeComponent);
