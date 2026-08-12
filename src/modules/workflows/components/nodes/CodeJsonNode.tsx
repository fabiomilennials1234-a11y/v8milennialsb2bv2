import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Braces } from "lucide-react";
import { BaseNode } from "./BaseNode";
import type { CodeJsonNodeData } from "@/types/workflow";

function buildSubtitle(nodeData: CodeJsonNodeData): string {
  const code = nodeData.code?.trim();
  if (!code) return "Configure o código";

  const linhas = `${code.split("\n").length} linha(s)`;
  return nodeData.outputVariable
    ? `${linhas} → {{${nodeData.outputVariable}}}`
    : linhas;
}

function CodeJsonNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as CodeJsonNodeData;

  return (
    <BaseNode
      nodeId={id}
      nodeType="code_json"
      icon={<Braces className="w-5 h-5 text-emerald-500" />}
      title={nodeData.label || "JSON"}
      subtitle={buildSubtitle(nodeData)}
      selected={selected}
    />
  );
}

export const CodeJsonNode = memo(CodeJsonNodeComponent);
