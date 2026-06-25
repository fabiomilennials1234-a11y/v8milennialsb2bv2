/**
 * create-pat — issue a crm-mcp Personal Access Token for the authenticated user.
 * (.specs/features/crm-mcp/DESIGN.md §7.1/§7.5; ADR 0012.)
 *
 * This is the ONLY place a plaintext token exists: the function generates it, stores ONLY
 * its hash (display-once), and returns the plaintext once. Listing/revoking is done directly
 * by the frontend via RLS (no edge function needed). Generation reuses crm-mcp/lib/pat.ts so
 * the token format + hash stay in lockstep with what the MCP resolver expects.
 *
 * Auth: verify_jwt=true (platform default — NOT listed in config.toml). The caller's session
 * JWT is validated by the platform, then reused to INSERT under the user's own RLS
 * (pat_owner_insert: user_id = auth.uid() AND org ∈ get_my_organization_ids()). No
 * service_role, no master. A master caller is refused (their ops live in torque-mcp).
 */
import { createClient } from "@supabase/supabase-js";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { captureError } from "../_shared/sentry.ts";
import { generatePat, type PatEnv } from "../crm-mcp/lib/pat.ts";

const DEFAULT_EXPIRY_DAYS = 90;
const MAX_EXPIRY_DAYS = 366; // mirrors GitHub's PAT ceiling (DESIGN §4.6)
const ALLOWED_SCOPES = new Set(["read"]); // v1 is read-only (NG2); :write reserved, not issued

interface CreateBody {
  name?: unknown;
  organization_id?: unknown;
  scopes?: unknown;
  expires_in_days?: unknown;
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, cors);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization." }, 401, cors);

  try {
    // Client bound to the CALLER's JWT — all DB ops run under the user's own RLS.
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
    );

    const { data: auth, error: authErr } = await userClient.auth.getUser();
    if (authErr || !auth.user) return json({ error: "Unauthorized." }, 401, cors);
    const userId = auth.user.id;

    // Master-reject at issuance too (DESIGN §4.3.1, H1): a master PAT would never resolve
    // anyway, so refuse early with a clear message. is_master_user is SECURITY DEFINER.
    const { data: isMaster } = await userClient.rpc("is_master_user");
    if (isMaster === true) {
      return json(
        { error: "Master users manage operations via torque-mcp, not customer PATs." },
        403,
        cors,
      );
    }

    const body = (await req.json().catch(() => ({}))) as CreateBody;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const orgId = typeof body.organization_id === "string" ? body.organization_id.trim() : "";
    if (!name) return json({ error: "name is required." }, 400, cors);
    if (!orgId) return json({ error: "organization_id is required." }, 400, cors);

    const scopes = Array.isArray(body.scopes) && body.scopes.length > 0
      ? body.scopes.map(String)
      : ["read"];
    if (!scopes.every((s) => ALLOWED_SCOPES.has(s))) {
      return json(
        { error: `Unsupported scope. Allowed: ${[...ALLOWED_SCOPES].join(", ")}` },
        400,
        cors,
      );
    }

    const days = Number(body.expires_in_days);
    const expiryDays = Number.isFinite(days) && days > 0
      ? Math.min(days, MAX_EXPIRY_DAYS)
      : DEFAULT_EXPIRY_DAYS;
    const expiresAt = new Date(Date.now() + expiryDays * 86_400_000).toISOString();

    const env: PatEnv = Deno.env.get("CRM_MCP_TOKEN_ENV") === "live" ? "live" : "test";
    const { token, tokenHash, tokenPrefix } = await generatePat(env, {
      pepper: Deno.env.get("CRM_MCP_PAT_PEPPER") || undefined,
    });

    // INSERT under the user's RLS — pat_owner_insert enforces (user_id = auth.uid() AND
    // org ∈ get_my_organization_ids()). A non-member org → RLS denies → mapped to 403.
    const { data: row, error: insErr } = await userClient
      .from("personal_access_tokens")
      .insert({
        organization_id: orgId,
        user_id: userId,
        name,
        token_hash: tokenHash,
        token_prefix: tokenPrefix,
        scopes,
        expires_at: expiresAt,
        created_by: userId,
      })
      .select("id, expires_at")
      .single();

    if (insErr || !row) {
      // RLS denial or constraint error — do not leak details; the common case is "not a member".
      return json({ error: "Could not create token for this organization." }, 403, cors);
    }

    // Plaintext token returned ONCE. Never stored, never logged.
    return json(
      { pat_id: row.id, token, token_prefix: tokenPrefix, expires_at: row.expires_at, scopes },
      201,
      cors,
    );
  } catch (e) {
    await captureError(e, { functionName: "create-pat" });
    return json({ error: "Internal error." }, 500, cors);
  }
});
