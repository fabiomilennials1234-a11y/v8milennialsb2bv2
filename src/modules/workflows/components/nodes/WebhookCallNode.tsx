import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Globe } from "lucide-react";
import { BaseNode } from "./BaseNode";
import type { WebhookCallNodeData } from "@/types/workflow";

function WebhookCallNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as WebhookCallNodeData;
  const method = nodeData.method || "POST";
  const urlPreview = nodeData.url
    ? nodeData.url.length > 35
      ? nodeData.url.substring(0, 35) + "..."
      : nodeData.url
    : "Configure a URL";

  return (
    <BaseNode
      nodeId={id}
      nodeType="webhook_call"
      icon={<Globe className="w-5 h-5 text-indigo-500" />}
      title={nodeData.label || "Webhook"}
      subtitle={`${method} ${urlPreview}`}
      selected={selected}
    />
  );
}

export const WebhookCallNode = memo(WebhookCallNodeComponent);
