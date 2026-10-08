import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { SquareCode } from "lucide-react";
import { BaseNode } from "./BaseNode";
import type { CodeJavascriptNodeData } from "@/types/workflow";

function buildSubtitle(nodeData: CodeJavascriptNodeData): string {
  const code = nodeData.code?.trim();
  if (!code) return "Configure o código";

  const linhas = `${code.split("\n").length} linha(s)`;
  return nodeData.outputVariable
    ? `${linhas} → {{${nodeData.outputVariable}}}`
    : linhas;
}

function CodeJavascriptNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as CodeJavascriptNodeData;

  return (
    <BaseNode
      nodeId={id}
      nodeType="code_javascript"
      icon={<SquareCode className="w-5 h-5 text-sky-500" />}
      title={nodeData.label || "JavaScript"}
      subtitle={buildSubtitle(nodeData)}
      // O nó é autorável, mas o executor ainda não roda o código (fase 1):
      // avisar no card evita que o usuário espere um efeito que não vem.
      detail="Não executa nesta versão"
      selected={selected}
    />
  );
}

export const CodeJavascriptNode = memo(CodeJavascriptNodeComponent);
