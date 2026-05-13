/**
 * Assign User to Org - Edge Function (Master only)
 *
 * Vincula um usuário que já se cadastrou (auth.users) a uma organização,
 * criando team_member e user_role. Apenas Master pode chamar.
 */

import { withSentry } from '../_shared/sentry.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY =
  Deno.env.get("ANON_KEY_2")?.trim() ||
  Deno.env.get("ANON_KEY")?.trim() ||
  Deno.env.get("SUPABASE_ANON_KEY")?.trim() ||
  "";

function jsonResponse(
  data: Record<string, unknown>,
  status: number,
  corsHeaders: Record<string, string>
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface AssignBody {
  user_id: string;
  organization_id: string;
  role?: string;
  email?: string;
  full_name?: string;
  job_title?: string;
  metric_type?: string;
}

serve(withSentry('assign-user-to-org', async (req) => {
  const origin = req.headers.get("Origin") ?? undefined;
  const corsHeaders = withSecurityHeaders(getCorsHeaders(origin));

  if (req.method === "OPTIONS") {
    return new Response("", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405, corsHeaders);
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const userJwt =
      req.headers.get("X-User-JWT")?.trim() ||
      req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "")?.trim() ||
      "";
    if (!userJwt || !SUPABASE_ANON_KEY) {
      return jsonResponse(
        { success: false, error: "Unauthorized", message: "JWT obrigatório" },
        401,
        corsHeaders
      );
    }

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = await anonClient.auth.getUser(userJwt);
    if (userError || !user?.id) {
      return jsonResponse(
        { success: false, error: "Unauthorized", message: "JWT inválido ou expirado" },
        401,
        corsHeaders
      );
    }

    const { data: masterRow } = await supabase
      .from("master_users")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!masterRow?.id) {
      return jsonResponse(
        { success: false, error: "Forbidden", message: "Apenas Master pode vincular usuários" },
        403,
        corsHeaders
      );
    }

    let body: AssignBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        { success: false, error: "Bad request", message: "JSON inválido" },
        400,
        corsHeaders
      );
    }

    const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
    const organizationId = typeof body.organization_id === "string" ? body.organization_id.trim() : "";
    const role = typeof body.role === "string" ? body.role.trim() : "member";
    const emailFromBody = typeof body.email === "string" ? body.email.trim() : "";
    const fullNameFromBody = typeof body.full_name === "string" ? body.full_name.trim() : null;
    const jobTitle = typeof body.job_title === "string" ? body.job_title.trim() : "";
    const rawMetricType = typeof body.metric_type === "string" ? body.metric_type.trim() : "";
    const metricType = rawMetricType === "sales" ? "sales" : "meetings";

    if (!userId || !organizationId) {
      return jsonResponse(
        { success: false, error: "Bad request", message: "user_id e organization_id são obrigatórios" },
        400,
        corsHeaders
      );
    }

    const { data: orgRow } = await supabase
      .from("organizations")
      .select("id")
      .eq("id", organizationId)
      .maybeSingle();
    if (!orgRow) {
      return jsonResponse(
        { success: false, error: "Bad request", message: "Organização não encontrada" },
        404,
        corsHeaders
      );
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();
    const name = fullNameFromBody || profile?.full_name || emailFromBody?.split("@")[0] || "Usuário";
    const email = emailFromBody || "";

    const { data: existing } = await supabase
      .from("team_members")
      .select("id")
      .eq("user_id", userId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (existing) {
      return jsonResponse(
        { success: true, message: "Usuário já está nesta organização." },
        200,
        corsHeaders
      );
    }

    const roleForInsert = role === "member" ? "sdr" : role;
    const { error: tmErr } = await supabase.from("team_members").insert({
      user_id: userId,
      organization_id: organizationId,
      name,
      role: roleForInsert,
      email: email || undefined,
      is_active: true,
      metric_type: metricType,
      ...(jobTitle ? { job_title: jobTitle } : {}),
    });
    if (tmErr) {
      console.error("[assign-user-to-org] team_members insert:", tmErr);
      return jsonResponse(
        { success: false, error: "Insert failed", message: tmErr.message },
        500,
        corsHeaders
      );
    }

    const { error: urErr } = await supabase.from("user_roles").upsert(
      { user_id: userId, role: roleForInsert },
      { onConflict: "user_id,role", ignoreDuplicates: true }
    );
    if (urErr) {
      console.error("[assign-user-to-org] user_roles upsert:", urErr);
      await supabase
        .from("team_members")
        .delete()
        .eq("user_id", userId)
        .eq("organization_id", organizationId);
      return jsonResponse(
        { success: false, error: "Insert failed", message: urErr.message },
        500,
        corsHeaders
      );
    }

    await logRuntime({
      organizationId,
      module: "permission",
      action: "assign_user",
      status: "success",
      entityType: "user",
      entityId: userId,
      triggeredBy: user.id,
    });

    return jsonResponse(
      { success: true, message: "Usuário vinculado à organização com sucesso." },
      200,
      corsHeaders
    );
  } catch (err) {
    console.error("[assign-user-to-org]", err);
    await logRuntime({
      module: "permission",
      action: "assign_user",
      status: "error",
      errorMessage: String(err),
    });
    return jsonResponse(
      { success: false, error: "Internal server error", message: String(err) },
      500,
      { ...corsHeaders, "Content-Type": "application/json" }
    );
  }
}));
