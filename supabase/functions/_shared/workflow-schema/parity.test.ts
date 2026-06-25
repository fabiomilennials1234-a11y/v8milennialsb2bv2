/**
 * Drift guard: the enums here are PORTED from the frontend's `src/types/workflow.ts`
 * (Deno can't import that file). This test reads that file's text and asserts the ported
 * arrays match the union members exactly — so a new node/trigger/action type added on the
 * frontend fails CI here until it is ported (docs/adr/0013).
 */
import { assertEquals } from "@std/assert";
import { ACTION_TYPES, NODE_TYPES, TRIGGER_TYPES } from "./enums.ts";

const src = await Deno.readTextFile(
  new URL("../../../../src/types/workflow.ts", import.meta.url),
);

/** Extract the string-literal members of `export type <name> = | "a" | "b" ...;`. */
function unionMembers(typeName: string): string[] {
  const re = new RegExp(`export type ${typeName}\\s*=([\\s\\S]*?);`, "m");
  const m = re.exec(src);
  if (!m) throw new Error(`type ${typeName} not found in src/types/workflow.ts`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

Deno.test("parity — NODE_TYPES matches WorkflowNodeType in the frontend", () => {
  assertEquals([...NODE_TYPES].sort(), unionMembers("WorkflowNodeType").sort());
});

Deno.test("parity — TRIGGER_TYPES matches WorkflowTriggerType in the frontend", () => {
  assertEquals([...TRIGGER_TYPES].sort(), unionMembers("WorkflowTriggerType").sort());
});

Deno.test("parity — ACTION_TYPES matches WorkflowActionType in the frontend", () => {
  assertEquals([...ACTION_TYPES].sort(), unionMembers("WorkflowActionType").sort());
});
