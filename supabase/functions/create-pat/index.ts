/**
 * create-pat — issue a crm-mcp Personal Access Token for the signed-in user.
 * (.specs/features/crm-mcp/DESIGN.md §7.1/§7.5; ADR 0012.)
 *
 * The ONLY place a plaintext token exists: generated here, stored as a hash, returned once.
 * Listing and revoking need no function — the frontend does both under RLS.
 *
 * Auth: verify_jwt=false (repo convention) and the session is validated in-function with
 * auth.getUser(). Every DB call runs under the CALLER's JWT — no service_role, no master:
 *  - `crm_mcp_issue_check(org)` explains a refusal (flag off, not a member, master…);
 *  - the INSERT policy re-checks the same thing, so the explanation can never be the gate;
 *  - the BEFORE INSERT trigger enforces the 10-active ceiling and stamps the server fields.
 */
import { createClient } from "@supabase/supabase-js";
import { getCorsHeaders } from "../_shared/cors.ts";
import { logError } from "../_shared/error-boundary.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { generatePat, type PatEnv } from "../crm-mcp/lib/pat.ts";
import { type CreateBody, parseCreateBody, refusalMessage } from "./validate.ts";

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function anonKey(): string {
  return Deno.env.get("ANON_KEY_2")?.trim() || Deno.env.get("ANON_KEY")?.trim() ||
    Deno.env.get("SUPABASE_ANON_KEY")?.trim() || "";
}

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405, cors);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Sessão ausente." }, 401, cors);

  try {
    // Client bound to the CALLER's JWT — every DB op below runs under the user's own RLS.
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, anonKey(), {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: auth, error: authErr } = await userClient.auth.getUser();
    if (authErr || !auth.user) return json({ error: "Sessão inválida." }, 401, cors);
    const userId = auth.user.id;

    const parsed = parseCreateBody((await req.json().catch(() => ({}))) as CreateBody);
    if (!parsed.ok) return json({ error: parsed.message }, 400, cors);
    const { name, organizationId, expiresInDays } = parsed.value;

    const { data: check, error: checkErr } = await userClient.rpc("crm_mcp_issue_check", {
      p_org: organizationId,
    });
    if (checkErr) throw new Error(`crm_mcp_issue_check: ${checkErr.code} ${checkErr.message}`);
    if (check !== "ok") {
      return json({ error: refusalMessage(String(check)), reason: check }, 403, cors);
    }

    const env: PatEnv = Deno.env.get("CRM_MCP_TOKEN_ENV") === "test" ? "test" : "live";
    const { token, tokenHash, tokenPrefix } = await generatePat(env, {
      pepper: Deno.env.get("CRM_MCP_PAT_PEPPER") || undefined,
    });
    const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000).toISOString();

    const { data: row, error: insErr } = await userClient
      .from("personal_access_tokens")
      .insert({
        organization_id: organizationId,
        user_id: userId,
        name,
        token_hash: tokenHash,
        token_prefix: tokenPrefix,
        scopes: ["read"],
        expires_at: expiresAt,
        created_by: userId,
      })
      .select("id, name, token_prefix, expires_at, created_at")
      .single();

    if (insErr || !row) {
      if (insErr?.hint === "pat_limit") {
        return json({ error: refusalMessage("pat_limit"), reason: "pat_limit" }, 409, cors);
      }
      // RLS denial or a constraint: the precheck passed, so this is a race or a regression.
      await logError(new Error(`create-pat insert: ${insErr?.code} ${insErr?.message}`), {
        functionName: "create-pat",
        organizationId,
        userId,
      });
      return json({ error: "Não foi possível criar o token." }, 403, cors);
    }

    // Plaintext returned ONCE. Never stored, never logged.
    return json({ ...row, token }, 201, cors);
  } catch (e) {
    await logError(e, { functionName: "create-pat" });
    return json({ error: "Erro interno." }, 500, cors);
  }
});
