import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Zap, GitBranch, Tag, TrendingUp, Timer } from "lucide-react";
import { BaseNode } from "./BaseNode";
import { TRIGGER_LABELS, isDiscontinuedTrigger } from "@/types/workflow";
import type { TriggerNodeData } from "@/types/workflow";

const TRIGGER_ICONS: Record<string, React.ElementType> = {
  lead_created: Zap,
  stage_changed: GitBranch,
  tag_added: Tag,
  score_reached: TrendingUp, // descontinuado — mantido para renderizar nó salvo
  cron: Timer,
};

function TriggerNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as TriggerNodeData;
  const Icon = TRIGGER_ICONS[nodeData.triggerType] || Zap;

  return (
    <BaseNode
      nodeId={id}
      nodeType="trigger"
      icon={<Icon />}
      title={nodeData.label || "Trigger"}
      subtitle={TRIGGER_LABELS[nodeData.triggerType] || "Selecione o trigger"}
      selected={selected}
      discontinued={isDiscontinuedTrigger(nodeData.triggerType)}
      showTargetHandle={false}
    />
  );
}

export const TriggerNode = memo(TriggerNodeComponent);
