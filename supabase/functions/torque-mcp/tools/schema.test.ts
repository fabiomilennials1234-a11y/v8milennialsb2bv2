import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildDefinerAuditQuery,
  buildTriggerAuditQuery,
  type DefinerRow,
  isDefinerRisk,
  isTriggerRisk,
  type TriggerRow,
} from "./schema.ts";

Deno.test("buildDefinerAuditQuery — selects definer functions, read-only", () => {
  const sql = buildDefinerAuditQuery();
  assertStringIncludes(sql, "p.prosecdef = true");
  assertStringIncludes(sql, "search_path=");
  assertEquals(/^select\s/i.test(sql), true);
});

Deno.test("isDefinerRisk — unpinned search_path is a risk", () => {
  const row: DefinerRow = { function_name: "f", args: "", pins_search_path: false };
  assertEquals(isDefinerRisk(row), true);
});

Deno.test("isDefinerRisk — pinned search_path is safe", () => {
  const row: DefinerRow = { function_name: "f", args: "a integer", pins_search_path: true };
  assertEquals(isDefinerRisk(row), false);
});

Deno.test("buildTriggerAuditQuery — selects trigger functions, read-only", () => {
  const sql = buildTriggerAuditQuery();
  assertStringIncludes(sql, "'pg_catalog.trigger'::regtype");
  assertStringIncludes(sql, "attached_triggers");
  assertEquals(/^select\s/i.test(sql), true);
});

Deno.test("isTriggerRisk — unpinned trigger function is a risk", () => {
  const row: TriggerRow = { function_name: "t", pins_search_path: false, attached_triggers: 2 };
  assertEquals(isTriggerRisk(row), true);
});

Deno.test("isTriggerRisk — pinned trigger function is safe", () => {
  const row: TriggerRow = { function_name: "t", pins_search_path: true, attached_triggers: 1 };
  assertEquals(isTriggerRisk(row), false);
});
