import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
// `Network` e não `Globe`: o Globe já é o card do Webhook Externo, e dois nós de
// rede com o mesmo ícone ficam indistinguíveis no canvas.
import { Network } from "lucide-react";
import { BaseNode } from "./BaseNode";
import type { CodeHttpsNodeData } from "@/types/workflow";

function buildSubtitle(nodeData: CodeHttpsNodeData): string {
  const code = nodeData.code?.trim();
  if (!code) return "Configure o código";

  const linhas = `${code.split("\n").length} linha(s)`;
  return nodeData.outputVariable
    ? `${linhas} → {{${nodeData.outputVariable}}}`
    : linhas;
}

function CodeHttpsNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as CodeHttpsNodeData;

  return (
    <BaseNode
      nodeId={id}
      nodeType="code_https"
      icon={<Network className="w-5 h-5 text-violet-500" />}
      title={nodeData.label || "HTTPS"}
      subtitle={buildSubtitle(nodeData)}
      selected={selected}
    />
  );
}

export const CodeHttpsNode = memo(CodeHttpsNodeComponent);
