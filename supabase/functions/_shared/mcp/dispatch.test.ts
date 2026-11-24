import { assertEquals } from "@std/assert";
import { dispatch, type DispatchContext } from "./dispatch.ts";
import type { JsonRpcError, JsonRpcSuccess, ToolContext, ToolDef, ToolResult } from "./types.ts";
import { textOf } from "./content.ts";

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

Deno.test("dispatch — initialize carries the server's instructions only when it has them", async () => {
  const init = { jsonrpc: "2.0" as const, id: 1, method: "initialize", params: {} };
  const without = (await dispatch(init, ctx())) as JsonRpcSuccess;
  assertEquals("instructions" in (without.result as Record<string, unknown>), false);
  const withIt = (await dispatch(init, ctx({ instructions: "How to use me" }))) as JsonRpcSuccess;
  assertEquals((withIt.result as Record<string, unknown>).instructions, "How to use me");
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

Deno.test("dispatch — initialize echoes the older 2025-03-26 revision it also implements", async () => {
  const res = await dispatch(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
    ctx(),
  );
  const result = (res as JsonRpcSuccess).result as Record<string, unknown>;
  assertEquals(result.protocolVersion, "2025-03-26");
});

Deno.test("dispatch — ping answers {} (spec liveness check)", async () => {
  const res = await dispatch({ jsonrpc: "2.0", id: 9, method: "ping" }, ctx());
  assertEquals((res as JsonRpcSuccess).result, {});
});

Deno.test("dispatch — tools/list advertises annotations only when the tool declares them", async () => {
  const annotated: ToolDef = {
    ...readTool,
    name: "lead.list",
    annotations: { readOnlyHint: true, openWorldHint: false },
  };
  const res = await dispatch(
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ctx({ tools: [readTool, annotated] }),
  );
  const tools = ((res as JsonRpcSuccess).result as { tools: Record<string, unknown>[] }).tools;
  assertEquals("annotations" in tools[0], false);
  assertEquals(tools[1].annotations, { readOnlyHint: true, openWorldHint: false });
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
  assertEquals(textOf(result), "lead-1 found");
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
  assertEquals(textOf(result).includes("boom from tool"), true);
});

Deno.test("dispatch — tools/list carries the top-level title when the tool has one", async () => {
  const titled = { ...readTool, annotations: { title: "Get lead" } };
  const res = await dispatch(
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    ctx({ tools: [titled, { ...readTool, name: "x.plain" }] }),
  );
  const tools = ((res as JsonRpcSuccess).result as { tools: Array<Record<string, unknown>> }).tools;
  assertEquals(tools[0].title, "Get lead");
  assertEquals("title" in tools[1], false);
});

Deno.test("dispatch — a call to a hidden, unknown or under-specified tool is logged by name only", async () => {
  const lines: string[] = [];
  const real = console.log;
  console.log = (s: string) => lines.push(s);
  try {
    const c = ctx({
      tools: [readTool, writeTool],
      logContext: { pat_id: "p" },
    });
    await dispatch(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "lead.restore" } },
      c,
    );
    await dispatch(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "nope" } },
      c,
    );
    await dispatch(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "lead.get", arguments: { secret: "value" } },
      },
      c,
    );
  } finally {
    console.log = real;
  }
  const events = lines.map((l) => JSON.parse(l));
  assertEquals(events.map((e) => [e.tool, e.outcome, e.pat_id]), [
    ["lead.restore", "hidden", "p"],
    ["nope", "unknown", "p"],
    ["lead.get", "invalid_args", "p"],
  ]);
  assertEquals(events[2].missing, ["org_id"]);
  assertEquals(lines.join("").includes("value"), false); // never argument values
});
