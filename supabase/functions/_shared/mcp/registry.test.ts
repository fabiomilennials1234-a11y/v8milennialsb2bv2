import { assertEquals } from "@std/assert";
import { visibleTools } from "./registry.ts";

const tools = [
  { name: "lead.get", readonly: true },
  { name: "blast.status", readonly: true },
  { name: "lead.restore", readonly: false },
  { name: "blast.requeue", readonly: false },
];

Deno.test("visibleTools — hides mutating tools when mutations are OFF", () => {
  const names = visibleTools(tools, { allowMutations: false }).map((t) => t.name);
  assertEquals(names, ["lead.get", "blast.status"]);
});

Deno.test("visibleTools — exposes all tools when mutations are ON", () => {
  const names = visibleTools(tools, { allowMutations: true }).map((t) => t.name);
  assertEquals(names, ["lead.get", "blast.status", "lead.restore", "blast.requeue"]);
});

// --- toolFilter (crm-mcp customer allowlist; non-breaking for torque-mcp) ---

const customerTools = [
  { name: "lead.get", readonly: true, customerExposed: true },
  { name: "db.read_sql", readonly: true }, // readonly but NOT customer-exposed
  { name: "lead.restore", readonly: false, customerExposed: true }, // exposed flag set but mutating
];

const customerFilter = (t: { readonly: boolean; customerExposed?: boolean }) =>
  t.readonly === true && t.customerExposed === true;

Deno.test("visibleTools — toolFilter is applied AFTER the mutations gate (fail-closed allowlist)", () => {
  const names = visibleTools(customerTools, { allowMutations: false, toolFilter: customerFilter })
    .map((t) => t.name);
  // lead.get: readonly + exposed -> visible. db.read_sql: readonly but not exposed -> hidden.
  // lead.restore: exposed but mutating -> dropped by the mutations gate first.
  assertEquals(names, ["lead.get"]);
});

Deno.test("visibleTools — a readonly tool without customerExposed is hidden by the customer filter", () => {
  const names = visibleTools([{ name: "db.read_sql", readonly: true }], {
    allowMutations: false,
    toolFilter: customerFilter,
  }).map((t) => t.name);
  assertEquals(names, []); // fail-closed: default-invisible until opt-in
});

Deno.test("visibleTools — toolFilter can never resurrect a mutating tool even if it matches", () => {
  // A buggy filter that returns true for everything still cannot expose a mutating tool
  // when allowMutations is false — the mutations gate runs first.
  const names = visibleTools(customerTools, { allowMutations: false, toolFilter: () => true })
    .map((t) => t.name);
  assertEquals(names, ["lead.get", "db.read_sql"]); // lead.restore (mutating) stays hidden
});

Deno.test("visibleTools — no toolFilter keeps the exact previous behavior (torque-mcp)", () => {
  const names = visibleTools(tools, { allowMutations: false }).map((t) => t.name);
  assertEquals(names, ["lead.get", "blast.status"]);
});
