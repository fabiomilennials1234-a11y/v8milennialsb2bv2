import { describe, expect, it } from "vitest";
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "@/types/workflow";
import { buildLegacyConditionReviewDraft, inspectLegacyConditions } from "./legacy-condition-review";

function condition(id: string, data: Record<string, unknown>): WorkflowNode {
  return { id, type: "condition", position: { x: 0, y: 0 }, data: {
    type: "condition", label: id, field: "name", operator: "equals", value: "", ...data,
  } } as WorkflowNode;
}

function definition(nodes: WorkflowNode[], edges: WorkflowEdge[] = []): WorkflowDefinition {
  return { nodes, edges };
}

describe("legacy condition review", () => {
  it("inventories semantic drift without mutating the running definition", () => {
    const source = definition([
      condition("text", { field: "name", operator: "contains", value: "ÁGUA" }),
      condition("empty", { field: "origin", operator: "is_empty", value: "texto ignorado" }),
      condition("zero", { field: "score", operator: "equals", value: "0" }),
      condition("tag", { field: "tags", operator: "has_tag", value: "VIP" }),
      condition("custom", { field: "custom.Setor", operator: "equals", value: "Indústria" }),
      condition("stage", { field: "stage", operator: "in_stage", value: "proposta" }),
      condition("alias", { field: "sdr_id", operator: "equals", value: "member-1" }),
      condition("regex", { field: "name", operator: "regex_match", value: "^ind" }),
      condition("hours", { conditionMode: "time_window", timeWindow: {
        days: ["seg"], startTime: "08:00", endTime: "18:00", timezone: "America/Sao_Paulo",
      } }),
    ]);
    const snapshot = JSON.stringify(source);

    const review = inspectLegacyConditions(source);

    expect(JSON.stringify(source)).toBe(snapshot);
    expect(review.items.map(item => [item.nodeId, item.kind])).toEqual([
      ["text", "semantic_change"],
      ["empty", "semantic_change"],
      ["zero", "semantic_change"],
      ["tag", "requires_mapping"],
      ["custom", "requires_mapping"],
      ["stage", "requires_mapping"],
      ["alias", "requires_mapping"],
      ["regex", "unsupported"],
      ["hours", "preserved_wait"],
    ]);
    expect(review.items.find(item => item.nodeId === "zero")?.details).toContain("ausência como zero");
    expect(review.items.find(item => item.nodeId === "empty")?.details).toContain("Vazio continua distinto");
    expect(review.items.find(item => item.nodeId === "tag")?.details).toContain("nome não prova identidade");
    expect(review.items.find(item => item.nodeId === "hours")?.details).toContain("pausando");
  });

  it("builds a separate review draft and keeps the legacy source untouched", () => {
    const source = definition([
      condition("text", { field: "company", operator: "contains", value: "Metal" }),
      condition("tag", { field: "tags", operator: "has_tag", value: "VIP" }),
      condition("hours", { conditionMode: "time_window", timeWindow: {
        days: ["seg", "ter"], startTime: "08:00", endTime: "18:00", timezone: "America/Sao_Paulo",
      } }),
    ], [
      { id: "text-yes", source: "text", target: "tag", sourceHandle: "source-true" },
      { id: "text-no", source: "text", target: "hours", sourceHandle: "source-false" },
    ]);
    const snapshot = JSON.stringify(source);

    let nextId = 0;
    const result = buildLegacyConditionReviewDraft(source, () => `new-rule-${++nextId}`);

    expect(JSON.stringify(source)).toBe(snapshot);
    expect(result.definition).not.toBe(source);
    const migratedText = result.definition.nodes.find(node => node.id === "text")!;
    expect(migratedText.data.guidedCondition).toMatchObject({
      id: "new-rule-1", field: "lead.company", operator: "contains", value: "Metal",
    });
    const pendingTag = result.definition.nodes.find(node => node.id === "tag")!;
    expect(pendingTag.data.guidedCondition).toMatchObject({
      field: "lead.tags", operator: "has_tag", tagId: "", tagLabel: "VIP",
    });
    expect(pendingTag.data.legacyConditionReview).toMatchObject({ source: { field: "tags", value: "VIP" } });
    const preservedHours = result.definition.nodes.find(node => node.id === "hours")!;
    expect(preservedHours.data.guidedCondition).toBeUndefined();
    expect(preservedHours.data.conditionMode).toBe("time_window");
    expect(result.definition.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "text-yes", sourceHandle: "yes" }),
      expect.objectContaining({ id: "text-no", sourceHandle: "no" }),
    ]));
    expect(result.definition.nodes.map(node => node.id)).toEqual(["text", "tag", "hours"]);
    expect(new Set(result.definition.nodes.flatMap(node => {
      const guided = node.data.guidedCondition as { id?: string } | undefined;
      return guided?.id ? [guided.id] : [];
    })).size).toBe(2);
  });

  it("never carries name-only references as valid guided identities", () => {
    const source = definition([
      condition("origin", { field: "origin", operator: "equals", value: "Feira" }),
      condition("stage", { field: "stage_id", operator: "equals", value: "same-name-stage" }),
      condition("custom", { field: "custom.Região", operator: "equals", value: "Sul" }),
      condition("alias", { field: "any_responsible", operator: "equals", value: "Ana" }),
    ]);

    const { definition: draft } = buildLegacyConditionReviewDraft(source, (() => {
      let id = 0;
      return () => `rule-${++id}`;
    })());

    expect(JSON.stringify(draft)).not.toContain('"originId":"Feira"');
    expect(JSON.stringify(draft)).not.toContain('"stageId":"same-name-stage"');
    expect(JSON.stringify(draft)).not.toContain('"fieldId":"Região"');
    expect(JSON.stringify(draft)).not.toContain('"memberId":"Ana"');
    expect(draft.nodes.map(node => node.data.guidedCondition)).toEqual([
      expect.objectContaining({ field: "lead.origin", originId: "" }),
      expect.objectContaining({ field: "business.trigger.stage", pipelineId: "", stageId: "" }),
      expect.objectContaining({ field: "lead.custom", fieldId: "", fieldLabel: "Região" }),
      expect.objectContaining({ field: "lead.pre_sale_responsible_id", memberId: "" }),
    ]);
  });
});
