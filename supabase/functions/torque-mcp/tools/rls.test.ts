import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildRlsAuditQuery, isRlsGap, type RlsRow } from "./rls.ts";

const row = (over: Partial<RlsRow>): RlsRow => ({
  table_name: "t",
  rls_enabled: true,
  has_org: true,
  has_master_policy: false,
  policy_count: 1,
  ...over,
});

Deno.test("buildRlsAuditQuery — no table scans gaps only", () => {
  const sql = buildRlsAuditQuery();
  assertStringIncludes(sql, "has_org = true and t.rls_enabled = true");
  assertStringIncludes(sql.toLowerCase(), "pg_policies");
  // read-only: must start with WITH so the parser guard accepts it
  assertEquals(/^with\s/i.test(sql), true);
});

Deno.test("buildRlsAuditQuery — specific table returns full status (no gap filter)", () => {
  const sql = buildRlsAuditQuery("checklists");
  assertStringIncludes(sql, "c.relname = 'checklists'");
  assertEquals(sql.includes("where t.has_org = true and t.rls_enabled = true"), false);
});

Deno.test("buildRlsAuditQuery — escapes single quotes in table name", () => {
  const sql = buildRlsAuditQuery("o'brien");
  assertStringIncludes(sql, "c.relname = 'o''brien'");
});

Deno.test("isRlsGap — multi-tenant + RLS on + no master policy = gap", () => {
  assertEquals(isRlsGap(row({})), true);
});

Deno.test("isRlsGap — has a master policy → not a gap", () => {
  assertEquals(isRlsGap(row({ has_master_policy: true })), false);
});

Deno.test("isRlsGap — not multi-tenant → not a gap", () => {
  assertEquals(isRlsGap(row({ has_org: false })), false);
});

Deno.test("isRlsGap — RLS disabled → not a gap (different concern)", () => {
  assertEquals(isRlsGap(row({ rls_enabled: false })), false);
});
