import { createClient } from "@supabase/supabase-js";
import { getCorsHeaders } from "../_shared/cors.ts";
import { captureError } from "../_shared/sentry.ts";
import { loadConfig } from "./lib/config.ts";
import { createCachedMasterClientProvider } from "../_shared/mcp/auth.ts";
import { signInAsMaster } from "./lib/clients.ts";
import { handleRpcPayload, secretMatches } from "../_shared/mcp/http.ts";
import type { DispatchContext } from "../_shared/mcp/dispatch.ts";
import type { JsonRpcRequest } from "../_shared/mcp/types.ts";
import { leadGetTool, leadRestoreTool } from "./tools/lead.ts";
import { leadTraceHistoryTool } from "./tools/trace.ts";
import { conversationGetTool } from "./tools/conversation.ts";
import { whatsappInstanceStatusTool } from "./tools/whatsapp.ts";
import { blastStatusTool } from "./tools/blast.ts";
import { copilotDumpPromptTool, copilotUpdatePromptTool } from "./tools/copilot.ts";
import { cronToggleTool } from "./tools/cron.ts";
import { dbReadSqlTool } from "./tools/db.ts";
import { rlsCheckAccessTool } from "./tools/rls.ts";
import { schemaAuditDefinerTool, schemaAuditTriggersTool } from "./tools/schema.ts";
import { migrationDiffTool } from "./tools/migration.ts";

// Fail loud at boot if a required secret is missing (docs/adr/0011, REQ-M04).
const config = loadConfig(Deno.env.toObject());

// project is surfaced in initialize so every caller sees which environment it hit.
const SERVER_INFO = { name: "torque-mcp", version: "0.1.0", project: config.project };
const TOOLS = [
  leadGetTool,
  leadTraceHistoryTool,
  conversationGetTool,
  whatsappInstanceStatusTool,
  blastStatusTool,
  copilotDumpPromptTool,
  dbReadSqlTool,
  rlsCheckAccessTool,
  schemaAuditDefinerTool,
  schemaAuditTriggersTool,
  migrationDiffTool,
  leadRestoreTool,
  copilotUpdatePromptTool,
  cronToggleTool,
];

// Isolate-scoped cache of the signed-in master session. The principal is fixed
// (the ops-master) so reuse is safe — RLS still applies per query. (docs/adr/0011)
const getMasterClient = createCachedMasterClientProvider({
  now: () => Date.now(),
  signIn: () => signInAsMaster(config),
});

// Lazy service-role client — only built when a requiresServiceRole tool is dispatched.
// ALLOW_MUTATIONS must be true for serviceDb to be injected into toolContext.
let _serviceDb: ReturnType<typeof createClient> | null = null;
function getServiceDb(): ReturnType<typeof createClient> {
  if (!_serviceDb) {
    // config.serviceRoleKey is validated non-empty at boot when allowMutations is true.
    _serviceDb = createClient(
      config.supabaseUrl,
      config.serviceRoleKey,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return _serviceDb;
}

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
      toolContext: { db, serviceDb: config.allowMutations ? getServiceDb() : undefined },
    };
    const result = await handleRpcPayload(payload, ctx);
    if (result === null) return new Response(null, { status: 202, headers: cors }); // notifications only
    return json(result, 200, cors);
  } catch (e) {
    console.error("[torque-mcp] handler error:", e); // stderr
    // Report to Sentry but keep the JSON-RPC envelope (MCP clients expect it).
    await captureError(e, { functionName: "torque-mcp", extra: { method: req.method } });
    const message = e instanceof Error ? e.message : String(e);
    return json(
      { jsonrpc: "2.0", id: null, error: { code: -32603, message: `Internal error: ${message}` } },
      500,
      cors,
    );
  }
});
