import type { JsonRpcId, JsonRpcRequest, JsonRpcResponse, ToolContext, ToolDef } from "./types.ts";
import { visibleTools } from "./registry.ts";

// MCP protocol versions this server implements (newest first). The tools-only surface
// (initialize / tools/list / tools/call / ping) is identical across these revisions, so an
// older client that asks for 2025-03-26 gets it echoed instead of a version it may reject.
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"] as const;
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export interface DispatchContext {
  serverInfo: { name: string; version: string; project?: string };
  /**
   * Optional `instructions` for the initialize result (MCP spec): how to use this server.
   * crm-mcp sends what the token can do and how to unlock what it cannot.
   */
  instructions?: string;
  tools: ToolDef[];
  allowMutations: boolean;
  /**
   * Optional positive allowlist applied on top of the mutations gate (see visibleTools).
   * crm-mcp passes `(t) => t.readonly && t.customerExposed`; torque-mcp omits it
   * (unchanged behavior). A tool hidden by this filter is "unavailable" — not listable,
   * not callable.
   */
  toolFilter?: (t: ToolDef) => boolean;
  toolContext: ToolContext;
  /**
   * Extra PII-free identifiers merged into the per-call trace line (crm-mcp passes the PAT
   * id and org id so a customer's AI activity is attributable in the edge logs). Never put
   * arguments, tokens or tenant data here.
   */
  logContext?: Record<string, string>;
}

/** Structured, PII-free one-line trace of a tool call (server + tool name + outcome + ms). */
function logToolCall(
  server: string,
  name: string,
  startedAt: number,
  outcome: "ok" | "error",
  logContext?: Record<string, string>,
): void {
  console.log(JSON.stringify({
    ...logContext,
    at: `${server}/tools.call`,
    tool: name,
    outcome,
    ms: Date.now() - startedAt,
  }));
}

/**
 * Route a single JSON-RPC request to the right MCP method.
 * Returns the response, or null for notifications (no id).
 */
export async function dispatch(
  req: JsonRpcRequest,
  ctx: DispatchContext,
): Promise<JsonRpcResponse | null> {
  const { id, method, params } = req;

  // JSON-RPC notification (no id) → process side effects only, never respond.
  if (id === undefined) return null;

  switch (method) {
    case "initialize": {
      // Spec: echo the requested version if supported; otherwise our latest.
      const requested = params?.protocolVersion as string | undefined;
      const protocolVersion =
        requested && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
          ? requested
          : LATEST_PROTOCOL_VERSION;
      return ok(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: ctx.serverInfo,
        ...(ctx.instructions ? { instructions: ctx.instructions } : {}),
      });
    }
    case "tools/list": {
      const tools = visibleTools(ctx.tools, {
        allowMutations: ctx.allowMutations,
        toolFilter: ctx.toolFilter,
      }).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        ...(t.annotations ? { annotations: t.annotations } : {}),
      }));
      return ok(id, { tools });
    }
    case "ping":
      // Liveness check any MCP client may send at any time (spec: respond with {}).
      return ok(id, {});
    case "tools/call": {
      const name = params?.name as string | undefined;
      const args = (params?.arguments as Record<string, unknown>) ?? {};
      // Only visible tools are callable — a tool hidden by the mutations gate or the
      // caller filter is "unavailable" (indistinguishable from non-existent).
      const tool = visibleTools(ctx.tools, {
        allowMutations: ctx.allowMutations,
        toolFilter: ctx.toolFilter,
      }).find((t) => t.name === name);
      if (!tool) return err(id, -32602, `Unknown or unavailable tool: ${name}`);

      const missing = (tool.inputSchema.required ?? []).filter((k) => args[k] === undefined);
      if (missing.length > 0) {
        return err(id, -32602, `Missing required argument(s): ${missing.join(", ")}`);
      }

      const startedAt = Date.now();
      try {
        const result = await tool.handler(args, ctx.toolContext);
        const isError = (result as { isError?: boolean })?.isError === true;
        logToolCall(
          ctx.serverInfo.name,
          tool.name,
          startedAt,
          isError ? "error" : "ok",
          ctx.logContext,
        );
        return ok(id, result);
      } catch (e) {
        logToolCall(ctx.serverInfo.name, tool.name, startedAt, "error", ctx.logContext);
        const msg = e instanceof Error ? e.message : String(e);
        return ok(id, { content: [{ type: "text", text: `Error: ${msg}` }], isError: true });
      }
    }
    default:
      return err(id, -32601, `Method not found: ${method}`);
  }
}

function ok(id: JsonRpcId | undefined, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function err(id: JsonRpcId | undefined, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}
