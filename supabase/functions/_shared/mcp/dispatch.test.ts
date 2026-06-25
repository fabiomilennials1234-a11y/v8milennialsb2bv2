import { assertEquals } from "@std/assert";
import { dispatch, type DispatchContext } from "./dispatch.ts";
import type { JsonRpcError, JsonRpcSuccess, ToolContext, ToolDef, ToolResult } from "./types.ts";

function ctx(overrides: Partial<DispatchContext> = {}): DispatchContext {
  return {
    serverInfo: { name: "torque-mcp", version: "0.1.0" },
    tools: [],
    allowMutations: false,
    toolContext: {} as never,
    ...overrides,
  };
}

const readTool: ToolDef = {
  name: "lead.get",
  description: "Get a lead",
  readonly: true,
  inputSchema: { type: "object", properties: { org_id: { type: "string" } }, required: ["org_id"] },
  handler: () => ({ content: [{ type: "text", text: "ok" }] }),
};

const writeTool: ToolDef = {
  ...readTool,
  name: "lead.restore",
  readonly: false,
};

Deno.test("dispatch — initialize returns protocol + capabilities + serverInfo", async () => {
  const res = await dispatch(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    ctx(),
  );
  assertEquals(res?.jsonrpc, "2.0");
  assertEquals(res?.id, 1);
  const result = (res as JsonRpcSuccess).result as Record<string, unknown>;
  assertEquals(result.protocolVersion, "2025-06-18"); // same version when supported
  assertEquals(result.serverInfo, { name: "torque-mcp", version: "0.1.0" });
  assertEquals(typeof (result.capabilities as Record<string, unknown>).tools, "object");
});

Deno.test("dispatch — initialize negotiates to the server's latest on an unsupported version", async () => {
  const res = await dispatch(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
    ctx(),
  );
  const result = (res as JsonRpcSuccess).result as Record<string, unknown>;
  // spec: if requested version is unsupported, respond with our own (latest), not an echo
  assertEquals(result.protocolVersion, "2025-06-18");
});

Deno.test("dispatch — a notification (no id) yields no response", async () => {
  const res = await dispatch({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx());
  assertEquals(res, null);
});

Deno.test("dispatch — tools/list exposes only read tools when mutations OFF", async () => {
  const res = await dispatch(
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ctx({ tools: [readTool, writeTool], allowMutations: false }),
  );
  const result = (res as JsonRpcSuccess).result as {
    tools: Array<{ name: string; description: string; inputSchema: unknown }>;
  };
  assertEquals(result.tools.map((t) => t.name), ["lead.get"]);
  assertEquals(result.tools[0].inputSchema, readTool.inputSchema);
  assertEquals(result.tools[0].description, "Get a lead");
});

Deno.test("dispatch — tools/list exposes all tools when mutations ON", async () => {
  const res = await dispatch(
    { jsonrpc: "2.0", id: 3, method: "tools/list" },
    ctx({ tools: [readTool, writeTool], allowMutations: true }),
  );
  const result = (res as JsonRpcSuccess).result as { tools: Array<{ name: string }> };
  assertEquals(result.tools.map((t) => t.name), ["lead.get", "lead.restore"]);
});

Deno.test("dispatch — tools/call runs the tool with args + injected context", async () => {
  let received: { args: unknown; ctx: unknown } | null = null;
  const tool: ToolDef = {
    ...readTool,
    handler: (args, tctx) => {
      received = { args, ctx: tctx };
      return { content: [{ type: "text", text: "lead-1 found" }] };
    },
  };
  const toolContext = { db: "DB-CLIENT" } as unknown as ToolContext;
  const res = await dispatch(
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "lead.get", arguments: { org_id: "o1" } },
    },
    ctx({ tools: [tool], allowMutations: false, toolContext }),
  );
  const result = (res as JsonRpcSuccess).result as ToolResult;
  assertEquals(result.content[0].text, "lead-1 found");
  assertEquals(received!.args, { org_id: "o1" });
  assertEquals(received!.ctx, toolContext);
});

Deno.test("dispatch — tools/call on unknown/hidden tool returns an error", async () => {
  // writeTool is hidden when mutations OFF → not callable
  const res = await dispatch(
    {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "lead.restore", arguments: {} },
    },
    ctx({ tools: [readTool, writeTool], allowMutations: false }),
  );
  const error = (res as JsonRpcError).error;
  assertEquals(error.code, -32602);
  assertEquals(error.message.includes("lead.restore"), true);
});

Deno.test("dispatch — tools/call missing required arg returns an error", async () => {
  const res = await dispatch(
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "lead.get", arguments: {} } },
    ctx({ tools: [readTool], allowMutations: false }),
  );
  const error = (res as JsonRpcError).error;
  assertEquals(error.code, -32602);
  assertEquals(error.message.includes("org_id"), true);
});

Deno.test("dispatch — tools/call wraps a thrown handler error as isError result", async () => {
  const tool: ToolDef = {
    ...readTool,
    handler: () => {
      throw new Error("boom from tool");
    },
  };
  const res = await dispatch(
    {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "lead.get", arguments: { org_id: "o1" } },
    },
    ctx({ tools: [tool], allowMutations: false }),
  );
  // MCP convention: tool failures are a result with isError, not a JSON-RPC error
  const result = (res as JsonRpcSuccess).result as ToolResult;
  assertEquals(result.isError, true);
  assertEquals(result.content[0].text.includes("boom from tool"), true);
});
