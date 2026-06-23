import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildDefinerAuditQuery, type DefinerRow, isDefinerRisk } from "./schema.ts";

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
