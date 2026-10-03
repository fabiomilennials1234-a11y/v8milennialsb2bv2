import { summarizeGuidedCondition } from '../../lib/guided-condition-summary';
import { memo, useCallback } from "react";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import { GitBranch } from "lucide-react";
import { CONDITION_OPERATOR_LABELS } from "@/types/workflow";
import { isDiscontinuedGuidedField } from "@/contracts/workflows/guided-fields";
import { DiscontinuedBadge } from "../DiscontinuedNotice";
import { NodeDeleteButton, NodeIconChip } from "./BaseNode";
import { NODE_HANDLE_CLASS, nodeCardClassName } from "./node-style";
import type { ConditionNodeData } from "@/types/workflow";

function ConditionNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as ConditionNodeData;
  const operatorLabel = nodeData.operator
    ? CONDITION_OPERATOR_LABELS[nodeData.operator]
    : "";
  const subtitle = nodeData.guidedCondition ? summarizeGuidedCondition(nodeData.guidedCondition) : nodeData.field
    ? `${nodeData.field} ${operatorLabel} ${nodeData.value || ""}`
    : "Configure a condição";
  // Condição guiada por score (descontinuada) ou condição legada por rating/score.
  const discontinued = (!!nodeData.guidedCondition && "field" in nodeData.guidedCondition
    && isDiscontinuedGuidedField(nodeData.guidedCondition.field))
    || (!nodeData.guidedCondition && (nodeData.field === "score" || nodeData.field === "rating"));

  const { deleteElements } = useReactFlow();
  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      deleteElements({ nodes: [{ id }] });
    },
    [id, deleteElements]
  );

  return (
    <div className={nodeCardClassName({ nodeType: "condition", selected, className: "w-[280px]" })}>
      <NodeDeleteButton onClick={handleDelete} />

      <Handle type="target" position={Position.Top} className={NODE_HANDLE_CLASS} />

      <div className="p-3">
        <div className="flex items-center gap-2.5">
          <NodeIconChip nodeType="condition">
            <GitBranch />
          </NodeIconChip>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold tracking-[-0.01em] text-foreground">
              {nodeData.label || "Condição"}
            </p>
            <p className="text-xs text-muted-foreground truncate" title={subtitle}>{subtitle}</p>
          </div>
        </div>
        {discontinued && <DiscontinuedBadge className="mt-2" />}
      </div>

      {/* Duas saídas: Sim (esquerda) e Não (direita) */}
      <div className="flex justify-between px-6 pb-2">
        <div className="relative">
          <span className="text-[10px] font-bold text-success">
            Sim
          </span>
          <Handle
            type="source"
            position={Position.Bottom}
            id="yes"
            className="!w-3 !h-3 !bg-success !border-2 !border-background !left-2"
          />
        </div>
        <div className="relative">
          <span className="text-[10px] font-bold text-destructive">
            Não
          </span>
          <Handle
            type="source"
            position={Position.Bottom}
            id="no"
            className="!w-3 !h-3 !bg-destructive !border-2 !border-background !left-2"
          />
        </div>
      </div>
    </div>
  );
}

export const ConditionNode = memo(ConditionNodeComponent);
