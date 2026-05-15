import { withSentry } from '../_shared/sentry.ts';
import { logRuntime } from "../_shared/logger.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { requireAuth, AuthError, authErrorResponse } from "../_shared/user-auth.ts";
import { timingSafeCompare } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// SZ.chat agent credentials from env vars (not DB — security best practice)
const SZ_CHAT_AGENT_EMAIL = Deno.env.get("SZ_CHAT_AGENT_EMAIL") || "";
const SZ_CHAT_AGENT_PASSWORD = Deno.env.get("SZ_CHAT_AGENT_PASSWORD") || "";

interface SzChatConfig {
  api_url: string;
  api_token: string | null;
  channel_id: string | null;
  team_mappings: Record<string, string>;
  whatsapp_instance_id: string | null;
}

interface SendRequest {
  action: "send_message" | "transfer_back" | "finish_session" | "auth_refresh" | "get_active_session";
  organization_id: string;
  phone_number?: string;
  message?: string;
  message_type?: "text" | "media";
  media_url?: string;
  session_id?: string;
  target_team_id?: string;
  target_team_name?: string;
}

/**
 * Authenticate with SZ.chat API. Tries refresh first, falls back to login.
 * Persists new token in sz_chat_config for reuse.
 */
async function ensureAuth(
  supabase: ReturnType<typeof createClient>,
  config: SzChatConfig,
  orgId: string
): Promise<string> {
  // Try refreshing existing token
  if (config.api_token) {
    try {
      const refreshRes = await fetch(`${config.api_url}/auth/refresh`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${config.api_token}`,
          "Content-Type": "application/json",
        },
      });
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        const newToken = refreshData.token || refreshData.data?.token;
        if (newToken) {
          await supabase
            .from("sz_chat_config")
            .update({ api_token: newToken, updated_at: new Date().toISOString() })
            .eq("organization_id", orgId);
          return newToken;
        }
      }
    } catch {
      console.warn("[SZ Chat Send] Token refresh failed, falling back to login");
    }
    // Do NOT return stale token — fall through to login
  }

  // Login with email/password from env vars
  if (!SZ_CHAT_AGENT_EMAIL || !SZ_CHAT_AGENT_PASSWORD) {
    throw new Error("SZ.chat credentials not configured (set SZ_CHAT_AGENT_EMAIL and SZ_CHAT_AGENT_PASSWORD env vars)");
  }

  const loginRes = await fetch(`${config.api_url}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: SZ_CHAT_AGENT_EMAIL,
      password: SZ_CHAT_AGENT_PASSWORD,
    }),
  });

  if (!loginRes.ok) {
    const err = await loginRes.text();
    throw new Error(`SZ.chat login failed: ${loginRes.status} ${err}`);
  }

  const loginData = await loginRes.json();
  const token = loginData.token || loginData.data?.token;
  if (!token) throw new Error("SZ.chat login response missing token");

  // Cache token for reuse
  await supabase
    .from("sz_chat_config")
    .update({ api_token: token, updated_at: new Date().toISOString() })
    .eq("organization_id", orgId);

  return token;
}

