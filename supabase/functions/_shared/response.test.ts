/**
 * Smoke test for _shared/response.ts — validates Deno test + coverage pipeline.
 *
 * Phase 0: one meaningful assertion per exported function. Full behavioural
 * coverage lands in Phase 2 (shared modules).
 */

import { assertEquals, assertMatch } from "jsr:@std/assert@^1.0.0";
import {
  deprecatedResponse,
  errorResponse,
  generateRequestId,
  getApiVersion,
  successResponse,
} from "./response.ts";

const CORS = { "access-control-allow-origin": "*" };

Deno.test("generateRequestId — returns a UUID", () => {
  const id = generateRequestId();
  assertMatch(id, /^[0-9a-f-]{36}$/i);
});

Deno.test("getApiVersion — defaults to 1 when no request", () => {
  assertEquals(getApiVersion(), 1);
});

Deno.test("getApiVersion — reads X-API-Version header and clamps to MAX", () => {
  // MAX_API_VERSION is currently 1, so any higher value clamps down.
  const req = new Request("https://x", { headers: { "X-API-Version": "99" } });
  assertEquals(getApiVersion(req), 1);
});

Deno.test("getApiVersion — clamps invalid values to min", () => {
  const req = new Request("https://x", { headers: { "X-API-Version": "not-a-number" } });
  assertEquals(getApiVersion(req), 1);
});

Deno.test("successResponse — v1 spreads data at top level", async () => {
  const res = successResponse({ foo: "bar" }, CORS);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.success, true);
  assertEquals(body.foo, "bar");
  assertEquals(body.meta.api_version, 1);
});

Deno.test("errorResponse — returns standard error envelope", async () => {
  const res = errorResponse(400, "boom", CORS);
  const body = await res.json();
  assertEquals(res.status, 400);
  assertEquals(body.success, false);
  assertEquals(body.error, "boom");
});

Deno.test("deprecatedResponse — marks response as deprecated", async () => {
  const res = deprecatedResponse({ x: 1 }, "use v2", CORS);
  const body = await res.json();
  assertEquals(body.meta.deprecated, true);
  assertEquals(body.meta.deprecation_notice, "use v2");
});
