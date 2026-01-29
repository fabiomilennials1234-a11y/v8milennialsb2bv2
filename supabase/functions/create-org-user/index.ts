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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Chave anon para validar JWT: ANON_KEY_2 (teste), ANON_KEY ou SUPABASE_ANON_KEY injetada
const SUPABASE_ANON_KEY =
  Deno.env.get("ANON_KEY_2")?.trim() ||
  Deno.env.get("ANON_KEY")?.trim() ||
  Deno.env.get("SUPABASE_ANON_KEY")?.trim() ||
  "";
const INTERNAL_API_KEY = Deno.env.get("INTERNAL_API_KEY")?.trim() ?? "";

const CORS_PREFLIGHT_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, x-internal-api-key, x-user-jwt",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

interface CreateOrgUserBody {
  email: string;
  name?: string;
  role: string;
  organization_id: string;
  /** Senha que o admin define para o novo usuário (login com email + esta senha) */
  password?: string;
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

    // ----- Autenticação: X-Internal-Api-Key (backend) OU JWT + user_creation_key (frontend) -----
    // Frontend: Authorization Bearer <anon_key> (gateway exige) + body.user_jwt (JWT do usuário; body sempre chega).
    const apiKey = req.headers.get("X-Internal-Api-Key")?.trim();
    const userJwt =
      userJwtFromBody ||
      req.headers.get("X-User-JWT")?.trim() ||
      req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "")?.trim() ||
      "";
    const isBackendCall = Boolean(INTERNAL_API_KEY && apiKey === INTERNAL_API_KEY);
    let userIdFromAuth: string | null = null;

    if (!isBackendCall) {
      if (!userJwt) {
        const hasUserJwtInBody = !!userJwtFromBody;
        return jsonResponse(
          {
            success: false,
            error: "Unauthorized",
            message: "Body user_jwt (JWT do usuário) é obrigatório quando não usar X-Internal-Api-Key",
            detail: hasUserJwtInBody ? "user_jwt veio vazio no body" : "user_jwt não enviado no body",
          },
          401,
          corsHeaders
        );
      }
      if (!SUPABASE_ANON_KEY) {
        console.error("[create-org-user] Chave anon não encontrada. Use secret SUPABASE_ANON_KEY (injetada) ou ANON_KEY.");
        return jsonResponse(
          { success: false, error: "Server misconfiguration", message: "Configure a secret ANON_KEY com a chave anon do projeto (Project Settings → API)." },
          500,
          corsHeaders
        );
      }
      const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false },
      });
      // Validar JWT: getUser(jwt) retorna o usuário associado ao token
      const { data: { user }, error: userError } = await anonClient.auth.getUser(userJwt);
      if (userError) {
        console.error("[create-org-user] getUser error:", userError.message);
        return jsonResponse(
          {
            success: false,
            error: "Unauthorized",
            message: "JWT inválido ou expirado",
            detail: userError.message,
          },
          401,
          corsHeaders
        );
      }
      if (!user?.id) {
        return jsonResponse(
          {
            success: false,
            error: "Unauthorized",
            message: "JWT inválido ou expirado",
            detail: "getUser retornou sem user.id",
          },
          401,
          corsHeaders
        );
      }
      userIdFromAuth = user.id;
    }

    if (!isBackendCall) {
      if (!userCreationKey) {
        return jsonResponse(
          { success: false, error: "Bad request", message: "user_creation_key é obrigatório quando usar JWT" },
          400,
          corsHeaders
        );
      }
      // Validar user_creation_key contra a organização no Supabase
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
      // Verificar se o usuário é admin da organização
      const { data: adminCheck } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userIdFromAuth!)
        .maybeSingle();
      const isAdmin = adminCheck?.role === "admin";
      if (!isAdmin) {
        return jsonResponse(
          { success: false, error: "Forbidden", message: "Apenas administradores podem criar usuários" },
          403,
          corsHeaders
        );
      }
      const { data: tm } = await supabase
        .from("team_members")
        .select("id")
        .eq("user_id", userIdFromAuth!)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (!tm) {
        return jsonResponse(
          { success: false, error: "Forbidden", message: "Você não pertence a esta organização" },
          403,
          corsHeaders
        );
      }
    }

    // ----- Criar usuário com senha (email + senha para login) -----
    const { data: orgCreate } = await supabase
      .from("organizations")
      .select("subscription_plan")
      .eq("id", organizationId)
      .single();
    const planNameCreate = orgCreate?.subscription_plan ?? "free";
    const { data: planCreate } = await supabase
      .from("subscription_plans")
      .select("limits")
      .eq("name", planNameCreate)
      .maybeSingle();
    const limitsCreate = (planCreate?.limits as Record<string, number>) ?? {};
    const userLimitCreate = limitsCreate.users;
    if (typeof userLimitCreate === "number" && userLimitCreate !== -1) {
      const { count, error: countErr } = await supabase
        .from("team_members")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("is_active", true);
      if (!countErr && count !== null && count >= userLimitCreate) {
        return jsonResponse(
          { success: false, error: "Limit exceeded", message: "Limite de usuários do plano atingido." },
          403,
          corsHeaders
        );
      }
    }
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
    await supabase.from("profiles").upsert(
      { id: newUserId, full_name: name || email.split("@")[0] },
      { onConflict: "id" }
    );
    const roleForInsert = role === "member" ? "sdr" : role;
    const { error: tmErr } = await supabase.from("team_members").insert({
      user_id: newUserId,
      organization_id: organizationId,
      name: name || email.split("@")[0],
      role: roleForInsert,
      email: email.toLowerCase(),
      is_active: true,
    });
    if (tmErr) {
      await supabase.auth.admin.deleteUser(newUserId);
      return jsonResponse(
        { success: false, error: "Insert failed", message: tmErr.message },
        500,
        corsHeaders
      );
    }
    const { error: urErr } = await supabase.from("user_roles").insert({
      user_id: newUserId,
      role: roleForInsert,
    });
    if (urErr) {
      await supabase.auth.admin.deleteUser(newUserId);
      return jsonResponse(
        { success: false, error: "Insert user_role failed", message: urErr.message },
        500,
        corsHeaders
      );
    }
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
    return jsonResponse(
      { success: false, error: "Internal server error", message: String(err) },
      500,
      { ...CORS_PREFLIGHT_HEADERS, "Content-Type": "application/json" }
    );
  }
});
