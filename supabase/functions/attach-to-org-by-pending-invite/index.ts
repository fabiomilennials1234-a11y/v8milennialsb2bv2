/**
 * Attach to Org by Pending Invite - Edge Function
 *
 * Chamada após signup/signin na página inicial. Se o email do usuário está em
 * pending_org_invites, vincula o usuário à organização (team_members + user_roles)
 * e remove o registro de pending. Idempotente.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY =
  Deno.env.get("ANON_KEY_2")?.trim() ||
  Deno.env.get("ANON_KEY")?.trim() ||
  Deno.env.get("SUPABASE_ANON_KEY")?.trim() ||
  "";

const CORS_PREFLIGHT_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("", { status: 200, headers: CORS_PREFLIGHT_HEADERS });
  }

  let corsHeaders: Record<string, string>;
  try {
    corsHeaders = getCorsHeaders(req.headers.get("origin"));
  } catch {
    corsHeaders = CORS_PREFLIGHT_HEADERS;
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { success: false, error: "Method not allowed" },
      405,
      corsHeaders
    );
  }

  try {
    const bearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "")?.trim();
    if (!bearer) {
      return jsonResponse(
        { success: false, error: "Unauthorized", message: "Authorization Bearer (JWT) é obrigatório" },
        401,
        corsHeaders
      );
    }

    const anonClient = SUPABASE_ANON_KEY
      ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          global: { headers: { Authorization: `Bearer ${bearer}` } },
          auth: { persistSession: false },
        })
      : null;
    let user: { id: string; email?: string } | null = null;
    if (anonClient) {
      const { data: u, error: userError } = await anonClient.auth.getUser();
      if (!userError && u) user = { id: u.id, email: u.email };
    }
    if (!user?.id || !user?.email) {
      return jsonResponse(
        { success: false, error: "Unauthorized", message: "JWT inválido ou expirado" },
        401,
        corsHeaders
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const emailLower = user.email.trim().toLowerCase();
    const { data: pending, error: pendingError } = await supabase
      .from("pending_org_invites")
      .select("id, organization_id, role")
      .eq("email", emailLower)
      .maybeSingle();

    if (pendingError) {
      console.error("[attach-to-org-by-pending-invite] pending lookup:", pendingError);
      return jsonResponse(
        { success: false, error: "Internal error", message: pendingError.message },
        500,
        corsHeaders
      );
    }

    if (!pending) {
      return jsonResponse(
        { success: true, attached: false, message: "Nenhum pré-cadastro para este email." },
        200,
        corsHeaders
      );
    }

    const { organization_id: orgId, role } = pending;
    const roleForInsert = role === "member" ? "sdr" : role;
    const name = user.email.split("@")[0];

    // Idempotente: já está na org?
    const { data: existing } = await supabase
      .from("team_members")
      .select("id")
      .eq("user_id", user.id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (existing) {
      await supabase.from("pending_org_invites").delete().eq("id", pending.id);
      return jsonResponse(
        { success: true, attached: true, organization_id: orgId, message: "Você já está nesta organização." },
        200,
        corsHeaders
      );
    }

    await supabase.from("profiles").upsert(
      { id: user.id, full_name: name },
      { onConflict: "id" }
    );

    const { error: tmError } = await supabase.from("team_members").insert({
      user_id: user.id,
      organization_id: orgId,
      name,
      role: roleForInsert,
      email: user.email,
      is_active: true,
    });

    if (tmError) {
      console.error("[attach-to-org-by-pending-invite] team_members insert:", tmError);
      return jsonResponse(
        { success: false, error: "Insert failed", message: tmError.message },
        500,
        corsHeaders
      );
    }

    const { error: urError } = await supabase.from("user_roles").insert({
      user_id: user.id,
      role: roleForInsert,
    });

    if (urError) {
      // Pode já existir (ex.: outro org); ignorar conflito
      if (!String(urError.message).toLowerCase().includes("duplicate")) {
        console.error("[attach-to-org-by-pending-invite] user_roles insert:", urError);
        await supabase.from("team_members").delete().eq("user_id", user.id).eq("organization_id", orgId);
        return jsonResponse(
          { success: false, error: "Insert failed", message: urError.message },
          500,
          corsHeaders
        );
      }
    }

    await supabase.from("pending_org_invites").delete().eq("id", pending.id);

    return jsonResponse(
      {
        success: true,
        attached: true,
        organization_id: orgId,
        message: "Você foi vinculado à organização. Bem-vindo!",
      },
      200,
      corsHeaders
    );
  } catch (err) {
    console.error("[attach-to-org-by-pending-invite]", err);
    return jsonResponse(
      { success: false, error: "Internal server error", message: String(err) },
      500,
      { ...CORS_PREFLIGHT_HEADERS, "Content-Type": "application/json" }
    );
  }
});
