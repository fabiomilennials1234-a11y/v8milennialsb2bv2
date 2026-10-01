import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { auditParams, buildDiagnosisPlan, validateDiagnosis } from "./support.ts";

const TICKET = "5d1a1102-cccc-0000-0000-000000001102";

function valid(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ticket_id: TICKET,
    kind: "fix",
    complexity: "baixa",
    summary: "Mover etapa em funil personalizado não dispara o evento.",
    root_cause: "SET stage_id sem stage_key — trigger é UPDATE OF stage_key.",
    customer_reply: "Achamos a causa e já estamos corrigindo.",
    recommended_model: "sonnet",
    recommended_effort: "medium",
    resolution_prompt: "x".repeat(80),
    keystones: [{ label: "teste do hook passa", verify: "npx vitest run useMoveCard" }],
    estimated_cost_usd: 1.234,
    ...over,
  };
}

Deno.test("validateDiagnosis — accepts a full payload and normalizes it", () => {
  const v = validateDiagnosis(valid({ summary: "  Mover etapa não dispara o evento.  " }));
  assert(v.ok);
  assertEquals(v.record.summary, "Mover etapa não dispara o evento.");
  assertEquals(v.record.estimated_cost_usd, 1.23);
  assertEquals(v.record.template_version, 1);
});

Deno.test("validateDiagnosis — fix without root_cause is refused", () => {
  const v = validateDiagnosis(valid({ root_cause: "" }));
  assert(!v.ok);
  assert(v.errors.some((e) => e.startsWith("root_cause is required")));
});

Deno.test("validateDiagnosis — duvida may omit root_cause", () => {
  const v = validateDiagnosis(valid({ kind: "duvida", root_cause: undefined }));
  assert(v.ok);
  assertEquals(v.record.root_cause, null);
});

Deno.test("validateDiagnosis — reports every problem at once", () => {
  const v = validateDiagnosis({
    ticket_id: "nope",
    kind: "bug",
    complexity: "enorme",
    summary: "curto",
    recommended_model: "gpt-4.1-mini",
    recommended_effort: "ultra",
    resolution_prompt: "pouco",
    keystones: [],
  });
  assert(!v.ok);
  assertEquals(v.errors.length, 8);
});

Deno.test("validateDiagnosis — a keystone without verify is refused", () => {
  const v = validateDiagnosis(valid({ keystones: [{ label: "funciona" }] }));
  assert(!v.ok);
  assert(v.errors.some((e) => e.includes("keystones[0].verify")));
});

Deno.test("validateDiagnosis — more than 15 keystones is refused", () => {
  const many = Array.from({ length: 16 }, (_, i) => ({ label: `k${i}`, verify: "true" }));
  assert(!validateDiagnosis(valid({ keystones: many })).ok);
});

Deno.test("buildDiagnosisPlan — binds the exact payload via sha256", async () => {
  const a = validateDiagnosis(valid());
  const b = validateDiagnosis(valid({ resolution_prompt: "y".repeat(80) }));
  assert(a.ok && b.ok);
  const ticket = { title: "Kanban", organization_id: "org-1", status: "aberto" };
  const pa = await buildDiagnosisPlan(a.record, ticket, false);
  const pb = await buildDiagnosisPlan(b.record, ticket, false);
  assertEquals(pa.action, "insert_diagnosis");
  assertEquals(pa.route, "sonnet / medium");
  // Same size, different content: only the hash tells them apart.
  assertEquals(pa.prompt_chars, pb.prompt_chars);
  assertNotEquals(pa.payload_sha256, pb.payload_sha256);
});

Deno.test("buildDiagnosisPlan — existing diagnosis becomes a replace", async () => {
  const v = validateDiagnosis(valid());
  assert(v.ok);
  const plan = await buildDiagnosisPlan(
    v.record,
    { title: "t", organization_id: "o", status: "s" },
    true,
  );
  assertEquals(plan.action, "replace_diagnosis");
});

Deno.test("auditParams — keeps the routing, drops the long bodies", () => {
  const v = validateDiagnosis(valid());
  assert(v.ok);
  const p = auditParams(v.record);
  assertEquals(p.resolution_prompt, "[80 chars]");
  assertEquals(p.recommended_model, "sonnet");
  assertEquals(String(p.summary).startsWith("["), true);
});
