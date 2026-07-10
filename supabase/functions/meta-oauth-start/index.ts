/**
 * meta-oauth-start
 *
 * Mints the HMAC-signed OAuth `state` for the Meta connection flow.
 *
 * SECURITY (hotfix): replaces client-built, unsigned base64 `state`. The org is
 * taken from requireAuth's validated membership (ctx.organizationId) — NOT from
 * raw client input — and the state is HMAC-signed (META_APP_SECRET) so the public
 * `meta-oauth-callback` can trust it. Closes the tenant-binding forgery where an
 * attacker crafted a `state` with a victim's orgId.
 *
 * Auth: JWT (custom via requireAuth). Body: { connectionType?, organization_id }.
 * Returns: { state } — the frontend appends it to the Facebook dialog URL.
 */

import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { requireAuth, AuthError, authErrorResponse } from "../_shared/user-auth.ts";
import { signMetaState } from "../_shared/meta-oauth-state.ts";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — enough for the OAuth round-trip.

Deno.serve(withErrorBoundary("meta-oauth-start", async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
  const headers = { ...corsHeaders, "Content-Type": "application/json" };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  let body: { connectionType?: string; organization_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_body" }), { status: 400, headers });
  }

  // requireAuth validates the JWT AND that the caller belongs to organization_id
  // (or is master). organization_id therefore cannot be forged.
  let auth;
  try {
    auth = await requireAuth(req, { body });
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e, corsHeaders);
    throw e;
  }

  if (!auth.organizationId) {
    return new Response(JSON.stringify({ error: "organization_required" }), { status: 400, headers });
  }

  const connectionType = body.connectionType === "instagram" ? "instagram" : "facebook";

  const secret = Deno.env.get("META_APP_SECRET");
  if (!secret) {
    return new Response(JSON.stringify({ error: "server_misconfigured" }), { status: 500, headers });
  }

  const state = await signMetaState(
    {
      userId: auth.userId,
      orgId: auth.organizationId,
      connectionType,
      nonce: crypto.randomUUID(),
      exp: Date.now() + STATE_TTL_MS,
    },
    secret,
  );

  return new Response(JSON.stringify({ state }), { status: 200, headers });
}));
