import type { WorkflowTemplate } from "@/contracts/workflows/workflow-template";

interface PipelineRef {
  id: string;
  slug: string;
}

interface StageRef {
  id: string;
  pipeline_id: string | null;
  stage_key: string;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function resolvePipeline(pipelines: PipelineRef[], ...refs: unknown[]): PipelineRef | undefined {
  for (const raw of refs) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const ref = raw.trim();
    const slug = ref.replace(/^pipe_/, "");
    const found = pipelines.find((pipeline) => pipeline.id === ref || pipeline.slug === slug);
    if (found) return found;
  }
  return undefined;
}

function resolveStageId(stages: StageRef[], pipelineId: string, raw: unknown): unknown {
  if (typeof raw !== "string" || !raw.trim()) return raw;
  const ref = raw.trim();
  return stages.find(
    (stage) =>
      stage.pipeline_id === pipelineId &&
      (stage.id === ref || stage.stage_key === ref),
  )?.id ?? raw;
}

/**
 * Converte uma cópia de template para o contrato atual da organização.
 *
 * Os templates Funil A/B são exports históricos e ainda carregam slugs como
 * `whatsapp` e stage_keys como `cadencia`. Eles não podem guardar UUIDs porque
 * cada organização tem seus próprios registros. A conversão acontece no uso:
 * slug -> pipelines.id e stage_key -> pipeline_stages.id.
 */
export function canonicalizeTemplateFunnelRefs(
  definition: WorkflowTemplate["definition"],
  pipelines: PipelineRef[],
  stages: StageRef[],
): WorkflowTemplate["definition"] {
  const rawNodes = Array.isArray(definition.nodes) ? definition.nodes : [];

  const triggerPipeline = rawNodes
    .map(asObject)
    .filter((node) => node.type === "trigger")
    .map((node) => asObject(asObject(node.data).config))
    .map((config) => resolvePipeline(pipelines, config.pipeline_id, config.pipe_type))
    .find(Boolean);

  const nodes = rawNodes.map((rawNode) => {
    const node = asObject(rawNode);
    const data = { ...asObject(node.data) };

    if (node.type === "trigger") {
      const config = { ...asObject(data.config) };
      const pipeline = resolvePipeline(pipelines, config.pipeline_id, config.pipe_type);

      if (pipeline && !config.campanha_id) {
        config.pipeline_id = pipeline.id;
        delete config.pipe_type;

        if (Array.isArray(config.stages)) {
          config.stages = config.stages.map((stage) =>
            resolveStageId(stages, pipeline.id, stage),
          );
        }
        config.from_stage = resolveStageId(stages, pipeline.id, config.from_stage);
        config.to_stage = resolveStageId(stages, pipeline.id, config.to_stage);
      }

      data.config = config;
    }

    const actionType = data.actionType;
    if (["move_stage", "duplicate_to_pipe", "remove_from_pipe", "mark_as_lost"].includes(String(actionType))) {
      const pipeline = resolvePipeline(
        pipelines,
        data.pipelineId,
        actionType === "duplicate_to_pipe" ? data.targetPipeType : data.pipeType,
        triggerPipeline?.id,
      );

      if (pipeline) {
        data.pipelineId = pipeline.id;
        const stageRef = data.targetStage || data.targetPipeStage;
        if (stageRef) data.targetStage = resolveStageId(stages, pipeline.id, stageRef);
        delete data.pipeType;
        delete data.targetPipeType;
        delete data.targetPipeStage;
      }
    }

    return { ...node, data };
  });

  return { ...definition, nodes };
}
