/**
 * Create Org User - Edge Function (SaaS multi-tenant)
 *
 * Cria usuário diretamente na organização (sem envio de email ou pré-cadastro).
 * O admin informa: email, nome, função e senha; a pessoa entra no sistema com esse email e senha.
 *
 * Autenticação:
 * 1) JWT (usuário admin) + user_creation_key no body: validação via chave da org no Supabase.
 * 2) X-Internal-Api-Key: uso por backend que já validou o admin.
 */

import { withErrorBoundary } from '../_shared/error-boundary.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { requireAuth, AuthError, authErrorResponse } from "../_shared/user-auth.ts";
import { logRuntime } from "../_shared/logger.ts";
import { evaluateSeatQuota } from "../_shared/seat-quota.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Chave anon para validar JWT: ANON_KEY_2 (teste), ANON_KEY ou SUPABASE_ANON_KEY injetada
const SUPABASE_ANON_KEY =
  Deno.env.get("ANON_KEY_2")?.trim() ||
  Deno.env.get("ANON_KEY")?.trim() ||
  Deno.env.get("SUPABASE_ANON_KEY")?.trim() ||
  "";
const INTERNAL_API_KEY = Deno.env.get("INTERNAL_API_KEY")?.trim() ?? "";

interface CreateOrgUserBody {
  email: string;
  name?: string;
  role: string;
  organization_id: string;
  /** Senha que o admin define para o novo usuário (login com email + esta senha) */
  password?: string;
  user_creation_key?: string;
  user_jwt?: string;
  job_title?: string;
  metric_type?: string;
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

serve(withErrorBoundary('create-org-user', async (req) => {
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

    // ----- Body (precisamos do body para validar user_creation_key no fluxo JWT) -----
    let body: CreateOrgUserBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        { success: false, error: "Bad request", message: "Invalid JSON body" },
        400,
        corsHeaders
      );
    }

    const email = typeof body.email === "string" ? body.email.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const role = typeof body.role === "string" ? body.role.trim() : "member";
    const organizationId = typeof body.organization_id === "string" ? body.organization_id.trim() : "";
    const password = typeof body.password === "string" ? body.password.trim() : "";
    const userCreationKey = typeof body.user_creation_key === "string" ? body.user_creation_key.trim() : "";
    const userJwtFromBody = typeof body.user_jwt === "string" ? body.user_jwt.trim() : "";
    const jobTitle = typeof body.job_title === "string" ? body.job_title.trim() : "";
    const rawMetricType = typeof body.metric_type === "string" ? body.metric_type.trim() : "";
    const metricType = rawMetricType === "sales" ? "sales" : "meetings"; // validated: only 'meetings' | 'sales'

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse(
        { success: false, error: "Bad request", message: "Email inválido" },
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
    if (!password || password.length < 6) {
      return jsonResponse(
        { success: false, error: "Bad request", message: "Senha é obrigatória e deve ter no mínimo 6 caracteres" },
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

    const isMaster = authCtx.isMaster;
    const isInternalCall = authCtx.userId === "internal";

    // user_creation_key obrigatório para não-master e não-internal
    if (!isMaster && !isInternalCall) {
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

    // Carve-out ADR-0021 §3: o Gestor de Portfólio (isAdmin=true operacional)
    // NÃO gerencia o roster do cliente. Criar usuário = roster → negado.
    if (authCtx.isGestor) {
      return jsonResponse(
        { success: false, error: "Forbidden", message: "Gestor de Portfólio não gerencia usuários da organização" },
        403,
        corsHeaders
      );
    }

    // Admin check: requireAuth já resolveu isAdmin
    if (!authCtx.isAdmin) {
      return jsonResponse(
        { success: false, error: "Forbidden", message: "Apenas administradores podem criar usuários" },
        403,
        corsHeaders
      );
    }

    // ----- Seat check via RPC canônica (org_resolve_quota) -----
    // O bloco antigo lia subscription_plans.limits.users — key inexistente
    // (correta: max_users) → no-op silencioso.
    // ⚠️ O pre-check vale PARA TODOS, master inclusive: o trigger
    // trg_enforce_seat_limit isenta `is_master_user(NEW.user_id)` (quem nasce),
    // não quem chama. Isentar o chamador aqui criava usuário órfão — ver o
    // cabeçalho de _shared/seat-quota.ts.
    const { data: seatQuota, error: seatQuotaErr } = await supabase.rpc("org_resolve_quota", {
      p_org_id: organizationId,
      p_resource_key: "max_users",
    });
    const seatDecision = evaluateSeatQuota({
      isMaster,
      quota: (seatQuota as Record<string, unknown> | null) ?? null,
      quotaError: seatQuotaErr ? { message: seatQuotaErr.message } : null,
    });
    if (!seatDecision.allowed) {
      return jsonResponse(
        {
          success: false,
          error: seatDecision.status === 403 ? "Limit exceeded" : "Quota resolution failed",
          message: seatDecision.message,
        },
        seatDecision.status ?? 500,
        corsHeaders
      );
    }
    // ----- Criar usuário com senha (email + senha para login) -----
    const { data: createData, error: createError } = await supabase.auth.admin.createUser({
      email: email.toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { full_name: name || email.split("@")[0] },
    });
    if (createError) {
      const msg = createError.message?.toLowerCase() ?? "";
      if (msg.includes("already") || msg.includes("already been") || msg.includes("already registered")) {
        return jsonResponse(
          { success: false, error: "Conflict", message: "Este email já está cadastrado." },
          409,
          corsHeaders
        );
      }
      return jsonResponse(
        { success: false, error: "Create failed", message: createError.message },
        400,
        corsHeaders
      );
    }
    const newUserId = createData?.user?.id;
    if (!newUserId) {
      return jsonResponse(
        { success: false, error: "Create failed", message: "User not returned" },
        500,
        corsHeaders
      );
    }
    // `upsert` RESOLVE com { error } em vez de lançar. Não muda o fluxo (o
    // INSERT em team_members abaixo é o que define sucesso), mas o erro entra
    // na telemetria: sem isso, um profile ausente vira mistério em produção.
    const { error: profileErr } = await supabase.from("profiles").upsert(
      { id: newUserId, full_name: name || email.split("@")[0] },
      { onConflict: "id" }
    );
    // Normalizar roles legados para o novo sistema: admin ou member
    const validRoles = ["admin", "member"];
    const adminRoles = ["admin", "agency"];
    const roleForInsert = adminRoles.includes(role) ? "admin" : validRoles.includes(role) ? role : "member";
    const { error: tmErr } = await supabase.from("team_members").insert({
      user_id: newUserId,
      organization_id: organizationId,
      name: name || email.split("@")[0],
      role: roleForInsert,
      email: email.toLowerCase(),
      is_active: true,
      metric_type: metricType,
      ...(jobTitle ? { job_title: jobTitle } : {}),
    });
    if (tmErr) {
      // ROLLBACK — `deleteUser` NÃO lança: resolve com { data, error }, igual ao
      // resto do supabase-js. Descartar esse retorno era o que transformava uma
      // falha de vínculo em usuário ÓRFÃO invisível (auth.users + profiles sem
      // team_members). `profiles` cai junto: profiles_id_fkey é ON DELETE CASCADE.
      // O jeito certo já existia no repo — remove-org-member/index.ts.
      const { error: rollbackErr } = await supabase.auth.admin.deleteUser(newUserId);
      const orphaned = !!rollbackErr;

      // Este ramo não chamava logRuntime — nem success, nem error. A falha ficava
      // sem NENHUM rastro e só aparecia varrendo auth.users sem team_members
      // (foi assim que a Dafini/Bolivar apareceu, um dia depois).
      await logRuntime({
        organizationId,
        module: "auth",
        action: "create_user",
        status: "error",
        entityType: "user",
        entityId: newUserId,
        triggeredBy: authCtx.userId,
        errorMessage: `team_members insert falhou: ${tmErr.message}`,
        payloadSnapshot: {
          stage: "team_members_insert",
          role: roleForInsert,
          rollback: orphaned ? "failed" : "ok",
          rollback_error: rollbackErr?.message ?? null,
          orphaned_user_id: orphaned ? newUserId : null,
          profile_upsert_error: profileErr?.message ?? null,
        },
      });

      return jsonResponse(
        {
          success: false,
          error: "Insert failed",
          message: orphaned
            ? "Não foi possível vincular o usuário à organização e a conta de login criada não pôde ser desfeita. A conta ficou sem vínculo — remova-a manualmente antes de tentar de novo."
            : tmErr.message,
          detail: tmErr.message,
          ...(orphaned ? { orphaned_user_id: newUserId } : {}),
        },
        500,
        corsHeaders
      );
    }
    // user_roles é populado automaticamente pelo trigger trg_sync_user_roles
    // que dispara no INSERT em team_members acima. Não é necessário inserir manualmente.
    await logRuntime({
      organizationId,
      module: "auth",
      action: "create_user",
      status: "success",
      entityType: "user",
      entityId: newUserId,
      triggeredBy: authCtx.userId,
      // Vínculo criado, mas o profile pode ter falhado antes: o usuário entra
      // sem nome. Sucesso com ressalva registrada é melhor que sucesso mudo.
      ...(profileErr
        ? { payloadSnapshot: { profile_upsert_error: profileErr.message } }
        : {}),
    });

    return jsonResponse(
      {
        success: true,
        message: "Usuário criado. A pessoa pode entrar com este email e a senha que você definiu.",
        user_id: newUserId,
      },
      200,
      corsHeaders
    );
  } catch (err) {
    console.error("[create-org-user]", err);
    await logRuntime({
      module: "auth",
      action: "create_user",
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
