/**
 * Remove Org Member - Edge Function (SaaS multi-tenant)
 *
 * Remove um membro da organização e apaga todos os dados de cadastro (team_members,
 * user_roles, profiles, auth.users) para que o email possa ser reutilizado — a pessoa
 * pode se cadastrar de novo ou o admin pode criar uma nova conta com aquele email.
 *
 * Autenticação: igual a create-org-user (JWT admin + user_creation_key ou X-Internal-Api-Key).
 */

import { withSentry } from '../_shared/sentry.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { requireAuth, AuthError, authErrorResponse } from "../_shared/user-auth.ts";
import { logRuntime } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY =
  Deno.env.get("ANON_KEY_2")?.trim() ||
  Deno.env.get("ANON_KEY")?.trim() ||
  Deno.env.get("SUPABASE_ANON_KEY")?.trim() ||
  "";
const INTERNAL_API_KEY = Deno.env.get("INTERNAL_API_KEY")?.trim() ?? "";

interface RemoveOrgMemberBody {
  team_member_id: string;
  organization_id: string;
  user_creation_key?: string;
  user_jwt?: string;
}

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

const handler = async (req: Request) => {
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

    let body: RemoveOrgMemberBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        { success: false, error: "Bad request", message: "Invalid JSON body" },
        400,
        corsHeaders
      );
    }

    const teamMemberId = typeof body.team_member_id === "string" ? body.team_member_id.trim() : "";
    const organizationId = typeof body.organization_id === "string" ? body.organization_id.trim() : "";
    const userCreationKey = typeof body.user_creation_key === "string" ? body.user_creation_key.trim() : "";
    const userJwtFromBody = typeof body.user_jwt === "string" ? body.user_jwt.trim() : "";

    if (!teamMemberId) {
      return jsonResponse(
        { success: false, error: "Bad request", message: "team_member_id é obrigatório" },
        400,
        corsHeaders
      );
    }
    if (!organizationId) {
      return jsonResponse(
        { success: false, error: "Bad request", message: "organization_id é obrigatório" },
        400,
        corsHeaders
      );
    }

    // ----- Autenticação via middleware compartilhado -----
    let authCtx;
    try {
      authCtx = await requireAuth(req, {
        organizationId,
        body: body as unknown as Record<string, unknown>,
        allowInternalKey: true,
      });
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e, corsHeaders);
      throw e;
    }

    const isInternalCall = authCtx.userId === "internal";

    // user_creation_key obrigatório para não-master e não-internal
    if (!authCtx.isMaster && !isInternalCall) {
      if (!userCreationKey) {
        return jsonResponse(
          { success: false, error: "Bad request", message: "user_creation_key é obrigatório quando usar JWT" },
          400,
          corsHeaders
        );
      }
      const { data: orgRow, error: orgError } = await supabase
        .from("organizations")
        .select("id, user_creation_key")
        .eq("id", organizationId)
        .single();
      if (orgError || !orgRow) {
        return jsonResponse(
          { success: false, error: "Forbidden", message: "Organização não encontrada" },
          403,
          corsHeaders
        );
      }
      const orgKey = orgRow.user_creation_key != null ? String(orgRow.user_creation_key) : "";
      if (orgKey !== userCreationKey) {
        return jsonResponse(
          { success: false, error: "Forbidden", message: "user_creation_key inválido para esta organização" },
          403,
          corsHeaders
        );
      }
    }

    // Admin check
    if (!authCtx.isAdmin) {
      return jsonResponse(
        { success: false, error: "Forbidden", message: "Apenas administradores podem remover membros" },
        403,
        corsHeaders
      );
    }

    // ----- Buscar o membro a remover -----
    const { data: member, error: memberError } = await supabase
      .from("team_members")
      .select("id, user_id, organization_id")
      .eq("id", teamMemberId)
      .eq("organization_id", organizationId)
      .single();

    if (memberError || !member) {
      return jsonResponse(
        { success: false, error: "Not found", message: "Membro não encontrado nesta organização" },
        404,
        corsHeaders
      );
    }

    const userIdToRemove = member.user_id as string | null;

    // 1) Remover da tabela team_members
    const { error: deleteTmErr } = await supabase
      .from("team_members")
      .delete()
      .eq("id", teamMemberId);

    if (deleteTmErr) {
      return jsonResponse(
        { success: false, error: "Delete failed", message: deleteTmErr.message },
        500,
        corsHeaders
      );
    }

    // Se não tinha user_id vinculado (apenas registro na equipe), já terminamos
    if (!userIdToRemove) {
      return jsonResponse(
        { success: true, message: "Membro removido da equipe. (Não havia conta de login vinculada.)" },
        200,
        corsHeaders
      );
    }

    // Remover quaisquer outras linhas de team_members para este user_id (outras orgs)
    await supabase.from("team_members").delete().eq("user_id", userIdToRemove);

    // 2) Remover de user_roles
    await supabase.from("user_roles").delete().eq("user_id", userIdToRemove);

    // 3) Remover de profiles
    await supabase.from("profiles").delete().eq("id", userIdToRemove);

    // 4) Apagar usuário no Auth para liberar o email
    const { error: deleteAuthErr } = await supabase.auth.admin.deleteUser(userIdToRemove);
    if (deleteAuthErr) {
      console.error("[remove-org-member] deleteUser error:", deleteAuthErr.message);
      return jsonResponse(
        {
          success: false,
          error: "Delete failed",
          message: "Membro removido da equipe, mas não foi possível apagar a conta de login. Tente novamente ou verifique no dashboard.",
          detail: deleteAuthErr.message,
        },
        500,
        corsHeaders
      );
    }

    await logRuntime({
      organizationId,
      module: "permission",
      action: "remove_member",
      status: "success",
      entityType: "user",
      entityId: userIdToRemove,
      triggeredBy: authCtx.userId,
    });

    return jsonResponse(
      {
        success: true,
        message: "Membro removido e dados de cadastro apagados. O email pode ser usado para novo cadastro ou criação de conta.",
      },
      200,
      corsHeaders
    );
  } catch (err) {
    console.error("[remove-org-member]", err);
    await logRuntime({
      organizationId,
      module: "permission",
      action: "remove_member",
      status: "error",
      errorMessage: String(err),
    });
    return jsonResponse(
      { success: false, error: "Internal server error", message: String(err) },
      500,
      corsHeaders
    );
  }
};

serve(withSentry('remove-org-member', handler));
