// supabase/functions/meta-conversation-profile/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { logRuntime } from "../_shared/logger.ts";
import { requireAuth, AuthError, authErrorResponse } from "../_shared/user-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH_API_VERSION = "v21.0";
const PROFILE_TTL_HOURS = 24;

interface ProfileFetchResult {
  external_username: string | null;
  profile_pic_url: string | null;
}

async function fetchGraphProfile(
  externalUserId: string,
  pageAccessToken: string
): Promise<ProfileFetchResult> {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${externalUserId}?fields=name,profile_pic`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${pageAccessToken}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    return { external_username: null, profile_pic_url: null };
  }
  const json = await res.json();
  return {
    external_username: json.name ?? null,
    profile_pic_url: json.profile_pic ?? null,
  };
}

Deno.serve(withErrorBoundary("meta-conversation-profile", async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
  const headers = { ...corsHeaders, "Content-Type": "application/json" };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  let body: { conversationId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_body" }), { status: 400, headers });
  }

  const { conversationId } = body;
  if (!conversationId) {
    return new Response(JSON.stringify({ error: "conversationId_required" }), { status: 400, headers });
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

  const { data: conv, error: convErr } = await supabase
    .from("meta_conversations")
    .select("id, organization_id, meta_page_id, external_user_id, external_username, profile_pic_url, profile_pic_expires_at")
    .eq("id", conversationId)
    .single();

  if (convErr || !conv) {
    return new Response(JSON.stringify({ error: "conversation_not_found" }), { status: 404, headers });
  }

  if (conv.organization_id !== auth.organizationId) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers });
  }

  // Cache hit
  if (
    conv.profile_pic_expires_at &&
    new Date(conv.profile_pic_expires_at).getTime() > Date.now() &&
    (conv.external_username || conv.profile_pic_url)
  ) {
    return new Response(
      JSON.stringify({
        external_username: conv.external_username,
        profile_pic_url: conv.profile_pic_url,
        cached: true,
      }),
      { status: 200, headers }
    );
  }

  const { data: page } = await supabase
    .from("meta_pages")
    .select("page_access_token")
    .eq("id", conv.meta_page_id)
    .eq("organization_id", auth.organizationId)
    .single();

  if (!page?.page_access_token) {
    await logRuntime({
      organizationId: auth.organizationId,
      module: "channel",
      action: "meta_profile_refresh",
      status: "error",
      errorMessage: "page_token_missing",
      entityType: "meta_conversation",
      entityId: conv.id,
    });
    return new Response(
      JSON.stringify({ external_username: null, profile_pic_url: null, cached: false }),
      { status: 200, headers }
    );
  }

  const profile = await fetchGraphProfile(conv.external_user_id, page.page_access_token);

  if (profile.external_username === null && profile.profile_pic_url === null) {
    await logRuntime({
      organizationId: auth.organizationId,
      module: "channel",
      action: "meta_profile_refresh",
      status: "error",
      errorMessage: "graph_api_returned_empty",
      entityType: "meta_conversation",
      entityId: conv.id,
    });
  } else {
    await logRuntime({
      organizationId: auth.organizationId,
      module: "channel",
      action: "meta_profile_refresh",
      status: "success",
      entityType: "meta_conversation",
      entityId: conv.id,
    });
  }

  const expiresAt = new Date(Date.now() + PROFILE_TTL_HOURS * 3600 * 1000).toISOString();
  await supabase
    .from("meta_conversations")
    .update({
      external_username: profile.external_username ?? conv.external_username,
      profile_pic_url: profile.profile_pic_url ?? conv.profile_pic_url,
      profile_pic_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conv.id);

  return new Response(
    JSON.stringify({
      external_username: profile.external_username,
      profile_pic_url: profile.profile_pic_url,
      cached: false,
    }),
    { status: 200, headers }
  );
}));
