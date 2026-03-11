import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Clock, Shuffle } from "lucide-react";
import { BaseNode } from "./BaseNode";
import type { DelayNodeData } from "@/types/workflow";

const UNIT_LABELS: Record<string, string> = {
  seconds: "seg",
  minutes: "min",
  hours: "h",
  days: "dias",
};

function DelayNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as DelayNodeData;
  const unitLabel = UNIT_LABELS[nodeData.unit] || nodeData.unit;

  let subtitle: string;
  if (nodeData.randomized && nodeData.amountMin && nodeData.amountMax) {
    subtitle = `Aleatório: ${nodeData.amountMin}–${nodeData.amountMax} ${unitLabel}`;
  } else if (nodeData.amount) {
    subtitle = `Esperar ${nodeData.amount} ${unitLabel}`;
  } else {
    subtitle = "Configure o delay";
  }

  const icon = nodeData.randomized ? (
    <Shuffle className="w-5 h-5 text-purple-500" />
  ) : (
    <Clock className="w-5 h-5 text-purple-500" />
  );

  return (
    <BaseNode
      nodeType="delay"
      icon={icon}
      title={nodeData.label || "Delay"}
      subtitle={subtitle}
      selected={selected}
    />
  );
}

export const DelayNode = memo(DelayNodeComponent);
