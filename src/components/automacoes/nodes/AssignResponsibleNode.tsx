import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { UserRoundPlus } from "lucide-react";
import { BaseNode } from "./BaseNode";
import type { AssignResponsibleNodeData } from "@/types/workflow";

const MODE_LABELS: Record<string, string> = {
  round_robin: "Rotativo",
  random: "Aleatório",
  manual: "Manual",
};

const TARGET_LABELS: Record<string, string> = {
  responsible: "Responsável",
  sdr: "SDR",
  closer: "Vendedor",
  sale: "Vendedor",
};

function AssignResponsibleNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as AssignResponsibleNodeData;
  const modeLabel = MODE_LABELS[nodeData.assignMode] || "Configure";
  const targetLabel = TARGET_LABELS[nodeData.assignTarget] || "";

  let subtitle: string;
  if (nodeData.assignMode === "manual" && nodeData.assigneeName) {
    subtitle = `${nodeData.assigneeName} · ${targetLabel}`;
  } else if (nodeData.assignMode) {
    subtitle = `${modeLabel} · ${targetLabel}`;
  } else {
    subtitle = "Configure a distribuição";
  }

  return (
    <BaseNode
      nodeId={id}
      nodeType="assign_responsible"
      icon={<UserRoundPlus className="w-5 h-5 text-rose-500" />}
      title={nodeData.label || "Definir Responsável"}
      subtitle={subtitle}
      selected={selected}
    />
  );
}

export const AssignResponsibleNode = memo(AssignResponsibleNodeComponent);
