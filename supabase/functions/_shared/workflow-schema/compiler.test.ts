import { assertEquals } from "@std/assert";
import { compileWorkflow } from "./compiler.ts";

Deno.test("compileWorkflow — tracer: trigger + one action → trigger node, action node, one edge", () => {
  const compiled = compileWorkflow({
    name: "Boas-vindas",
    trigger: { type: "lead_created", config: { filter_origin: "whatsapp" } },
    steps: [
      { kind: "action", actionType: "send_whatsapp", config: { messageTemplate: "Oi!" } },
    ],
  });

  assertEquals(compiled.name, "Boas-vindas");
  assertEquals(compiled.trigger_type, "lead_created");
  assertEquals(compiled.trigger_config, { filter_origin: "whatsapp" });
  assertEquals(compiled.loop_limit, 100); // default

  const { nodes, edges } = compiled.definition;
  assertEquals(nodes.length, 2);
  assertEquals(edges.length, 1);

  assertEquals(nodes[0].id, "trigger-1");
  assertEquals(nodes[0].type, "trigger");
  assertEquals(nodes[0].data, {
    type: "trigger",
    triggerType: "lead_created",
    config: { filter_origin: "whatsapp" },
    label: "lead_created",
  });

  assertEquals(nodes[1].id, "action-2");
  assertEquals(nodes[1].type, "action");
  assertEquals(nodes[1].data, {
    type: "action",
    actionType: "send_whatsapp",
    label: "send_whatsapp",
    messageTemplate: "Oi!",
  });

  assertEquals(edges[0], {
    id: "trigger-1__main__action-2",
    source: "trigger-1",
    target: "action-2",
  });
});

Deno.test("compileWorkflow — condition then/else re-converge to the continuation, yes/no handles", () => {
  const { definition } = compileWorkflow({
    name: "Qualifica",
    trigger: { type: "lead_created" },
    steps: [
      {
        kind: "condition",
        field: "qualification_score",
        operator: "gte",
        value: 80,
        then: [{ kind: "action", actionType: "add_tag", config: { tagName: "Quente" } }],
        else: [{ kind: "action", actionType: "add_tag", config: { tagName: "Frio" } }],
      },
      { kind: "action", actionType: "send_whatsapp", config: { messageTemplate: "oi" } },
    ],
  });

  const ids = definition.nodes.map((n) => `${n.id}:${n.type}`);
  // pre-order DFS, branch order then→else, continuation last
  assertEquals(ids, [
    "trigger-1:trigger",
    "condition-2:condition",
    "action-3:action",
    "action-4:action",
    "action-5:action",
  ]);

  const cond = definition.nodes[1];
  assertEquals(cond.data, {
    type: "condition",
    field: "qualification_score",
    operator: "gte",
    value: 80,
    label: "condition",
  });

  // helper: find edge source→target and its handle
  const e = (s: string, t: string) =>
    definition.edges.find((x) => x.source === s && x.target === t);
  assertEquals(e("trigger-1", "condition-2")?.sourceHandle, undefined);
  assertEquals(e("condition-2", "action-3")?.sourceHandle, "yes"); // then
  assertEquals(e("condition-2", "action-4")?.sourceHandle, "no"); // else
  assertEquals(e("action-3", "action-5")?.sourceHandle, undefined); // then-tail → continuation
  assertEquals(e("action-4", "action-5")?.sourceHandle, undefined); // else-tail → continuation
  assertEquals(definition.edges.length, 5);
});

Deno.test("compileWorkflow — wait_response (replied/timeout) and split (variant handles)", () => {
  const { definition } = compileWorkflow({
    name: "Cadência",
    trigger: { type: "lead_created" },
    steps: [
      {
        kind: "wait_response",
        timeoutHours: 24,
        channel: "whatsapp",
        replied: [{ kind: "action", actionType: "add_tag", config: { tagName: "Respondeu" } }],
        timeout: [{ kind: "action", actionType: "add_tag", config: { tagName: "Silêncio" } }],
      },
    ],
  });
  const e = (s: string, t: string) =>
    definition.edges.find((x) => x.source === s && x.target === t);
  // trigger-1 → wait_response-2 ; replied → action-3 ; timeout → action-4
  assertEquals(definition.nodes.map((n) => n.type), [
    "trigger",
    "wait_response",
    "action",
    "action",
  ]);
  assertEquals(e("wait_response-2", "action-3")?.sourceHandle, "replied");
  assertEquals(e("wait_response-2", "action-4")?.sourceHandle, "timeout");
});

Deno.test("compileWorkflow — split emits split_ab node with variant ids and variant_<id> handles", () => {
  const { definition } = compileWorkflow({
    name: "Teste A/B",
    trigger: { type: "lead_created" },
    steps: [
      {
        kind: "split",
        variants: [
          {
            label: "A",
            weight: 50,
            steps: [{
              kind: "action",
              actionType: "send_whatsapp",
              config: { messageTemplate: "A" },
            }],
          },
          {
            label: "B",
            weight: 50,
            steps: [{
              kind: "action",
              actionType: "send_whatsapp",
              config: { messageTemplate: "B" },
            }],
          },
        ],
      },
    ],
  });
  const split = definition.nodes.find((n) => n.type === "split_ab")!;
  assertEquals(split.data.variants, [
    { id: "v1", label: "A", percentage: 50 },
    { id: "v2", label: "B", percentage: 50 },
  ]);
  const handles = definition.edges.filter((x) => x.source === split.id).map((x) => x.sourceHandle)
    .sort();
  assertEquals(handles, ["variant_v1", "variant_v2"]);
});
