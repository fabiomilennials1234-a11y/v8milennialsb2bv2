import { describe, it, expect } from "vitest";
import {
  exportWorkflow,
  validateImportFile,
  prepareImport,
  parseWorkflowFile,
} from "@/lib/workflowPortability";
import { CURRENT_SCHEMA_VERSION } from "@/types/workflowPortability";
import type { Workflow } from "@/types/workflow";
import type { ExportedWorkflowFile } from "@/types/workflowPortability";

// =====================================================
// FIXTURES
// =====================================================

function createMockWorkflow(overrides?: Partial<Workflow>): Workflow {
  return {
    id: "wf-original-id",
    organization_id: "org-123",
    name: "Test Workflow",
    description: "A test workflow",
    is_active: true,
    trigger_type: "stage_changed",
    trigger_config: {
      pipe_type: "whatsapp",
      pipeline_id: "pipeline-org-uuid",
      stages: ["stage-1"],
    },
    loop_limit: 10,
    created_by: "user-uuid-123",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    definition: {
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          position: { x: 400, y: 50 },
          data: {
            type: "trigger",
            triggerType: "stage_changed",
            config: { pipe_type: "whatsapp", pipeline_id: "pipeline-org-uuid", stages: ["stage-1"] },
            label: "Trigger",
          },
        },
        {
          id: "action-1",
          type: "action",
          position: { x: 400, y: 200 },
          data: {
            type: "action",
            actionType: "send_whatsapp",
            label: "Enviar mensagem",
            whatsappInstanceId: "instance-uuid-456",
            whatsappInstanceName: "Instância Principal",
            messageTemplate: "Olá {{nome}}!",
          },
        },
        {
          id: "action-2",
          type: "action",
          position: { x: 400, y: 350 },
          data: {
            type: "action",
            actionType: "assign_sdr",
            label: "Atribuir SDR",
            assigneeId: "member-uuid-789",
            assigneeName: "João Silva",
            assignMode: "specific",
          },
        },
        {
          id: "copilot-1",
          type: "copilot",
          position: { x: 400, y: 500 },
          data: {
            type: "copilot",
            label: "Copilot",
            agentId: "agent-uuid-abc",
            agentName: "Qualificador",
          },
        },
        {
          id: "goto-1",
          type: "goto",
          position: { x: 400, y: 650 },
          data: {
            type: "goto",
            label: "Voltar",
            targetNodeId: "action-1",
            targetNodeLabel: "Enviar mensagem",
          },
        },
        {
          id: "end-1",
          type: "end",
          position: { x: 400, y: 800 },
          data: { type: "end", label: "Fim" },
        },
      ],
      edges: [
        { id: "e1", source: "trigger-1", target: "action-1" },
        { id: "e2", source: "action-1", target: "action-2" },
        { id: "e3", source: "action-2", target: "copilot-1" },
        { id: "e4", source: "copilot-1", target: "goto-1" },
        { id: "e5", source: "goto-1", target: "end-1" },
      ],
    },
    ...overrides,
  } as Workflow;
}

function createValidExportFile(overrides?: Partial<ExportedWorkflowFile>): ExportedWorkflowFile {
  const wf = createMockWorkflow();
  const exported = exportWorkflow(wf, "Test Org");
  return { ...exported, ...overrides };
}

// =====================================================
// EXPORT TESTS
// =====================================================

