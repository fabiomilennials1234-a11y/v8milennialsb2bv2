import { assertEquals } from "@std/assert";
import { sha256hex, stableStringify } from "./crypto.ts";

Deno.test("stableStringify — key order independent", () => {
  assertEquals(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
  assertEquals(stableStringify({ a: { y: 1, x: 2 } }), '{"a":{"x":2,"y":1}}');
});

Deno.test("sha256hex — deterministic 64-char hex", async () => {
  const h = await sha256hex("torque");
  assertEquals(h.length, 64);
  assertEquals(h, await sha256hex("torque"));
});
