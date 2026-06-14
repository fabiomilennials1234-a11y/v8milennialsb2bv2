import { assertEquals, assertNotEquals } from "jsr:@std/assert@^1.0.0";
import { decodeCursor, encodeCursor } from "./cursor.ts";

Deno.test("encode/decode — round trips created_at + id", () => {
  const c = { created_at: "2026-06-14T12:00:00.000Z", id: "abc-123" };
  const token = encodeCursor(c);
  assertEquals(decodeCursor(token), c);
});

Deno.test("encodeCursor — opaque (does not leak id in plaintext)", () => {
  const token = encodeCursor({ created_at: "2026-06-14T12:00:00.000Z", id: "secret-id" });
  assertEquals(token.includes("secret-id"), false);
  assertNotEquals(token, "");
});

Deno.test("decodeCursor — null/empty returns null", () => {
  assertEquals(decodeCursor(null), null);
  assertEquals(decodeCursor(""), null);
});

Deno.test("decodeCursor — malformed base64 returns null", () => {
  assertEquals(decodeCursor("!!!not-base64!!!"), null);
});

Deno.test("decodeCursor — valid base64 but wrong shape returns null", () => {
  const bad = btoa(JSON.stringify({ foo: "bar" }));
  assertEquals(decodeCursor(bad), null);
});
