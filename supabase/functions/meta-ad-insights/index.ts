import { storedMetaToken } from "../_shared/meta-token-crypto.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { requireAdmin, AuthError, authErrorResponse } from "../_shared/user-auth.ts";
import { metaGraphFetch } from "../_shared/meta-graph-request.ts";
import { insightDateRange } from "../_shared/meta-ad-assets.ts";
Deno.serve(withErrorBoundary("meta-ad-insights", async (req) => {
  const headers = withSecurityHeaders({ ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json", "Cache-Control": "no-store" });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return new Response(null, { status: 405, headers });
  try {
    const body = await req.json();
    if (!body.organization_id) return new Response(JSON.stringify({ error: "organization_required" }), { status: 400, headers });
    const auth = await requireAdmin(req, { body, denyGestor: true });
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    if (body.action === "accounts") {
      const { data, error } = await client.from("meta_ad_accounts").select("account_id,name,currency,account_status,meta_connections!inner(status)").eq("organization_id", auth.organizationId).eq("is_active", true).eq("meta_connections.status", "connected");
      if (error) throw new Error("storage_unavailable");
      return new Response(JSON.stringify({ accounts: data?.map(({ account_id, name, currency, account_status }) => ({ account_id, name, currency, account_status })) ?? [] }), { headers });
    }
    if (!/^act_\d+$/.test(body.accountId ?? "") || !["insights", "campaigns"].includes(body.action)) return new Response(JSON.stringify({ error: "invalid_request" }), { status: 400, headers });
    const { data: account, error } = await client.from("meta_ad_accounts").select("meta_connections!inner(access_token,app_id,status,facebook_user_id)").eq("organization_id", auth.organizationId).eq("account_id", body.accountId).eq("is_active", true).eq("meta_connections.status", "connected").limit(1).maybeSingle();
    if (error || !account) return new Response(JSON.stringify({ error: "account_not_authorized" }), { status: 404, headers });
    const binding = Array.isArray(account.meta_connections) ? account.meta_connections[0] : account.meta_connections;
    if (!binding?.app_id) return new Response(JSON.stringify({ error: "account_not_authorized" }), { status: 404, headers });
    const url = new URL(`https://graph.facebook.com/v26.0/${body.accountId}/${body.action}`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("fields", body.action === "campaigns" ? "id,name,status,objective" : "campaign_id,campaign_name,impressions,clicks,spend,reach,actions,date_start,date_stop");
    if (body.action === "insights") {
      let range;
      try { range = insightDateRange(body.since, body.until); } catch { return new Response(JSON.stringify({ error: "invalid_date_range" }), { status: 400, headers }); }
      url.searchParams.set("time_range", JSON.stringify(range));
      url.searchParams.set("level", "campaign");
    }
    if (body.after !== undefined) {
      if (typeof body.after !== "string" || body.after.length > 2048) return new Response(JSON.stringify({ error: "invalid_cursor" }), { status: 400, headers });
      url.searchParams.set("after", body.after);
    }
    const token = await storedMetaToken(binding.access_token, binding.app_id, auth.organizationId, `connection:${binding.facebook_user_id}`);
    const response = await metaGraphFetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } }, binding.app_id);
    const result = await response.json();
    if (!response.ok || result.error || !Array.isArray(result.data)) return new Response(JSON.stringify({ error: "meta_request_failed" }), { status: 502, headers });
    return new Response(JSON.stringify({ data: result.data, after: result.paging?.next ? result.paging?.cursors?.after ?? null : null }), { headers });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error, headers);
    return new Response(JSON.stringify({ error: "request_failed" }), { status: 503, headers });
  }
}));
