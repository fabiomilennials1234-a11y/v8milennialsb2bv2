/**
 * useFunnelStageOptions — shared funnel + stage picker data for the Disparos
 * wizard. Fatia B (Funil é Funil): a lista de funis é a lista REAL da org
 * (`usePipelines` — sistema e custom juntos, na ordem do board), e as etapas
 * vêm de `useStagesDoFunil(pipelineId)` — chave canônica `pipeline_stages.id`
 * (uuid) para QUALQUER funil. Used by both the audience picker
 * (AudienceByStage, #902) and the post-send destination picker (StepPostSend).
 */
import { useMemo } from "react";
import { usePipelines, useStagesDoFunil, type Pipeline } from "@/modules/pipelines";
import { ALL_FUNNELS_LABEL, type FunnelScope, type StageScope } from "./audience-resolve";

export interface FunnelStageSelection {
  funnelScope: FunnelScope;
  /** Active funnel id when funnelScope === "one"; null = nothing chosen. */
  pipelineId: string | null;
}

export interface FunnelStageOption {
  /** pipeline_stages.id (uuid, canônico para qualquer funil). */
  key: string;
  name: string;
}

/** Funnel Select value encoding — "all" | pipelines.id (uuid). Empty = nothing
 *  chosen. O uuid não colide com "all" por construção. */
export const ALL_FUNNELS_VALUE = "all";

export function funnelSelectValue(sel: FunnelStageSelection): string {
  if (sel.funnelScope === "all") return ALL_FUNNELS_VALUE;
  return sel.pipelineId ?? "";
}

/**
 * Stage Select value encoding. Namespaced (`stage:<uuid>`) exactly like before
 * rather than the bare id: `"all"` vs `"stage:<id>"` cannot collide by
 * construction, and the shape stays stable for the tests that pin it.
 */
export const ALL_STAGES_VALUE = "all";

export function stageSelectValue(sel: {
  stageScope: StageScope;
  stageId: string;
}): string {
  if (sel.stageScope === "all") return ALL_STAGES_VALUE;
  return sel.stageId ? `stage:${sel.stageId}` : "";
}

export function parseStageSelectValue(value: string): {
  stageScope: StageScope;
  stageId: string;
} {
  if (value === ALL_STAGES_VALUE) return { stageScope: "all", stageId: "" };
  return { stageScope: "one", stageId: value.replace(/^stage:/, "") };
}

export function useFunnelStageOptions(sel: FunnelStageSelection) {
  const isAll = sel.funnelScope === "all";
  // "Todos os funis" is a complete target on its own — no funnel to pick, and
  // no stage list to load (a união cross-funil não tem eixo de etapa).
  const hasFunnel = isAll ? true : sel.pipelineId !== null;

  const { data: pipelines = [] } = usePipelines();
  // A lista do picker: só funis ATIVOS (funil desligado não é destino nem
  // fonte de público novo). `usePipelines` já ordena por display_order.
  const funnels = useMemo<Pipeline[]>(
    () => pipelines.filter((p) => p.is_active !== false),
    [pipelines],
  );

  const stagesQuery = useStagesDoFunil(!isAll ? sel.pipelineId : null);
  const stageRows = stagesQuery.data;

  // Unified stage list for the picker; empty until a funnel is chosen, and
  // empty by definition for "Todos os funis".
  const stages = useMemo<FunnelStageOption[]>(() => {
    if (isAll || !hasFunnel || !stageRows) return [];
    return stageRows.map((s) => ({ key: s.id, name: s.name }));
  }, [isAll, hasFunnel, stageRows]);

  const stagesLoading = !isAll && hasFunnel && stagesQuery.isLoading;

  const funnelLabel = isAll
    ? ALL_FUNNELS_LABEL
    : funnels.find((p) => p.id === sel.pipelineId)?.name ?? "Funil";

  return { funnels, stages, stagesLoading, funnelLabel, hasFunnel };
}
