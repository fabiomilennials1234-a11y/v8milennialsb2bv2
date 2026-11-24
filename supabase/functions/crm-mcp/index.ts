/**
 * crm-mcp — customer-facing "bring-your-own-AI" MCP server (Edge Function, Streamable HTTP).
 * Scenario B of docs/adr/0011; decision record docs/adr/0012; spec in
 * .specs/features/crm-mcp/DESIGN.md.
 *
 * Pipeline (mirrors torque-mcp, swapping ONLY the auth layer for a per-PAT path):
 *   L0 BOOT   — try to drop the project-wide privileged secrets from the isolate (the runtime
 *               keeps them; the code never reads them — see lib/config.ts), import the
 *               dedicated ES256 signing key once.
 *   L1 HTTP   — CORS / OPTIONS / POST-only / body cap. The bearer PAT IS the credential.
 *   L2 AUTH   — parse PAT offline (format + CRC) → hash → crm_mcp_authenticate, called with a
 *               30 s JWT for the `crm_mcp_resolver` role (browser-unreachable resolver; it
 *               also enforces the rate limit and stamps last_used_at) → pure re-check of the
 *               verdict against the raw facts (fail closed) → mint the 60 s user JWT → hard
 *               assert → per-request per-user RLS client. service_role is never in scope.
 *   L3/L4     — the shared spine dispatch with a fail-closed customer toolFilter.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { importJWK } from "jose";
import { getCorsHeaders } from "../_shared/cors.ts";
import { logError } from "../_shared/error-boundary.ts";
import { handleRpcPayload } from "../_shared/mcp/http.ts";
import type { DispatchContext } from "../_shared/mcp/dispatch.ts";
import type { JsonRpcRequest } from "../_shared/mcp/types.ts";
import { serverInstructions } from "./lib/capabilities.ts";
import { type CrmMcpConfig, loadConfig, scrubPrivilegedEnv } from "./lib/config.ts";
import {
  assertWellFormedJwt,
  assertWellFormedResolverJwt,
  type AuthDecision,
  type AuthRow,
  classifyAuthRow,
  hashToken,
  mintResolverJwt,
  mintUserJwt,
  parsePat,
  toSigningJwk,
} from "./lib/pat.ts";
import type { ActionStore, EdgeInvoker, WriteScope } from "./tools/actions.ts";
import { CUSTOMER_TOOLS, customerToolFilter } from "./tools/index.ts";

const SERVER_INFO = { name: "torque-crm", version: "1.2.0" }; // NO project — no env reconnaissance

/**
 * Calls one of the app's own edge functions AS THE USER, with the 60 s JWT minted for this
 * request (GoTrue accepts it — measured). Only the functions named in EdgeInvoker.
 */
