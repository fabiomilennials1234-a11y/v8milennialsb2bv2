import { describe, expect, it } from "vitest";
import { canonicalizeTemplateFunnelRefs } from "./canonicalizeTemplateFunnelRefs";

const PIPELINE_ID = "11111111-1111-4111-8111-111111111111";
const START_ID = "22222222-2222-4222-8222-222222222222";
const END_ID = "33333333-3333-4333-8333-333333333333";

const pipelines = [{ id: PIPELINE_ID, slug: "whatsapp" }];
const stages = [
  { id: START_ID, pipeline_id: PIPELINE_ID, stage_key: "cadencia" },
  { id: END_ID, pipeline_id: PIPELINE_ID, stage_key: "respondeu_disparo" },
];

describe("canonicalizeTemplateFunnelRefs", () => {
  it("converte gatilho e ação legados para UUIDs da organização", () => {
    const definition = {
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          data: {
            type: "trigger",
            triggerType: "stage_changed",
            config: { pipe_type: "whatsapp", stages: ["cadencia"] },
          },
        },
        {
          id: "action-1",
          type: "action",
          data: { type: "action", actionType: "move_stage", targetStage: "respondeu_disparo" },
        },
      ],
      edges: [],
    };

    const result = canonicalizeTemplateFunnelRefs(definition, pipelines, stages);
    const resultNodes = result.nodes as Array<{ data: Record<string, unknown> }>;
    const triggerConfig = resultNodes[0].data.config as Record<string, unknown>;

    expect(triggerConfig).toEqual({ pipeline_id: PIPELINE_ID, stages: [START_ID] });
    expect(resultNodes[1].data).toMatchObject({ pipelineId: PIPELINE_ID, targetStage: END_ID });
    expect(resultNodes[1].data).not.toHaveProperty("pipeType");
  });

  it("preserva referência desconhecida para o editor apontar a configuração inválida", () => {
    const definition = {
      nodes: [{
        id: "trigger-1",
        type: "trigger",
        data: { config: { pipe_type: "funil-removido", stages: ["etapa-removida"] } },
      }],
    };

    expect(canonicalizeTemplateFunnelRefs(definition, pipelines, stages)).toEqual(definition);
  });

  it("não altera o template original", () => {
    const definition = {
      nodes: [{
        id: "trigger-1",
        type: "trigger",
        data: { config: { pipe_type: "whatsapp", stages: ["cadencia"] } },
      }],
    };

    canonicalizeTemplateFunnelRefs(definition, pipelines, stages);
    expect((definition.nodes[0].data.config as Record<string, unknown>).pipe_type).toBe("whatsapp");
  });
});
