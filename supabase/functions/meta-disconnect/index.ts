import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { requireAdmin, AuthError, authErrorResponse } from "../_shared/user-auth.ts";
Deno.serve(withErrorBoundary("meta-disconnect", async (req) => {
  const headers = withSecurityHeaders({ ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return new Response(null, { status: 405, headers });
  try {
    const body = await req.json();
    if (!body.organization_id) return new Response(JSON.stringify({ error: "organization_required" }), { status: 400, headers });
    const auth = await requireAdmin(req, { body, denyGestor: true });
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    if (body.action === "toggle" && typeof body.isActive === "boolean") {
      const { data, error } = await client.from("meta_pages").update({ is_active: body.isActive }).eq("id", body.pageId).eq("organization_id", auth.organizationId).select("id").maybeSingle();
      if (error || !data) return new Response(JSON.stringify({ error: "page_not_found" }), { status: 404, headers });
    } else if (body.action === "disconnect" || body.action === undefined) {
      const { data, error } = await client.rpc("meta_disconnect_connection", { p_org_id: auth.organizationId, p_connection_id: body.connectionId });
      if (error || data !== true) return new Response(JSON.stringify({ error: "connection_not_found" }), { status: 404, headers });
    } else return new Response(JSON.stringify({ error: "invalid_action" }), { status: 400, headers });
    return new Response(JSON.stringify({ success: true }), { headers });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error, headers);
    return new Response(JSON.stringify({ error: "request_failed" }), { status: 400, headers });
  }
}));
