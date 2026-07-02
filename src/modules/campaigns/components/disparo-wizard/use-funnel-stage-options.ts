/**
 * useFunnelStageOptions — shared funnel + stage picker data for the Disparos
 * wizard. One selection shape (funnelKind / pipelineType / pipelineId) resolves
 * to the unified stage list (system → stage_key slug; custom → stage_id uuid),
 * the loading flag, and the display label of the chosen funnel. Used by both
 * the audience picker (AudienceByStage, #902) and the post-send destination
 * picker (StepPostSend).
 */
import { useMemo } from "react";
import {
  useCustomPipelines,
  useCustomPipelineStages,
  usePipelineStages,
  type SystemPipelineType,
} from "@/modules/pipelines";
import { SYSTEM_FUNNELS, type FunnelKind } from "./audience-resolve";

export interface FunnelStageSelection {
  funnelKind: FunnelKind;
  /** Active system pipe when funnelKind === "system"; null = nothing chosen. */
  pipelineType: SystemPipelineType | null;
  /** Active custom pipeline id when funnelKind === "custom" (else null). */
  pipelineId: string | null;
}

export interface FunnelStageOption {
  /** system: stage_key slug; custom: stage_id uuid. */
  key: string;
  name: string;
}

/** Funnel Select value encoding — keeps system pipes and custom ids in one
 *  Select ("system:whatsapp" | "custom:<uuid>"). Empty = nothing chosen. */
export function funnelSelectValue(sel: FunnelStageSelection): string {
  if (sel.funnelKind === "system") {
    return sel.pipelineType ? `system:${sel.pipelineType}` : "";
  }
  return sel.pipelineId ? `custom:${sel.pipelineId}` : "";
}

export function useFunnelStageOptions(sel: FunnelStageSelection) {
  const isSystem = sel.funnelKind === "system";
  const hasFunnel = isSystem ? sel.pipelineType !== null : sel.pipelineId !== null;

  const { data: customPipelines = [] } = useCustomPipelines();
  const { data: systemStages = [], isLoading: systemStagesLoading } = usePipelineStages(
    isSystem && sel.pipelineType ? sel.pipelineType : ("whatsapp" as SystemPipelineType),
  );
  const { data: customStages = [], isLoading: customStagesLoading } = useCustomPipelineStages(
    !isSystem ? (sel.pipelineId ?? undefined) : undefined,
  );

  // Unified stage list for the picker; empty until a funnel is chosen.
  const stages = useMemo<FunnelStageOption[]>(() => {
    if (!hasFunnel) return [];
    if (isSystem) return systemStages.map((s) => ({ key: s.stage_key, name: s.name }));
    return customStages.map((s) => ({ key: s.id, name: s.name }));
  }, [hasFunnel, isSystem, systemStages, customStages]);

  const stagesLoading = hasFunnel && (isSystem ? systemStagesLoading : customStagesLoading);

  const funnelLabel = isSystem
    ? SYSTEM_FUNNELS.find((f) => f.value === sel.pipelineType)?.label ?? "Funil"
    : customPipelines.find((p) => p.id === sel.pipelineId)?.name ?? "Funil";

  return { customPipelines, stages, stagesLoading, funnelLabel, hasFunnel };
}
