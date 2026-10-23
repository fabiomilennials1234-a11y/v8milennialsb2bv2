/** Server-issued Business OAuth URL; current org admin, dedicated app and single-use nonce. */

import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { requireAdmin, AuthError, authErrorResponse } from "../_shared/user-auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { metaBusinessConfig, businessLoginUrl } from "../_shared/meta-business.ts";
import { signMetaState } from "../_shared/meta-oauth-state.ts";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — enough for the OAuth round-trip.

Deno.serve(withErrorBoundary("meta-oauth-start", async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
  const headers = { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") return new Response(null, { status: 405, headers });
  if (Deno.env.get("META_CRM_OAUTH_ENABLED") !== "true") return new Response(JSON.stringify({ error: "meta_crm_disabled" }), { status: 503, headers });

  let body: { connectionType?: string; organization_id?: string; authType?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_body" }), { status: 400, headers });
  }

  // Current org admin (or active master) must authorize credential management.
  let auth;
  try {
    auth = await requireAdmin(req, { body, denyGestor: true });
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e, corsHeaders);
    throw e;
  }

  if (!auth.organizationId) {
    return new Response(JSON.stringify({ error: "organization_required" }), { status: 400, headers });
  }

  const connectionType = body.connectionType === "instagram" ? "instagram" : "facebook";

  if (!body.organization_id) return new Response(JSON.stringify({ error: "organization_required" }), { status: 400, headers });
  const config = metaBusinessConfig();
  const secret = config.secret;

  const nonce = crypto.randomUUID();
  const expiresAt = Date.now() + STATE_TTL_MS;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: nonceError } = await supabase.from("meta_oauth_nonces").insert({ nonce, user_id: auth.userId, organization_id: auth.organizationId, app_id: config.appId, connection_type: connectionType, expires_at: new Date(expiresAt).toISOString() });
  if (nonceError) return new Response(JSON.stringify({ error: "state_storage_unavailable" }), { status: 503, headers });
  const state = await signMetaState(
    {
      userId: auth.userId,
      orgId: auth.organizationId,
      connectionType,
      nonce,
      appId: config.appId,
      configId: config.configId,
      exp: expiresAt,
    },
    secret,
  );

  return new Response(JSON.stringify({ state, loginUrl: businessLoginUrl(config, state, body.authType === "rerequest" ? "rerequest" : undefined) }), { status: 200, headers });
}));
