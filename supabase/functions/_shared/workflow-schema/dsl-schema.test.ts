import { assertEquals } from "@std/assert";
import { safeParseSpec } from "./dsl-schema.ts";

const valid = {
  name: "ok",
  trigger: { type: "lead_created", config: { filter_origin: "whatsapp" } },
  steps: [{ kind: "action", actionType: "send_whatsapp", config: { messageTemplate: "oi" } }],
};

Deno.test("safeParseSpec — accepts a well-formed spec", () => {
  const r = safeParseSpec(valid);
  assertEquals(r.ok, true);
});

Deno.test("safeParseSpec — rejects an unknown trigger type", () => {
  const r = safeParseSpec({ ...valid, trigger: { type: "not_a_trigger" } });
  assertEquals(r.ok, false);
});

Deno.test("safeParseSpec — rejects an unknown action type", () => {
  const r = safeParseSpec({
    ...valid,
    steps: [{ kind: "action", actionType: "frobnicate", config: {} }],
  });
  assertEquals(r.ok, false);
});

Deno.test("safeParseSpec — tiered: send_whatsapp without message/template is rejected", () => {
  const r = safeParseSpec({
    ...valid,
    steps: [{ kind: "action", actionType: "send_whatsapp", config: {} }],
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.errors.some((e) => e.includes("send_whatsapp requires")), true);
});

Deno.test("safeParseSpec — tiered: send_to_number with phones + template is accepted", () => {
  const r = safeParseSpec({
    ...valid,
    steps: [{
      kind: "action",
      actionType: "send_to_number",
      config: { notifyPhones: ["5511999998888"], messageTemplate: "Lead {{nome}}" },
    }],
  });
  assertEquals(r.ok, true);
});

Deno.test("safeParseSpec — tiered: send_to_number without notifyPhones is rejected", () => {
  const r = safeParseSpec({
    ...valid,
    steps: [{
      kind: "action",
      actionType: "send_to_number",
      config: { messageTemplate: "Lead {{nome}}" },
    }],
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.errors.some((e) => e.includes("notifyPhones")), true);
});

Deno.test("safeParseSpec — tiered: send_to_number with only blank phones is rejected", () => {
  const r = safeParseSpec({
    ...valid,
    steps: [{
      kind: "action",
      actionType: "send_to_number",
      config: { notifyPhones: ["", "   "], messageTemplate: "oi" },
    }],
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.errors.some((e) => e.includes("notifyPhones")), true);
});

Deno.test("safeParseSpec — tiered: send_to_number without messageTemplate is rejected", () => {
  const r = safeParseSpec({
    ...valid,
    steps: [{
      kind: "action",
      actionType: "send_to_number",
      config: { notifyPhones: ["5511999998888"] },
    }],
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.errors.some((e) => e.includes("send_to_number requires messageTemplate")), true);
});

Deno.test("safeParseSpec — tiered: long-tail action with arbitrary config passes (passthrough)", () => {
  const r = safeParseSpec({
    ...valid,
    steps: [{ kind: "action", actionType: "apply_checklist", config: { whatever: 1 } }],
  });
  assertEquals(r.ok, true);
});

Deno.test("safeParseSpec — split variant weights must sum to 100", () => {
  const r = safeParseSpec({
    ...valid,
    steps: [{
      kind: "split",
      variants: [
        { label: "A", weight: 30, steps: [{ kind: "end" }] },
        { label: "B", weight: 30, steps: [{ kind: "end" }] },
      ],
    }],
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.errors.some((e) => e.includes("sum to 100")), true);
});

Deno.test("safeParseSpec — missing trigger / empty steps rejected", () => {
  assertEquals(safeParseSpec({ name: "x", steps: [] }).ok, false);
  assertEquals(safeParseSpec({ name: "x", trigger: { type: "cron" }, steps: [] }).ok, false);
});

Deno.test("safeParseSpec — nested condition with sub-steps parses", () => {
  const r = safeParseSpec({
    name: "n",
    trigger: { type: "stage_changed" },
    steps: [{
      kind: "condition",
      field: "score",
      operator: "gte",
      value: 80,
      then: [{ kind: "action", actionType: "add_tag", config: { tagName: "Q" } }],
      else: [{ kind: "delay", amount: 2, unit: "days" }],
    }],
  });
  assertEquals(r.ok, true);
});
