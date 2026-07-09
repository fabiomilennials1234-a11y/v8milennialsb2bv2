/**
 * meta-template-list — lists the Meta WhatsApp Cloud message templates of the
 * caller's organization (Slice 6, ADR-0009).
 *
 * Auth: JWT via requireAuth (config.toml verify_jwt=false → custom auth). The
 * org is taken from the auth context, never from the body — multi-tenant safe.
 * INERT until the `meta_cloud` feature flag is enabled (no template rows exist
 * until then), so this returns [] for every org today.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { requireAuth, AuthError, authErrorResponse } from "../_shared/user-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(withErrorBoundary("meta-template-list", async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin") ?? undefined));
  const headers = { ...corsHeaders, "Content-Type": "application/json" };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // GET-style call with no body is fine.
  }

  let auth;
  try {
    auth = await requireAuth(req, { body });
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e, corsHeaders);
    throw e;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Org from auth context (never the body). For master the context org may be
  // empty; an explicit body.organization_id is honored only when provided AND
  // the user is master (requireAuth already 403s a non-member/non-master).
  const orgId = auth.organizationId || (auth.isMaster ? (body.organization_id as string) : "");
  if (!orgId) {
    return new Response(JSON.stringify({ error: "organization_id_required" }), { status: 400, headers });
  }

  const { data, error } = await supabase
    .from("meta_message_templates")
    .select("id, organization_id, instance_id, name, language, category, components, meta_template_id, status, rejection_reason, created_at, updated_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }

  return new Response(JSON.stringify({ templates: data ?? [] }), { status: 200, headers });
}));
