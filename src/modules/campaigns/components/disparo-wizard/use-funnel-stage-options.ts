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
import {
  ALL_FUNNELS_LABEL,
  SYSTEM_FUNNELS,
  type FunnelKind,
  type StageScope,
} from "./audience-resolve";

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

/** Funnel Select value encoding — keeps every funnel option in one Select
 *  ("all" | "system:whatsapp" | "custom:<uuid>"). Empty = nothing chosen. */
export const ALL_FUNNELS_VALUE = "all";

export function funnelSelectValue(sel: FunnelStageSelection): string {
  if (sel.funnelKind === "all") return ALL_FUNNELS_VALUE;
  if (sel.funnelKind === "system") {
    return sel.pipelineType ? `system:${sel.pipelineType}` : "";
  }
  return sel.pipelineId ? `custom:${sel.pipelineId}` : "";
}

/**
 * Stage Select value encoding. Namespaced exactly like the funnel Select rather
 * than using a sentinel stageKey: `stage_key` is an org-controlled slug, so ANY
 * bare sentinel ("all", "__todas__", …) could collide with a real stage the
 * customer named. `"all"` vs `"stage:<key>"` cannot collide by construction.
 */
export const ALL_STAGES_VALUE = "all";

export function stageSelectValue(sel: {
  stageScope: StageScope;
  stageKey: string;
}): string {
  if (sel.stageScope === "all") return ALL_STAGES_VALUE;
  return sel.stageKey ? `stage:${sel.stageKey}` : "";
}

export function parseStageSelectValue(value: string): {
  stageScope: StageScope;
  stageKey: string;
} {
  if (value === ALL_STAGES_VALUE) return { stageScope: "all", stageKey: "" };
  return { stageScope: "one", stageKey: value.replace(/^stage:/, "") };
}

export function useFunnelStageOptions(sel: FunnelStageSelection) {
  const isAll = sel.funnelKind === "all";
  const isSystem = sel.funnelKind === "system";
  // "Todos os funis" is a complete target on its own — no funnel to pick, and
  // no stage list to load (the two funnel models share no stage vocabulary).
  const hasFunnel = isAll
    ? true
    : isSystem
      ? sel.pipelineType !== null
      : sel.pipelineId !== null;

  const { data: customPipelines = [] } = useCustomPipelines();
  const { data: systemStages = [], isLoading: systemStagesLoading } = usePipelineStages(
    isSystem && sel.pipelineType ? sel.pipelineType : ("whatsapp" as SystemPipelineType),
  );
  const { data: customStages = [], isLoading: customStagesLoading } = useCustomPipelineStages(
    !isSystem ? (sel.pipelineId ?? undefined) : undefined,
  );

  // Unified stage list for the picker; empty until a funnel is chosen, and
  // empty by definition for "Todos os funis" (cross-model union has no stages).
  const stages = useMemo<FunnelStageOption[]>(() => {
    if (isAll || !hasFunnel) return [];
    if (isSystem) return systemStages.map((s) => ({ key: s.stage_key, name: s.name }));
    return customStages.map((s) => ({ key: s.id, name: s.name }));
  }, [isAll, hasFunnel, isSystem, systemStages, customStages]);

  const stagesLoading =
    !isAll && hasFunnel && (isSystem ? systemStagesLoading : customStagesLoading);

  const funnelLabel = isAll
    ? ALL_FUNNELS_LABEL
    : isSystem
      ? SYSTEM_FUNNELS.find((f) => f.value === sel.pipelineType)?.label ?? "Funil"
      : customPipelines.find((p) => p.id === sel.pipelineId)?.name ?? "Funil";

  return { customPipelines, stages, stagesLoading, funnelLabel, hasFunnel };
}
