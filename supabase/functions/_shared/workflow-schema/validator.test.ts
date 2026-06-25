import { assertEquals } from "@std/assert";
import { validateWorkflow } from "./validator.ts";
import { compileWorkflow } from "./compiler.ts";
import type { WorkflowDefinition } from "./definition.ts";

const codes = (d: WorkflowDefinition) => validateWorkflow(d).errors.map((e) => e.code).sort();

Deno.test("validateWorkflow — a compiled valid workflow passes", () => {
  const { definition } = compileWorkflow({
    name: "ok",
    trigger: { type: "lead_created" },
    steps: [
      {
        kind: "condition",
        field: "x",
        operator: "eq",
        value: 1,
        then: [{ kind: "action", actionType: "add_tag", config: { tagName: "A" } }],
        else: [{ kind: "action", actionType: "add_tag", config: { tagName: "B" } }],
      },
      { kind: "action", actionType: "send_whatsapp", config: { messageTemplate: "oi" } },
    ],
  });
  assertEquals(validateWorkflow(definition), { ok: true, errors: [] });
});

Deno.test("validateWorkflow — no trigger → error", () => {
  const r = validateWorkflow({ nodes: [{ id: "a", type: "action", data: {} }], edges: [] });
  assertEquals(r.ok, false);
  assertEquals(r.errors.some((e) => e.code === "no_trigger"), true);
});

Deno.test("validateWorkflow — two triggers → error", () => {
  const d: WorkflowDefinition = {
    nodes: [{ id: "t1", type: "trigger", data: {} }, { id: "t2", type: "trigger", data: {} }],
    edges: [],
  };
  assertEquals(codes(d).includes("multiple_triggers"), true);
});

Deno.test("validateWorkflow — trigger with an incoming edge → error", () => {
  const d: WorkflowDefinition = {
    nodes: [{ id: "t", type: "trigger", data: {} }, { id: "a", type: "action", data: {} }],
    edges: [
      { id: "t__main__a", source: "t", target: "a" },
      { id: "a__main__t", source: "a", target: "t" }, // back into trigger
    ],
  };
  assertEquals(codes(d).includes("trigger_has_incoming"), true);
});

Deno.test("validateWorkflow — dangling edge → error", () => {
  const d: WorkflowDefinition = {
    nodes: [{ id: "t", type: "trigger", data: {} }],
    edges: [{ id: "t__main__ghost", source: "t", target: "ghost" }],
  };
  assertEquals(codes(d).includes("dangling_edge"), true);
});

Deno.test("validateWorkflow — duplicate node id → error", () => {
  const d: WorkflowDefinition = {
    nodes: [{ id: "t", type: "trigger", data: {} }, { id: "a", type: "action", data: {} }, {
      id: "a",
      type: "action",
      data: {},
    }],
    edges: [{ id: "t__main__a", source: "t", target: "a" }],
  };
  assertEquals(codes(d).includes("duplicate_node_id"), true);
});

Deno.test("validateWorkflow — unreachable node → error", () => {
  const d: WorkflowDefinition = {
    nodes: [
      { id: "t", type: "trigger", data: {} },
      { id: "a", type: "action", data: {} },
      { id: "orphan", type: "action", data: {} },
    ],
    edges: [{ id: "t__main__a", source: "t", target: "a" }],
  };
  assertEquals(codes(d).includes("unreachable_node"), true);
});

Deno.test("validateWorkflow — hot cycle (no delay/wait) → warning, still ok", () => {
  const d: WorkflowDefinition = {
    nodes: [
      { id: "t", type: "trigger", data: {} },
      { id: "a1", type: "action", data: {} },
      { id: "a2", type: "action", data: {} },
    ],
    edges: [
      { id: "t__main__a1", source: "t", target: "a1" },
      { id: "a1__main__a2", source: "a1", target: "a2" },
      { id: "a2__main__a1", source: "a2", target: "a1" }, // cycle a1↔a2, no pause
    ],
  };
  const r = validateWorkflow(d);
  assertEquals(r.ok, true); // warning does not block
  assertEquals(r.errors.some((e) => e.code === "hot_cycle" && e.severity === "warning"), true);
});

Deno.test("validateWorkflow — cycle WITH a wait node → no hot_cycle warning", () => {
  const d: WorkflowDefinition = {
    nodes: [
      { id: "t", type: "trigger", data: {} },
      { id: "w", type: "wait_response", data: {} },
      { id: "a", type: "action", data: {} },
    ],
    edges: [
      { id: "t__main__w", source: "t", target: "w" },
      { id: "w__replied__a", source: "w", target: "a", sourceHandle: "replied" },
      { id: "a__main__w", source: "a", target: "w" }, // cycle w↔a, but w pauses
    ],
  };
  assertEquals(validateWorkflow(d).errors.some((e) => e.code === "hot_cycle"), false);
});
