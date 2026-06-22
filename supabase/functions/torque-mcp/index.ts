import { getCorsHeaders } from "../_shared/cors.ts";
import { loadConfig } from "./lib/config.ts";
import { createCachedMasterClientProvider } from "./lib/auth.ts";
import { signInAsMaster } from "./lib/clients.ts";
import { handleRpcPayload, secretMatches } from "./lib/http.ts";
import type { DispatchContext } from "./lib/dispatch.ts";
import type { JsonRpcRequest } from "./lib/types.ts";
import { leadGetTool } from "./tools/lead.ts";
import { leadTraceHistoryTool } from "./tools/trace.ts";
import { conversationGetTool } from "./tools/conversation.ts";
import { whatsappInstanceStatusTool } from "./tools/whatsapp.ts";
import { blastStatusTool } from "./tools/blast.ts";
import { copilotDumpPromptTool } from "./tools/copilot.ts";

// Fail loud at boot if a required secret is missing (docs/adr/0011, REQ-M04).
const config = loadConfig(Deno.env.toObject());

const SERVER_INFO = { name: "torque-mcp", version: "0.1.0" };
const TOOLS = [
  leadGetTool,
  leadTraceHistoryTool,
  conversationGetTool,
  whatsappInstanceStatusTool,
  blastStatusTool,
  copilotDumpPromptTool,
];

// Isolate-scoped cache of the signed-in master session. The principal is fixed
// (the ops-master) so reuse is safe — RLS still applies per query. (docs/adr/0011)
const getMasterClient = createCachedMasterClientProvider({
  now: () => Date.now(),
  signIn: () => signInAsMaster(config),
});

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") {
    return json({ error: "Method not allowed; POST a JSON-RPC body." }, 405, cors);
  }

  // Gateway secret — single guard for the whole endpoint.
  if (!secretMatches(req.headers.get("x-mcp-secret"), config.gatewaySecret)) {
    return json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } },
      401,
      cors,
    );
  }

  let payload: JsonRpcRequest | JsonRpcRequest[];
  try {
    payload = await req.json();
  } catch {
    return json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      400,
      cors,
    );
  }

  try {
    const db = await getMasterClient();
    const ctx: DispatchContext = {
      serverInfo: SERVER_INFO,
      tools: TOOLS,
      allowMutations: config.allowMutations,
      toolContext: { db },
    };
    const result = await handleRpcPayload(payload, ctx);
    if (result === null) return new Response(null, { status: 202, headers: cors }); // notifications only
    return json(result, 200, cors);
  } catch (e) {
    console.error("[torque-mcp] handler error:", e); // stderr
    const message = e instanceof Error ? e.message : String(e);
    return json(
      { jsonrpc: "2.0", id: null, error: { code: -32603, message: `Internal error: ${message}` } },
      500,
      cors,
    );
  }
});
