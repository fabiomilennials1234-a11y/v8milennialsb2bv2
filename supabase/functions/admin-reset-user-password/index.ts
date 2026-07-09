/**
 * Admin Reset User Password - Edge Function (Master only)
 *
 * Permite ao Master redefinir a senha de qualquer usuário (ex.: admin).
 * Usa Supabase Auth Admin API (service_role).
 */

import { withErrorBoundary } from '../_shared/error-boundary.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { requireAuth, AuthError, authErrorResponse } from "../_shared/user-auth.ts";
import { logRuntime } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

serve(withErrorBoundary('admin-reset-user-password', async (req) => {
  const origin = req.headers.get("Origin") ?? undefined;
  const corsHeaders = withSecurityHeaders(getCorsHeaders(origin));

  if (req.method === "OPTIONS") {
    return new Response("", { status: 200, headers: corsHeaders });
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

    // Auth via middleware compartilhado — apenas Master
    let authCtx;
    try {
      authCtx = await requireAuth(req);
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e, corsHeaders);
      throw e;
    }
    if (!authCtx.isMaster) {
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
    const PWD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{}|;:',.<>?]).{12,}$/;
    if (!newPassword || !PWD_RE.test(newPassword)) {
      return jsonResponse(
        { success: false, error: "Bad request", message: "new_password é obrigatório: mínimo 12 caracteres, incluindo maiúscula, minúscula, número e caractere especial" },
        400,
        corsHeaders
      );
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (updateError) {
      console.error("[admin-reset-user-password] updateUserById error:", updateError);
      await logRuntime({
        module: "auth",
        action: "reset_password",
        status: "error",
        entityType: "user",
        entityId: userId,
        errorMessage: updateError.message,
        triggeredBy: authCtx.userId,
      });
      return jsonResponse(
        { success: false, error: "Update failed", message: updateError.message },
        400,
        corsHeaders
      );
    }

    await logRuntime({
      module: "auth",
      action: "reset_password",
      status: "success",
      entityType: "user",
      entityId: userId,
      triggeredBy: authCtx.userId,
    });

    return jsonResponse(
      { success: true, message: "Senha alterada com sucesso" },
      200,
      corsHeaders
    );
  } catch (err) {
    console.error("[admin-reset-user-password]", err);
    await logRuntime({
      module: "auth",
      action: "reset_password",
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
