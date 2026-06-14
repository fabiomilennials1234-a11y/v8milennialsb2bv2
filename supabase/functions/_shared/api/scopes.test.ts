import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { API_SCOPES, hasScope } from "./scopes.ts";

Deno.test("API_SCOPES — exposes the v1 vocabulary", () => {
  for (const s of ["lead:read", "lead:write", "pipeline:read", "metadata:read", "lead:ingest", "webhook:read"]) {
    assertEquals(API_SCOPES.includes(s), true, `missing scope ${s}`);
  }
});

Deno.test("hasScope — exact grant satisfies", () => {
  assertEquals(hasScope(["lead:read"], "lead:read"), true);
});

Deno.test("hasScope — missing grant denied", () => {
  assertEquals(hasScope(["lead:read"], "lead:write"), false);
  assertEquals(hasScope([], "lead:read"), false);
});

Deno.test("hasScope — wildcard grants everything", () => {
  assertEquals(hasScope(["*"], "lead:write"), true);
  assertEquals(hasScope(["*"], "metadata:read"), true);
});

Deno.test("hasScope — lead:write is superset of lead:ingest (backward compat)", () => {
  assertEquals(hasScope(["lead:write"], "lead:ingest"), true);
});

Deno.test("hasScope — lead:write does not grant unrelated read scopes", () => {
  assertEquals(hasScope(["lead:write"], "pipeline:read"), false);
});
