import { assertEquals } from "@std/assert";
import { compileWorkflow } from "../../_shared/workflow-schema/index.ts";
import {
  buildCreatePlan,
  buildDiff,
  buildEditPlan,
  buildSetActivePlan,
  clampLoopLimit,
  decideActive,
  extractTriggerFromDefinition,
  resolveBuildMode,
  summarizeDefinition,
} from "./workflow.ts";

const sample = compileWorkflow({
  name: "Boas-vindas",
  trigger: { type: "lead_created", config: { filter_origin: "whatsapp" } },
  steps: [{ kind: "action", actionType: "send_whatsapp", config: { messageTemplate: "oi" } }],
});
const okValidation = { ok: true, errors: [] };

Deno.test("resolveBuildMode — create / edit / both / neither", () => {
  assertEquals(resolveBuildMode({ org_id: "o" }), { mode: "create", orgId: "o" });
  assertEquals(resolveBuildMode({ workflow_id: "w" }), { mode: "edit", workflowId: "w" });
  assertEquals(resolveBuildMode({ org_id: "o", workflow_id: "w" }).mode, "error");
  assertEquals(resolveBuildMode({}).mode, "error");
});

Deno.test("clampLoopLimit — default 100, cap 500, rejects junk", () => {
  assertEquals(clampLoopLimit(undefined), 100);
  assertEquals(clampLoopLimit(0), 100);
  assertEquals(clampLoopLimit("nope"), 100);
  assertEquals(clampLoopLimit(50), 50);
  assertEquals(clampLoopLimit(9999), 500);
});

Deno.test("decideActive — inactive-by-default on create, preserve on edit, explicit wins", () => {
  assertEquals(decideActive({ branch: "create", activate: undefined }), false);
  assertEquals(decideActive({ branch: "create", activate: true }), true);
  assertEquals(decideActive({ branch: "edit", activate: undefined, current: true }), true);
  assertEquals(decideActive({ branch: "edit", activate: undefined, current: false }), false);
  assertEquals(decideActive({ branch: "edit", activate: false, current: true }), false);
});

Deno.test("summarizeDefinition — counts + trigger extraction", () => {
  const s = summarizeDefinition(sample.definition);
  assertEquals(s.node_count, 2);
  assertEquals(s.nodes_by_type, { trigger: 1, action: 1 });
  assertEquals(s.edge_count, 1);
  assertEquals(s.trigger, { trigger_type: "lead_created", config_keys: ["filter_origin"] });
});

Deno.test("summarizeDefinition — empty definition → zeros, trigger null", () => {
  const s = summarizeDefinition({ nodes: [], edges: [] });
  assertEquals(s, { node_count: 0, nodes_by_type: {}, edge_count: 0, trigger: null });
});

Deno.test("extractTriggerFromDefinition — pulls type + config; null when absent", () => {
  assertEquals(extractTriggerFromDefinition(sample.definition), {
    trigger_type: "lead_created",
    trigger_config: { filter_origin: "whatsapp" },
  });
  assertEquals(extractTriggerFromDefinition({ nodes: [], edges: [] }), null);
});

Deno.test("buildCreatePlan — inactive default, insert carries org + compiled row", () => {
  const plan = buildCreatePlan({
    orgId: "org-1",
    orgName: "Acme",
    row: {
      name: sample.name,
      description: null,
      trigger_type: sample.trigger_type,
      trigger_config: sample.trigger_config,
      definition: sample.definition,
      loop_limit: 100,
      is_active: false,
    },
    summary: summarizeDefinition(sample.definition),
    validation: okValidation,
  });
  assertEquals(plan.action, "create_workflow");
  assertEquals(plan.organization_id, "org-1");
  assertEquals(plan.is_active, false);
  assertEquals(plan.insert.organization_id, "org-1");
  assertEquals(plan.insert.trigger_type, "lead_created");
});

Deno.test("buildEditPlan — diff reflects node/trigger/active changes", () => {
  const next = compileWorkflow({
    name: "Renomeado",
    trigger: { type: "stage_changed" },
    steps: [
      { kind: "action", actionType: "add_tag", config: { tagName: "X" } },
      { kind: "action", actionType: "send_whatsapp", config: { messageTemplate: "y" } },
    ],
  });
  const plan = buildEditPlan({
    current: {
      id: "wf-1",
      organization_id: "org-1",
      name: "Boas-vindas",
      is_active: true,
      definition: sample.definition,
    },
    row: {
      name: next.name,
      description: null,
      trigger_type: next.trigger_type,
      trigger_config: next.trigger_config,
      definition: next.definition,
      loop_limit: 100,
      is_active: true,
    },
    summary: summarizeDefinition(next.definition),
    validation: okValidation,
  });
  assertEquals(plan.workflow_id, "wf-1");
  assertEquals(plan.organization_id, "org-1"); // from current, not args
  assertEquals(plan.diff.name.changed, true);
  assertEquals(plan.diff.trigger, { old: "lead_created", new: "stage_changed", changed: true });
  assertEquals(plan.diff.nodes, { old: 2, new: 3 });
  assertEquals(plan.was_active, true);
});

Deno.test("buildDiff — no changes → all changed flags false", () => {
  const diff = buildDiff(
    { name: "A", is_active: false, definition: sample.definition },
    {
      name: "A",
      is_active: false,
      summary: summarizeDefinition(sample.definition),
      trigger_type: "lead_created",
    },
  );
  assertEquals(diff.name.changed, false);
  assertEquals(diff.trigger.changed, false);
  assertEquals(diff.is_active.changed, false);
});

Deno.test("buildSetActivePlan — from/to + no_op detection", () => {
  assertEquals(
    buildSetActivePlan({ id: "w", organization_id: "o", name: "n", is_active: false }, true),
    {
      action: "set_active",
      workflow_id: "w",
      organization_id: "o",
      name: "n",
      from: false,
      to: true,
      no_op: false,
    },
  );
  assertEquals(
    buildSetActivePlan({ id: "w", organization_id: "o", name: "n", is_active: true }, true).no_op,
    true,
  );
});