describe("exportWorkflow", () => {
  it("produces a file with correct schemaVersion", () => {
    const wf = createMockWorkflow();
    const result = exportWorkflow(wf);
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("includes exportedAt timestamp", () => {
    const wf = createMockWorkflow();
    const result = exportWorkflow(wf);
    expect(result.exportedAt).toBeTruthy();
    expect(() => new Date(result.exportedAt)).not.toThrow();
  });

  it("preserves workflow name, description, trigger_type, loop_limit", () => {
    const wf = createMockWorkflow();
    const result = exportWorkflow(wf);
    expect(result.workflow.name).toBe("Test Workflow");
    expect(result.workflow.description).toBe("A test workflow");
    expect(result.workflow.trigger_type).toBe("stage_changed");
    expect(result.workflow.loop_limit).toBe(10);
  });

  it("does NOT export organization_id, created_by, id, timestamps", () => {
    const wf = createMockWorkflow();
    const result = exportWorkflow(wf);
    const json = JSON.stringify(result);
    expect(json).not.toContain("org-123");
    expect(json).not.toContain("user-uuid-123");
    expect(json).not.toContain("wf-original-id");
  });

  it("nullifies whatsappInstanceId in action nodes", () => {
    const wf = createMockWorkflow();
    const result = exportWorkflow(wf);
    const actionNode = result.workflow.definition.nodes.find((n) => n.id === "action-1");
    const data = actionNode!.data as Record<string, unknown>;
    expect(data.whatsappInstanceId).toBeNull();
    expect(data.whatsappInstanceName).toBeNull();
  });

  it("nullifies assigneeId in action nodes", () => {
    const wf = createMockWorkflow();
    const result = exportWorkflow(wf);
    const actionNode = result.workflow.definition.nodes.find((n) => n.id === "action-2");
    const data = actionNode!.data as Record<string, unknown>;
    expect(data.assigneeId).toBeNull();
    expect(data.assigneeName).toBeNull();
  });

  it("nullifies agentId in copilot nodes", () => {
    const wf = createMockWorkflow();
    const result = exportWorkflow(wf);
    const copilotNode = result.workflow.definition.nodes.find((n) => n.id === "copilot-1");
    const data = copilotNode!.data as Record<string, unknown>;
    expect(data.agentId).toBeNull();
    expect(data.agentName).toBeNull();
  });

  it("nullifies pipeline_id in trigger config", () => {
    const wf = createMockWorkflow();
    const result = exportWorkflow(wf);
    const config = result.workflow.trigger_config as Record<string, unknown>;
    expect(config.pipeline_id).toBeNull();
  });

  it("preserves non-org fields (messageTemplate, actionType, positions)", () => {
    const wf = createMockWorkflow();
    const result = exportWorkflow(wf);
    const actionNode = result.workflow.definition.nodes.find((n) => n.id === "action-1");
    const data = actionNode!.data as Record<string, unknown>;
    expect(data.messageTemplate).toBe("Olá {{nome}}!");
    expect(data.actionType).toBe("send_whatsapp");
    expect(actionNode!.position).toEqual({ x: 400, y: 200 });
  });

  it("records all org-specific refs in externalReferences", () => {
    const wf = createMockWorkflow();
    const result = exportWorkflow(wf);
    expect(result.externalReferences.length).toBe(5);
    const types = result.externalReferences.map((r) => r.type);
    expect(types).toContain("whatsapp_instance");
    expect(types).toContain("team_member");
    expect(types).toContain("copilot_agent");
    expect(types).toContain("custom_pipeline");
    expect(types).toContain("pipeline_stage");
  });

  it("includes hints for named references", () => {
    const wf = createMockWorkflow();
    const result = exportWorkflow(wf);
    const whatsappRef = result.externalReferences.find((r) => r.type === "whatsapp_instance");
    expect(whatsappRef!.hint).toBe("Instância Principal");
    const memberRef = result.externalReferences.find((r) => r.type === "team_member");
    expect(memberRef!.hint).toBe("João Silva");
  });

  it("preserves edges unchanged", () => {
    const wf = createMockWorkflow();
    const result = exportWorkflow(wf);
    expect(result.workflow.definition.edges.length).toBe(5);
  });
});

// =====================================================
// VALIDATION TESTS
// =====================================================

describe("validateImportFile", () => {
  it("accepts a valid export file", () => {
    const file = createValidExportFile();
    const result = validateImportFile(file);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects non-object input", () => {
    const result = validateImportFile("not an object");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("não é um objeto JSON");
  });

  it("rejects null input", () => {
    const result = validateImportFile(null);
    expect(result.valid).toBe(false);
  });

  it("rejects array input", () => {
    const result = validateImportFile([1, 2, 3]);
    expect(result.valid).toBe(false);
  });

  it("rejects missing schemaVersion", () => {
    const file = createValidExportFile();
    const { schemaVersion, ...noVersion } = file;
    const result = validateImportFile(noVersion);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("schemaVersion");
  });

  it("rejects incompatible schemaVersion", () => {
    const file = createValidExportFile({ schemaVersion: "99.0" });
    const result = validateImportFile(file);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("incompatível");
  });

  it("rejects missing workflow block", () => {
    const result = validateImportFile({ schemaVersion: CURRENT_SCHEMA_VERSION });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("workflow"))).toBe(true);
  });

  it("rejects missing workflow.name", () => {
    const file = createValidExportFile();
    (file.workflow as any).name = undefined;
    const result = validateImportFile(file);
    expect(result.valid).toBe(false);
  });

  it("rejects missing definition.nodes", () => {
    const file = createValidExportFile();
    (file.workflow.definition as any).nodes = "not-array";
    const result = validateImportFile(file);
    expect(result.valid).toBe(false);
  });
});

