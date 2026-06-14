import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { apiError, apiList, apiResource } from "./responses.ts";

const cors = { "access-control-allow-origin": "*" };

Deno.test("apiError — wraps code+message under error envelope", async () => {
  const res = apiError(403, "insufficient_scope", "Missing lead:read", cors);
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("content-type"), "application/json");
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
  const body = await res.json();
  assertEquals(body, { error: { code: "insufficient_scope", message: "Missing lead:read" } });
});

Deno.test("apiError — includes details when provided", async () => {
  const res = apiError(422, "validation_error", "bad field", cors, { field: "tier" });
  const body = await res.json();
  assertEquals(body.error.details, { field: "tier" });
});

Deno.test("apiList — envelopes data + cursor, has_more true when cursor present", async () => {
  const res = apiList([{ id: 1 }], "Y3Vyc29y", cors);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { data: [{ id: 1 }], next_cursor: "Y3Vyc29y", has_more: true });
});

Deno.test("apiList — has_more false and null cursor when no next page", async () => {
  const res = apiList([], null, cors);
  const body = await res.json();
  assertEquals(body, { data: [], next_cursor: null, has_more: false });
});

Deno.test("apiResource — returns the object directly (no envelope)", async () => {
  const res = apiResource({ id: "x", name: "Acme" }, cors);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { id: "x", name: "Acme" });
});

Deno.test("apiResource — honors custom status", async () => {
  const res = apiResource({ ok: true }, cors, 201);
  assertEquals(res.status, 201);
});
