import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { CalendarClock } from "lucide-react";
import { BaseNode } from "./BaseNode";
import type { WaitBusinessWindowNodeData } from "@/types/workflow";

const DAY_SHORT: Record<string, string> = {
  seg: "S", ter: "T", qua: "Q", qui: "Q", sex: "S", sab: "S", dom: "D",
};

function WaitBusinessWindowNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as WaitBusinessWindowNodeData;
  const days = nodeData.days || [];
  const daysLabel = days.length === 7
    ? "Todos os dias"
    : days.length === 5 && !days.includes("sab") && !days.includes("dom")
      ? "Seg–Sex"
      : days.map(d => DAY_SHORT[d] || d).join(" ");

  const timeLabel = nodeData.startTime && nodeData.endTime
    ? `${nodeData.startTime}–${nodeData.endTime}`
    : "Configure horários";

  const subtitle = days.length > 0
    ? `${daysLabel} · ${timeLabel}`
    : "Configure a janela";

  return (
    <BaseNode
      nodeId={id}
      nodeType="wait_business_window"
      icon={<CalendarClock className="w-5 h-5 text-amber-500" />}
      title={nodeData.label || "Janela Comercial"}
      subtitle={subtitle}
      selected={selected}
    />
  );
}

export const WaitBusinessWindowNode = memo(WaitBusinessWindowNodeComponent);