// =====================================================
// IMPORT TESTS
// =====================================================

describe("prepareImport", () => {
  it("generates new IDs for all nodes (never reuses source IDs)", () => {
    const file = createValidExportFile();
    const originalIds = file.workflow.definition.nodes.map((n) => n.id);
    const { workflowInsert } = prepareImport(file);
    const newIds = workflowInsert.definition.nodes.map((n) => n.id);

    for (const newId of newIds) {
      expect(originalIds).not.toContain(newId);
    }
    expect(new Set(newIds).size).toBe(newIds.length);
  });

  it("remaps edge source and target to new node IDs", () => {
    const file = createValidExportFile();
    const { workflowInsert } = prepareImport(file);
    const nodeIds = new Set(workflowInsert.definition.nodes.map((n) => n.id));

    for (const edge of workflowInsert.definition.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });

  it("remaps goto targetNodeId to new node ID", () => {
    const file = createValidExportFile();
    const { workflowInsert } = prepareImport(file);
    const gotoNode = workflowInsert.definition.nodes.find(
      (n) => (n.data as Record<string, unknown>).type === "goto",
    );
    expect(gotoNode).toBeDefined();
    const data = gotoNode!.data as Record<string, unknown>;
    const actionNode = workflowInsert.definition.nodes.find(
      (n) => (n.data as Record<string, unknown>).actionType === "send_whatsapp",
    );
    expect(data.targetNodeId).toBe(actionNode!.id);
  });

  it("creates workflow with is_active: false", () => {
    const file = createValidExportFile();
    const { workflowInsert, report } = prepareImport(file);
    expect(workflowInsert.is_active).toBe(false);
    expect(report.mode).toBe("legacy_inactive");
  });

  it("appends '(importado)' to name", () => {
    const file = createValidExportFile();
    const { workflowInsert } = prepareImport(file);
    expect(workflowInsert.name).toContain("(importado)");
  });

  it("generates new edge IDs", () => {
    const file = createValidExportFile();
    const originalEdgeIds = file.workflow.definition.edges.map((e) => e.id);
    const { workflowInsert } = prepareImport(file);
    for (const edge of workflowInsert.definition.edges) {
      expect(originalEdgeIds).not.toContain(edge.id);
    }
  });

  it("reports unresolved external references as pending", () => {
    const file = createValidExportFile();
    const { report } = prepareImport(file);
    expect(report.unresolvedCount).toBeGreaterThan(0);
    const pendingItems = report.items.filter((i) => i.status === "pending");
    expect(pendingItems.length).toBe(report.unresolvedCount);
  });

  it("includes success items for nodes and edges", () => {
    const file = createValidExportFile();
    const { report } = prepareImport(file);
    const successItems = report.items.filter((i) => i.status === "success");
    expect(successItems.length).toBeGreaterThan(0);
    expect(successItems.some((i) => i.message.includes("nós importados"))).toBe(true);
    expect(successItems.some((i) => i.message.includes("conexões importadas"))).toBe(true);
  });

  it("includes warning about inactive state", () => {
    const file = createValidExportFile();
    const { report } = prepareImport(file);
    const warningItems = report.items.filter((i) => i.status === "warning");
    expect(warningItems.some((i) => i.message.includes("INATIVO"))).toBe(true);
  });
});

// =====================================================
// PARSE/VALIDATE FILE
// =====================================================

describe("parseWorkflowFile", () => {
  it("parses valid JSON string", () => {
    const file = createValidExportFile();
    const json = JSON.stringify(file);
    const { data, error } = parseWorkflowFile(json);
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("rejects invalid JSON", () => {
    const { data, error } = parseWorkflowFile("not json {{{");
    expect(data).toBeNull();
    expect(error).toContain("JSON inválido");
  });

  it("rejects valid JSON with invalid structure", () => {
    const { data, error } = parseWorkflowFile(JSON.stringify({ foo: "bar" }));
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });
});

// =====================================================
// ROUND-TRIP TEST
// =====================================================

describe("round-trip: export → import", () => {
  it("preserves workflow structure through export+import cycle", () => {
    const original = createMockWorkflow();
    const exported = exportWorkflow(original, "Org A");
    const { workflowInsert } = prepareImport(exported);

    expect(workflowInsert.definition.nodes.length).toBe(original.definition.nodes.length);
    expect(workflowInsert.definition.edges.length).toBe(original.definition.edges.length);

    const originalTypes = original.definition.nodes.map((n) => (n.data as any).type);
    const importedTypes = workflowInsert.definition.nodes.map((n) => (n.data as any).type);
    expect(importedTypes).toEqual(originalTypes);

    expect(workflowInsert.trigger_type).toBe(original.trigger_type);
  });

  it("never leaks source org IDs into import", () => {
    const original = createMockWorkflow();
    const exported = exportWorkflow(original);
    const { workflowInsert } = prepareImport(exported);

    const json = JSON.stringify(workflowInsert);

    // None of the org-specific UUIDs should appear anywhere
    expect(json).not.toContain("instance-uuid-456");
    expect(json).not.toContain("member-uuid-789");
    expect(json).not.toContain("agent-uuid-abc");
    expect(json).not.toContain("pipeline-org-uuid");
    expect(json).not.toContain("org-123");
  });

  it("exports every nested guided reference as pending and remaps all condition ids", () => {
    const sourceIds = {
      tag: "11111111-1111-4111-8111-111111111111",
      origin: "22222222-2222-4222-8222-222222222222",
      member: "33333333-3333-4333-8333-333333333333",
      custom: "44444444-4444-4444-8444-444444444444",
      pipeline: "55555555-5555-4555-8555-555555555555",
      stage: "66666666-6666-4666-8666-666666666666",
      box: "77777777-7777-4777-8777-777777777777",
      product: "88888888-8888-4888-8888-888888888888",
    };
    const condition = { version: 1, id: "root-source", kind: "group", match: "all", children: [
      { version: 1, id: "tag-source", field: "lead.tags", operator: "has_tag", tagId: sourceIds.tag, tagLabel: "VIP" },
      { version: 1, id: "origin-source", field: "lead.origin", operator: "equals", originId: sourceIds.origin, originLabel: "Feira" },
      { version: 1, id: "member-source", field: "lead.sale_responsible_id", operator: "equals", memberId: sourceIds.member, memberLabel: "Ana" },
      { version: 1, id: "custom-source", field: "lead.custom", fieldId: sourceIds.custom, fieldType: "select", fieldLabel: "Região", operator: "equals", value: "Sul" },
      { version: 1, id: "stage-source", field: "business.trigger.stage", operator: "equals", pipelineId: sourceIds.pipeline, stageId: sourceIds.stage, pipelineLabel: "Comercial", stageLabel: "Proposta" },
      { version: 1, id: "exists-source", kind: "business_exists", lifecycle: "open", match: "all", children: [
        { version: 1, id: "exists-stage-source", field: "business.stage", operator: "equals", pipelineId: sourceIds.pipeline, stageId: sourceIds.stage, pipelineLabel: "Comercial", stageLabel: "Proposta" },
      ] },
      { version: 1, id: "message-source", field: "message.search.text", conversation: { kind: "explicit", storage: "whatsapp_messages", boxId: sourceIds.box, provider: "uazapi", boxLabel: "Comercial" }, source: { kind: "last_received" }, operator: "matches", expressionMatch: "any", matchMode: "whole_phrase", expressions: ["preço"] },
      { version: 1, id: "product-source", field: "product.relationship", relation: "lead_association", productId: sourceIds.product, productLabel: "Motor", operator: "has_product" },
    ] };
    const original = createMockWorkflow({ definition: { nodes: [
      createMockWorkflow().definition.nodes[0],
      { id: "condition-source", type: "condition", position: { x: 400, y: 200 },
        data: { type: "condition", label: "Segmentação", field: "", operator: "equals", value: "", guidedCondition: condition } as any },
    ], edges: [] } });
    const exported = exportWorkflow(original, "Org A");
    const exportedDefinition = JSON.stringify(exported.workflow.definition);
    for (const id of Object.values(sourceIds)) expect(exportedDefinition).not.toContain(id);
    expect(new Set(exported.externalReferences.map(ref => ref.type))).toEqual(new Set([
      "tag", "origin", "team_member", "custom_field", "custom_option", "custom_pipeline",
      "pipeline_stage", "whatsapp_instance", "product",
    ]));

    const { workflowInsert, report } = prepareImport(exported);
    expect(report.mode).toBe("guided_draft");
    const importedDefinition = JSON.stringify(workflowInsert.definition);
    for (const id of Object.values(sourceIds)) expect(importedDefinition).not.toContain(id);
    const imported = (workflowInsert.definition.nodes.find(node => node.type === "condition")!.data as any).guidedCondition;
    const collect = (item: any): string[] => [item.id, ...(Array.isArray(item.children) ? item.children.flatMap(collect) : [])];
    const importedIds = collect(imported);
    expect(new Set(importedIds).size).toBe(importedIds.length);
    expect(importedIds).not.toEqual(expect.arrayContaining(collect(condition)));
    expect(imported.children[0]).toMatchObject({ field: "lead.tags", tagId: "" });
    expect(imported.children[3]).toMatchObject({ field: "lead.custom", fieldId: "", value: "" });
    expect(imported.children[4]).toMatchObject({ pipelineId: "", stageId: "" });
    expect(imported.children[6].conversation).toMatchObject({ kind: "explicit", boxId: "", provider: "" });
    expect(imported.children[7]).toMatchObject({ productId: "" });
    expect(report.unresolvedCount).toBe(exported.externalReferences.length);
  });

  it("sanitizes source references even when a crafted import bypasses export", () => {
    const file = createValidExportFile();
    const sourceTag = "99999999-9999-4999-8999-999999999999";
    file.externalReferences = [];
    file.workflow.definition.nodes.push({ id: "crafted-condition", type: "condition", position: { x: 0, y: 0 },
      data: { type: "condition", label: "Tag", guidedCondition: { version: 1, id: "crafted-rule",
        field: "lead.tags", operator: "has_tag", tagId: sourceTag, tagLabel: "Origem" } } as any });
    const { workflowInsert, report } = prepareImport(file);
    expect(JSON.stringify(workflowInsert)).not.toContain(sourceTag);
    expect(report.unresolvedCount).toBeGreaterThan(0);
    expect(report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "pending", message: expect.stringContaining("tag") }),
    ]));
  });

  it.each([
    ["message.trigger.text", { operator: "contains", value: "preço" }],
    ["message.period.exists", { operator: "exists", from: "2026-09-01", to: "2026-09-02" }],
    ["message.search.text", { source: { kind: "last_received" }, operator: "matches",
      expressionMatch: "any", matchMode: "whole_phrase", expressions: ["preço"] }],
    ["message.waiting.elapsed", { waitingFor: "lead", operator: "greater_than", value: 2, unit: "hours" }],
  ])("requires explicit inbox remapping for %s", (field, rest) => {
    const boxId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const original = createMockWorkflow({ definition: { nodes: [
      createMockWorkflow().definition.nodes[0],
      { id: "condition-message", type: "condition", position: { x: 0, y: 0 }, data: { type: "condition", label: "Mensagem",
        guidedCondition: { version: 1, id: "message-rule", field, conversation: {
          kind: "explicit", storage: "whatsapp_messages", boxId, provider: "uazapi", boxLabel: "Comercial",
        }, ...rest } } as any },
    ], edges: [] } });
    const exported = exportWorkflow(original);
    const rule = (exported.workflow.definition.nodes[1].data as any).guidedCondition;
    expect(rule.conversation).toEqual({ kind: "explicit", storage: "whatsapp_messages", boxId: "", provider: "" });
    expect(exported.externalReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "whatsapp_instance", originalValue: boxId, hint: "Comercial" }),
    ]));
  });

  it("preserves reference-free nested meaning in a same-organization round-trip", () => {
    const condition = { version: 1, id: "group", kind: "group", match: "any", children: [
      { version: 1, id: "name", field: "lead.name", operator: "contains", value: "indústria" },
      { version: 1, id: "follow-up", field: "activity.follow_up", relation: "lead", state: "pending",
        operator: "not_exists", dateOperator: "on_or_before", date: "2026-09-30" },
    ] };
    const original = createMockWorkflow({ definition: { nodes: [
      createMockWorkflow().definition.nodes[0],
      { id: "condition", type: "condition", position: { x: 10, y: 20 },
        data: { type: "condition", label: "Qualificação", guidedCondition: condition } as any },
    ], edges: [] } });
    const { workflowInsert, report } = prepareImport(exportWorkflow(original));
    const imported = (workflowInsert.definition.nodes.find(node => node.type === "condition")!.data as any).guidedCondition;
    expect(imported).toMatchObject({ kind: "group", match: "any", children: [
      { field: "lead.name", operator: "contains", value: "indústria" },
      { field: "activity.follow_up", relation: "lead", state: "pending", operator: "not_exists",
        dateOperator: "on_or_before", date: "2026-09-30" },
    ] });
    expect(report.unresolvedCount).toBe(2); // trigger pipeline and stage from the base fixture
  });
});
