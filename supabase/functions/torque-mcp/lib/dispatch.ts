import type { JsonRpcId, JsonRpcRequest, JsonRpcResponse, ToolContext, ToolDef } from "./types.ts";
import { visibleTools } from "./registry.ts";

// MCP protocol versions this server implements (newest first).
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18"] as const;
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export interface DispatchContext {
  serverInfo: { name: string; version: string };
  tools: ToolDef[];
  allowMutations: boolean;
  toolContext: ToolContext;
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
      });
    }
    case "tools/list": {
      const tools = visibleTools(ctx.tools, { allowMutations: ctx.allowMutations }).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      return ok(id, { tools });
    }
    case "tools/call": {
      const name = params?.name as string | undefined;
      const args = (params?.arguments as Record<string, unknown>) ?? {};
      // Only visible tools are callable — a hidden mutating tool is "unavailable".
      const tool = visibleTools(ctx.tools, { allowMutations: ctx.allowMutations })
        .find((t) => t.name === name);
      if (!tool) return err(id, -32602, `Unknown or unavailable tool: ${name}`);

      const missing = (tool.inputSchema.required ?? []).filter((k) => args[k] === undefined);
      if (missing.length > 0) {
        return err(id, -32602, `Missing required argument(s): ${missing.join(", ")}`);
      }

      try {
        const result = await tool.handler(args, ctx.toolContext);
        return ok(id, result);
      } catch (e) {
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
