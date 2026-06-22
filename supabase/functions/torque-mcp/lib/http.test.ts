import { assertEquals } from "@std/assert";
import { handleRpcPayload, secretMatches } from "./http.ts";
import type { DispatchContext } from "./dispatch.ts";
import type { JsonRpcResponse, JsonRpcSuccess } from "./types.ts";

function ctx(): DispatchContext {
  return {
    serverInfo: { name: "torque-mcp", version: "0.1.0" },
    tools: [],
    allowMutations: false,
    toolContext: {} as never,
  };
}

Deno.test("secretMatches — equal secrets match", () => {
  assertEquals(secretMatches("abc123", "abc123"), true);
});

Deno.test("secretMatches — different secrets do not match", () => {
  assertEquals(secretMatches("abc123", "abc999"), false);
});

Deno.test("secretMatches — null/empty provided never matches", () => {
  assertEquals(secretMatches(null, "abc123"), false);
  assertEquals(secretMatches("", "abc123"), false);
});

Deno.test("secretMatches — length mismatch never matches", () => {
  assertEquals(secretMatches("abc", "abc123"), false);
});

Deno.test("handleRpcPayload — single request returns a single response", async () => {
  const res = await handleRpcPayload(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "v" } },
    ctx(),
  );
  assertEquals(Array.isArray(res), false);
  assertEquals((res as JsonRpcSuccess).id, 1);
});

Deno.test("handleRpcPayload — batch returns an array of responses", async () => {
  const res = await handleRpcPayload(
    [
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ],
    ctx(),
  );
  assertEquals(Array.isArray(res), true);
  assertEquals((res as JsonRpcResponse[]).length, 2);
});

Deno.test("handleRpcPayload — batch of only notifications returns null", async () => {
  const res = await handleRpcPayload(
    [{ jsonrpc: "2.0", method: "notifications/initialized" }],
    ctx(),
  );
  assertEquals(res, null);
});
