import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Zap, GitBranch, Tag, TrendingUp, Timer } from "lucide-react";
import { BaseNode } from "./BaseNode";
import { TRIGGER_LABELS } from "@/types/workflow";
import type { TriggerNodeData } from "@/types/workflow";

const TRIGGER_ICONS: Record<string, React.ElementType> = {
  lead_created: Zap,
  stage_changed: GitBranch,
  tag_added: Tag,
  score_reached: TrendingUp,
  cron: Timer,
};

function TriggerNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as TriggerNodeData;
  const Icon = TRIGGER_ICONS[nodeData.triggerType] || Zap;

  return (
    <BaseNode
      nodeId={id}
      nodeType="trigger"
      icon={<Icon className="w-5 h-5 text-blue-500" />}
      title={nodeData.label || "Trigger"}
      subtitle={TRIGGER_LABELS[nodeData.triggerType] || "Selecione o trigger"}
      selected={selected}
      showTargetHandle={false}
    />
  );
}

export const TriggerNode = memo(TriggerNodeComponent);