function edgeInvoker(supabaseUrl: string, anonKey: string, userJwt: string): EdgeInvoker {
  return async (fn, body) => {
    const r = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${userJwt}`,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = await r.json();
    } catch {
      parsed = null;
    }
    return { status: r.status, body: parsed };
  };
}

/** Plan/confirm store bound to THIS request's token, through the resolver role. */
function actionStore(resolverDb: SupabaseClient, tokenHash: string): ActionStore {
  const one = <T>(data: unknown): T | null => (Array.isArray(data) ? (data[0] as T) ?? null : null);
  return {
    async open(tool: string, scope: WriteScope, summary: string, plan: unknown) {
      const { data, error } = await resolverDb.rpc("crm_mcp_action_open", {
        p_token_hash: tokenHash,
        p_tool: tool,
        p_scope: scope,
        p_summary: summary,
        p_plan: plan,
      });
      if (error) throw new Error(error.message);
      const row = one<{ action_id: string; expires_at: string }>(data);
      if (!row) throw new Error("crm_mcp_action_open returned no row");
      return { actionId: row.action_id, expiresAt: row.expires_at };
    },
    async take(actionId: string) {
      const { data, error } = await resolverDb.rpc("crm_mcp_action_take", {
        p_token_hash: tokenHash,
        p_action_id: actionId,
      });
      if (error) return null;
      const row = one<{ tool: string; plan: unknown }>(data);
      return row ? { tool: row.tool, plan: row.plan } : null;
    },
    async finish(actionId: string, status: "applied" | "partial" | "failed", result: unknown) {
      const { data, error } = await resolverDb.rpc("crm_mcp_action_finish", {
        p_token_hash: tokenHash,
        p_action_id: actionId,
        p_status: status,
        p_result: result,
      });
      return !error && data === true;
    },
    async getApplied(actionId: string) {
      const { data, error } = await resolverDb.rpc("crm_mcp_action_get_applied", {
        p_token_hash: tokenHash,
        p_action_id: actionId,
      });
      if (error) return null;
      const row = one<{ tool: string; plan: unknown; result: unknown }>(data);
      return row ? { tool: row.tool, plan: row.plan, result: row.result } : null;
    },
    async markUndone(actionId: string) {
      const { data, error } = await resolverDb.rpc("crm_mcp_action_mark_undone", {
        p_token_hash: tokenHash,
        p_action_id: actionId,
      });
      return !error && data === true;
    },
  };
}
const MAX_BODY_BYTES = 256 * 1024;
const nowSec = () => Math.floor(Date.now() / 1000);

// --- boot (fail closed, but observable) -------------------------------------------------
// A throw at module scope surfaces only as an opaque WORKER_ERROR (and this project's Logs API
// is unavailable), so the boot is caught: every request then gets a 503 naming the STAGE that
// failed. The detail carries variable names only — never a value. Nothing is served.
interface Booted {
  config: CrmMcpConfig;
  signingKey: CryptoKey;
  resolverDb: SupabaseClient;
}
interface BootFailure {
  stage: "scrub" | "config" | "signing_key";
  detail: string;
}

async function boot(): Promise<Booted | BootFailure> {
  let stage: BootFailure["stage"] = "scrub";
  try {
    // Order matters: the scrub runs before anything else reads the env, so no module — ours
    // or a dependency — can pick the platform's service_role key up later in this isolate.
    const scrubbed = scrubPrivilegedEnv(Deno.env);
    stage = "config";
    const config = loadConfig(Deno.env.toObject()); // throws on ops secrets or missing reqs
    stage = "signing_key";
    // Import the dedicated ES256 signing key ONCE per isolate (DESIGN §4.4/§4.5).
    const signingKey = await importJWK(toSigningJwk(config.jwtSigningKeyJwk), "ES256") as CryptoKey;

    // Pre-auth client: every call carries a FRESH 30 s resolver JWT. That role can execute
    // crm_mcp_authenticate and read nothing — tenant data goes through the per-user client.
    const resolverDb = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      accessToken: async () => {
        const jwt = await mintResolverJwt(
          { projectRef: config.projectRef, signingKey, kid: config.jwtKid },
          nowSec(),
        );
        assertWellFormedResolverJwt(jwt);
        return jwt;
      },
    });
    console.log(JSON.stringify({ at: "crm-mcp/boot", ok: true, scrubbed }));
    return { config, signingKey, resolverDb };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ at: "crm-mcp/boot", ok: false, stage, detail }));
    return { stage, detail };
  }
}

const booted = await boot();

function json(
  body: unknown,
  status: number,
  cors: Record<string, string>,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, ...extra, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function rpcError(
  code: number,
  message: string,
  status: number,
  cors: Record<string, string>,
  extra: Record<string, string> = {},
): Response {
  return json({ jsonrpc: "2.0", id: null, error: { code, message } }, status, cors, extra);
}

function bearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

const WWW_AUTH = 'Bearer realm="torque-crm", error="invalid_token"';

/** Full PAT resolution: offline parse → hash → resolver RPC → pure re-check. */
async function authenticate(
  b: Booted,
  token: string,
): Promise<{ decision: AuthDecision; tokenHash: string | null }> {
  const parsed = parsePat(token);
  if (!parsed) return { decision: { kind: "unauthorized", reason: "not_found" }, tokenHash: null };

  const hash = await hashToken(parsed.full, b.config.patPepper);
  const { data, error } = await b.resolverDb.rpc("crm_mcp_authenticate", { p_token_hash: hash });
  if (error) throw new Error(`crm_mcp_authenticate failed: ${error.code ?? ""} ${error.message}`);
  const rows = (Array.isArray(data) ? data : []) as AuthRow[];
  return { decision: classifyAuthRow(rows[0] ?? null, Date.now()), tokenHash: hash };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") {
    // Streamable HTTP: a server without an SSE stream answers GET with 405.
    return json({ error: "Method not allowed; POST a JSON-RPC body." }, 405, cors, {
      Allow: "POST, OPTIONS",
    });
  }

  if ("stage" in booted) {
    return json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32603, message: "Service unavailable", data: booted },
      },
      503,
      cors,
    );
  }
  const { config, signingKey } = booted;

  // Cheap rejects first: no DB round-trip for an oversized body or a missing credential.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return rpcError(-32600, "Request too large", 413, cors);

  const token = bearer(req.headers.get("authorization"));
  if (!token) return rpcError(-32001, "Unauthorized", 401, cors, { "WWW-Authenticate": WWW_AUTH });

  let decision: AuthDecision;
  let tokenHash: string | null;
  try {
    ({ decision, tokenHash } = await authenticate(booted, token));
  } catch (e) {
    await logError(e, { functionName: "crm-mcp", extra: { stage: "authenticate" } });
    return rpcError(-32603, "Internal error", 500, cors);
  }

  if (decision.kind === "unauthorized") {
    return rpcError(-32001, "Unauthorized", 401, cors, { "WWW-Authenticate": WWW_AUTH });
  }
  if (decision.kind === "forbidden") {
    // The reason is the token owner's own state (flag off, left the org…) — safe and useful
    // to tell the holder; it is not an oracle for anyone without the token.
    return rpcError(-32003, `Forbidden: ${decision.reason}`, 403, cors);
  }
  if (decision.kind === "rate_limited") {
    return rpcError(-32029, "Rate limit exceeded", 429, cors, {
      "Retry-After": String(decision.retryAfterSeconds),
    });
  }
  const { principal } = decision;

  // Mint the short-lived per-user JWT and HARD-FAIL-CLOSED before building any client (H3a):
  // a malformed mint must never let the request fall back to the anon role.
  let userJwt: string;
  try {
    userJwt = await mintUserJwt({
      userId: principal.userId,
      email: "",
      projectRef: config.projectRef,
      signingKey,
      kid: config.jwtKid,
    }, nowSec());
    assertWellFormedJwt(userJwt);
  } catch (e) {
    await logError(e, { functionName: "crm-mcp", extra: { stage: "mint" } });
    return rpcError(-32603, "Internal error", 500, cors);
  }

  // Per-request, per-user RLS client. accessToken attaches `Authorization: Bearer <userJwt>`
  // to every PostgREST call; the anon key remains as `apikey`. NEVER cached across requests
  // (one user's token must never leak into another's client) and NEVER service_role.
  const db = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    accessToken: () => Promise.resolve(userJwt),
  });

  let payload: JsonRpcRequest | JsonRpcRequest[];
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return rpcError(-32600, "Request too large", 413, cors);
    payload = JSON.parse(raw);
  } catch {
    return rpcError(-32700, "Parse error", 400, cors);
  }

  try {
    const ctx: DispatchContext = {
      serverInfo: SERVER_INFO,
      instructions: serverInstructions(principal.scopes),
      tools: CUSTOMER_TOOLS,
      // Writes are possible only through scoped tools; the filter below is the gate.
      allowMutations: true,
      toolFilter: customerToolFilter(principal.scopes),
      toolContext: {
        db,
        serviceDb: undefined, // never
        orgId: principal.orgId,
        userId: principal.userId,
        scopes: principal.scopes,
        patId: principal.patId,
        actions: tokenHash ? actionStore(booted.resolverDb, tokenHash) : undefined,
        edge: edgeInvoker(config.supabaseUrl, config.supabaseAnonKey, userJwt),
      },
      logContext: { pat_id: principal.patId, org_id: principal.orgId },
    };
    const result = await handleRpcPayload(payload, ctx);
    if (result === null) return new Response(null, { status: 202, headers: cors });
    return json(result, 200, cors);
  } catch (e) {
    await logError(e, {
      functionName: "crm-mcp",
      organizationId: principal.orgId,
      extra: { stage: "dispatch", pat_id: principal.patId },
    });
    return rpcError(-32603, "Internal error", 500, cors);
  }
});
