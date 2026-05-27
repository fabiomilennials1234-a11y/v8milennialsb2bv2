import { useStageWorkflows } from "@/hooks/useStageWorkflows";
import { StageWorkflowsBadge } from "./StageWorkflowsBadge";

interface StageWorkflowsBadgeWrapperProps {
  pipeType: string;
  stageKey: string;
  stageName: string;
  counts?: { total: number; active: number };
}

/**
 * Wrapper that connects the badge to useStageWorkflows hook.
 * Receives pre-computed counts from the parent (from useStageWorkflowCounts)
 * and loads the full workflow list when the popover opens.
 */
export function StageWorkflowsBadgeWrapper({
  pipeType,
  stageKey,
  stageName,
  counts,
}: StageWorkflowsBadgeWrapperProps) {
  const total = counts?.total ?? 0;
  const active = counts?.active ?? 0;

  // Always load workflows for this stage (lightweight query, cached)
  const { data: workflows } = useStageWorkflows(pipeType, stageKey);

  return (
    <StageWorkflowsBadge
      total={total}
      active={active}
      workflows={workflows}
      pipeType={pipeType}
      stageKey={stageKey}
      stageName={stageName}
    />
  );
}
