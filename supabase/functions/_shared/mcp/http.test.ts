import { assertEquals } from "@std/assert";
import { handleRpcPayload, presentedSecret, secretMatches } from "./http.ts";
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

Deno.test("presentedSecret — reads x-mcp-secret", () => {
  assertEquals(presentedSecret(new Headers({ "x-mcp-secret": "abc123" })), "abc123");
});

Deno.test("presentedSecret — reads Authorization: Bearer when x-mcp-secret is absent", () => {
  assertEquals(presentedSecret(new Headers({ authorization: "Bearer abc123" })), "abc123");
  assertEquals(presentedSecret(new Headers({ authorization: "bearer   abc123 " })), "abc123");
});

Deno.test("presentedSecret — x-mcp-secret wins; a wrong one never falls through to Bearer", () => {
  const headers = new Headers({ "x-mcp-secret": "wrong", authorization: "Bearer abc123" });
  assertEquals(presentedSecret(headers), "wrong");
  assertEquals(secretMatches(presentedSecret(headers), "abc123"), false);
});

Deno.test("presentedSecret — non-Bearer Authorization or no header yields null", () => {
  assertEquals(presentedSecret(new Headers({ authorization: "Basic abc123" })), null);
  assertEquals(presentedSecret(new Headers({ authorization: "Bearer" })), null);
  assertEquals(presentedSecret(new Headers()), null);
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
