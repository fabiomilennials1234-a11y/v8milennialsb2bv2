/**
 * Admin Reset User Password - Edge Function (Master only)
 *
 * Permite ao Master redefinir a senha de qualquer usuário (ex.: admin).
 * Usa Supabase Auth Admin API (service_role).
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
  "Access-Control-Allow-Headers": "content-type, authorization, x-user-jwt",
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

interface Body {
  user_id: string;
  new_password: string;
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
    const { data: { user: caller }, error: userError } = await anonClient.auth.getUser(userJwt);
    if (userError || !caller?.id) {
      return jsonResponse(
        { success: false, error: "Unauthorized", message: "JWT inválido ou expirado" },
        401,
        corsHeaders
      );
    }

    const { data: masterRow } = await supabase
      .from("master_users")
      .select("id")
      .eq("user_id", caller.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!masterRow?.id) {
      return jsonResponse(
        { success: false, error: "Forbidden", message: "Apenas Master pode redefinir senha de usuários" },
        403,
        corsHeaders
      );
    }

    let body: Body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        { success: false, error: "Bad request", message: "Body JSON inválido" },
        400,
        corsHeaders
      );
    }

    const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
    const newPassword = typeof body.new_password === "string" ? body.new_password.trim() : "";

    if (!userId) {
      return jsonResponse(
        { success: false, error: "Bad request", message: "user_id é obrigatório" },
        400,
        corsHeaders
      );
    }
    if (!newPassword || newPassword.length < 6) {
      return jsonResponse(
        { success: false, error: "Bad request", message: "new_password é obrigatório e deve ter no mínimo 6 caracteres" },
        400,
        corsHeaders
      );
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (updateError) {
      console.error("[admin-reset-user-password] updateUserById error:", updateError);
      return jsonResponse(
        { success: false, error: "Update failed", message: updateError.message },
        400,
        corsHeaders
      );
    }

    return jsonResponse(
      { success: true, message: "Senha alterada com sucesso" },
      200,
      corsHeaders
    );
  } catch (err) {
    console.error("[admin-reset-user-password]", err);
    return jsonResponse(
      { success: false, error: "Internal server error", message: String(err) },
      500,
      { ...CORS_PREFLIGHT_HEADERS, "Content-Type": "application/json" }
    );
  }
});