async function sendMessage(
  config: SzChatConfig,
  token: string,
  params: { phone_number: string; message: string; message_type?: string; media_url?: string }
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const body: Record<string, unknown> = {
    platform_id: params.phone_number,
    channel_id: config.channel_id,
    type: params.message_type || "text",
    message: params.message,
    close_session: 3, // 3 = manter estado atual
  };
  if (params.media_url) {
    body.file = params.media_url;
    body.type = "media";
  }

  const res = await fetch(`${config.api_url}/message/send`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return res.ok ? { success: true, data } : { success: false, error: data.error || data.message || `HTTP ${res.status}` };
}

async function transferBack(
  config: SzChatConfig, token: string, sessionId: string, targetTeamId: string
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${config.api_url}/attendances/transfer`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, type: "attendance", attendance_id: targetTeamId, transfer_wait: true }),
  });
  const data = await res.json();
  return res.ok ? { success: true } : { success: false, error: data.error || data.message || `HTTP ${res.status}` };
}

async function finishSession(
  config: SzChatConfig, token: string, sessionId: string
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${config.api_url}/attendances/finish`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
  const data = await res.json();
  return res.ok ? { success: true } : { success: false, error: data.error || data.message || `HTTP ${res.status}` };
}

Deno.serve(withSentry('sz-chat-send', async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body: SendRequest = await req.json();

    if (!body.organization_id) {
      return new Response(JSON.stringify({ error: "organization_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Auth: accept service_role key (internal edge function calls) or user JWT (frontend)
    const authHeader = req.headers.get("authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const isServiceRole = !!SUPABASE_SERVICE_ROLE_KEY && !!bearerToken &&
      timingSafeCompare(bearerToken, SUPABASE_SERVICE_ROLE_KEY);

    if (!isServiceRole) {
      try {
        const authCtx = await requireAuth(req, {
          body: body as unknown as Record<string, unknown>,
          organizationId: body.organization_id,
        });
        if (authCtx.organizationId !== body.organization_id) {
          return new Response(JSON.stringify({ error: "Forbidden: org mismatch" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      } catch (e) {
        if (e instanceof AuthError) return authErrorResponse(e, corsHeaders);
        throw e;
      }
    }

    const { data: config, error: configError } = await supabase
      .from("sz_chat_config").select("*")
      .eq("organization_id", body.organization_id).eq("is_active", true).single();

    if (configError || !config) {
      return new Response(JSON.stringify({ error: "SZ.chat not configured for this organization" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const token = await ensureAuth(supabase, config as SzChatConfig, body.organization_id);
    let result: { success: boolean; data?: unknown; error?: string; session?: unknown };

    switch (body.action) {
      case "send_message": {
        if (!body.phone_number || !body.message) {
          return new Response(JSON.stringify({ error: "phone_number and message are required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        result = await sendMessage(config as SzChatConfig, token, {
          phone_number: body.phone_number, message: body.message,
          message_type: body.message_type, media_url: body.media_url,
        });
        break;
      }
      case "transfer_back": {
        if (!body.session_id) {
          return new Response(JSON.stringify({ error: "session_id is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        let teamId = body.target_team_id;
        if (!teamId && body.target_team_name) {
          const mappings = (config as SzChatConfig).team_mappings || {};
          teamId = mappings[body.target_team_name.toLowerCase()];
        }
        if (!teamId) {
          return new Response(JSON.stringify({ error: "target_team_id or valid target_team_name is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        result = await transferBack(config as SzChatConfig, token, body.session_id, teamId);
        if (result.success) {
          await supabase.from("sz_chat_sessions")
            .update({ status: "transferred_back", updated_at: new Date().toISOString() })
            .eq("sz_chat_session_id", body.session_id).eq("organization_id", body.organization_id);
        }
        break;
      }
      case "finish_session": {
        if (!body.session_id) {
          return new Response(JSON.stringify({ error: "session_id is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        result = await finishSession(config as SzChatConfig, token, body.session_id);
        if (result.success) {
          await supabase.from("sz_chat_sessions")
            .update({ status: "finished", updated_at: new Date().toISOString() })
            .eq("sz_chat_session_id", body.session_id).eq("organization_id", body.organization_id);
        }
        break;
      }
      case "auth_refresh": {
        result = { success: true, data: { message: "Token refreshed" } };
        break;
      }
      case "get_active_session": {
        if (!body.phone_number) {
          return new Response(JSON.stringify({ error: "phone_number is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        // Normalize phone
        const phone = body.phone_number.replace(/\D/g, "");
        const { data: session } = await supabase
          .from("sz_chat_sessions")
          .select("sz_chat_session_id, status, contact_name")
          .eq("organization_id", body.organization_id)
          .eq("phone_number", phone)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!session) {
          result = { success: true, session: null };
        } else {
          result = {
            success: true,
            session: {
              sz_chat_session_id: session.sz_chat_session_id,
              team_mappings: (config as SzChatConfig).team_mappings || {},
            },
          };
        }
        break;
      }
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${body.action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await logRuntime({
      organizationId: body.organization_id, module: "sz_chat", action: body.action,
      status: result.success ? "success" : "error", errorMessage: result.error,
      payloadSnapshot: { action: body.action, phone: body.phone_number },
    });

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[SZ Chat Send] Error:", error);
    await logRuntime({ module: "sz_chat", action: "sz_chat_send", status: "error",
      errorMessage: error instanceof Error ? error.message : String(error) });
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }),
      { status: 500, headers: { ...getCorsHeaders(null), "Content-Type": "application/json" } });
  }
}));
