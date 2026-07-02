/**
 * crm-mcp — customer-facing "bring-your-own-AI" MCP server (Edge Function, Streamable HTTP).
 * Scenario B of docs/adr/0011; full spec in .specs/features/crm-mcp/DESIGN.md.
 *
 * Pipeline (mirrors torque-mcp, swapping ONLY the auth layer for a per-PAT path):
 *   L1 HTTP   — CORS / OPTIONS / POST-only. The bearer PAT IS the credential (no x-mcp-secret).
 *   L2 AUTH   — parse PAT → hash → hermetic resolve RPC → pure classify + eligibility
 *               (master-reject H1, org-drift M5) → mint ES256 user JWT → HARD-FAIL-CLOSED
 *               assert → per-user RLS client. service_role is never in scope.
 *   L3/L4     — the shared spine dispatch with a fail-closed customer toolFilter.
 */
import { createClient } from "@supabase/supabase-js";
import { importJWK } from "jose";
import { getCorsHeaders } from "../_shared/cors.ts";
import { captureError } from "../_shared/sentry.ts";
import { handleRpcPayload } from "../_shared/mcp/http.ts";
import type { DispatchContext } from "../_shared/mcp/dispatch.ts";
import type { JsonRpcRequest, ToolDef } from "../_shared/mcp/types.ts";
import { loadConfig } from "./lib/config.ts";
import {
  assertEligiblePrincipal,
  assertWellFormedJwt,
  classifyTokenRow,
  hashToken,
  mintUserJwt,
  parsePat,
  type PatRow,
} from "./lib/pat.ts";
import { CUSTOMER_TOOLS } from "./tools/index.ts";

// --- boot (fail loud) -----------------------------------------------------------------
const config = loadConfig(Deno.env.toObject()); // throws if ops secrets present or reqs missing

// Import the dedicated ES256 signing key ONCE per isolate. A bad key fails the boot loudly
// rather than per-request (DESIGN §4.4/§4.5). Private key only — never service_role material.
const signingKey = await importJWK(JSON.parse(config.jwtSigningKeyJwk), "ES256") as CryptoKey;

const SERVER_INFO = { name: "torque-crm", version: "0.1.0" }; // NO project — no env reconnaissance
const CUSTOMER_TOOL_FILTER = (t: ToolDef) => t.readonly === true && t.customerExposed === true;

// Anon-key client for the PRE-AUTH resolve only (role `anon`; the resolve RPC is hermetic).
// Never used for tenant data — that always goes through the per-request per-user client.
const resolveDb = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function rpcError(
  code: number,
  message: string,
  status: number,
  cors: Record<string, string>,
): Response {
  return json({ jsonrpc: "2.0", id: null, error: { code, message } }, status, cors);
}

function bearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

interface ResolvedPrincipal {
  userId: string;
  orgId: string;
  scopes: string[];
  email: string;
}

type ResolveResult =
  | { ok: true; principal: ResolvedPrincipal }
  | { ok: false; status: 401 | 403; message: string };

/**
 * Full PAT resolution: offline parse → hash → hermetic resolve RPC → pure status check →
 * pure eligibility (master-reject, membership). The pure decisions live in lib/pat.ts and
 * are unit-tested; this orchestrates the DB calls around them.
 */
async function resolvePat(token: string): Promise<ResolveResult> {
  const parsed = parsePat(token);
  if (!parsed) return { ok: false, status: 401, message: "Unauthorized" }; // malformed/bad CRC

  const hash = await hashToken(parsed.full, config.patPepper);
  const { data, error } = await resolveDb.rpc("crm_mcp_resolve_token", { p_hash: hash });
  if (error) throw new Error(`resolve_token failed: ${error.message}`);

  const rows = (Array.isArray(data) ? data : []) as Array<
    PatRow & { is_master: boolean; current_org_ids: string[] }
  >;
  const row = rows[0] ?? null;

  const status = classifyTokenRow(row, Date.now());
  if (status.kind === "unauthorized") return { ok: false, status: 401, message: "Unauthorized" };
  if (status.kind === "forbidden") return { ok: false, status: 403, message: "Forbidden" };

  // Pass the resolver values RAW — assertEligiblePrincipal fails closed on anything that is
  // not a strict boolean false / a real org array (never reads a drifted flag as "not master").
  const eligibility = assertEligiblePrincipal({
    isMaster: row!.is_master,
    currentOrgIds: row!.current_org_ids,
    patOrgId: row!.organization_id,
  });
  if (eligibility) return { ok: false, status: 403, message: "Forbidden" };

  return {
    ok: true,
    principal: {
      userId: row!.user_id,
      orgId: row!.organization_id,
      scopes: row!.scopes ?? ["read"],
      // email is not returned by the resolver; the minted JWT can carry an empty email.
      email: "",
    },
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") {
    return json({ error: "Method not allowed; POST a JSON-RPC body." }, 405, cors);
  }

  const token = bearer(req.headers.get("authorization"));
  if (!token) return rpcError(-32001, "Unauthorized", 401, cors);

  let resolution: ResolveResult;
  try {
    resolution = await resolvePat(token);
  } catch (e) {
    await captureError(e, { functionName: "crm-mcp", extra: { stage: "resolve" } });
    return rpcError(-32603, "Internal error", 500, cors);
  }
  if (!resolution.ok) {
    return rpcError(
      resolution.status === 403 ? -32003 : -32001,
      resolution.message,
      resolution.status,
      cors,
    );
  }
  const { principal } = resolution;

  // Mint the short-lived per-user JWT and HARD-FAIL-CLOSED before building any client (H3a):
  // a malformed mint must never let the request fall back to the anon role.
  let userJwt: string;
  try {
    userJwt = await mintUserJwt({
      userId: principal.userId,
      email: principal.email,
      projectRef: config.projectRef,
      signingKey,
      kid: config.jwtKid,
    }, Math.floor(Date.now() / 1000));
    assertWellFormedJwt(userJwt);
  } catch (e) {
    await captureError(e, { functionName: "crm-mcp", extra: { stage: "mint" } });
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
    payload = await req.json();
  } catch {
    return rpcError(-32700, "Parse error", 400, cors);
  }

  try {
    const ctx: DispatchContext = {
      serverInfo: SERVER_INFO,
      tools: CUSTOMER_TOOLS,
      allowMutations: false, // hard-pinned: no customer mutations in v1
      toolFilter: CUSTOMER_TOOL_FILTER, // fail-closed positive allowlist (readonly && customerExposed)
      toolContext: {
        db,
        serviceDb: undefined, // never
        orgId: principal.orgId,
        userId: principal.userId,
        scopes: principal.scopes,
      },
    };
    const result = await handleRpcPayload(payload, ctx);
    if (result === null) return new Response(null, { status: 202, headers: cors });
    return json(result, 200, cors);
  } catch (e) {
    await captureError(e, { functionName: "crm-mcp", extra: { stage: "dispatch" } });
    return rpcError(-32603, "Internal error", 500, cors);
  }
});
