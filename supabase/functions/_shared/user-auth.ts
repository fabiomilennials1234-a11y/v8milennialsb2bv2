/**
 * Middleware de autenticação e autorização para Edge Functions
 *
 * Substitui os checks de admin/role duplicados em cada Edge Function.
 * Toda Edge Function que precisa de autenticação de usuário deve usar
 * requireAuth() e opcionalmente requireAdmin().
 *
 * Não confundir com auth.ts (validação de webhooks).
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logRuntime } from "./logger.ts";
import { timingSafeCompare } from "./auth.ts";
import { getActiveGestorForOrg, gestorRuntimeActor, isActiveGestorForOrg } from "./gestor-auth.ts";

// ─── Types ───────────────────────────────────────────────

export interface AuthContext {
  userId: string;
  teamMemberId: string;
  organizationId: string;
  role: string;
  isMaster: boolean;
  isAdmin: boolean;
  /**
   * True quando o ator é um Gestor de Portfólio (scoped master — ADR-0021)
   * atuando numa org vinculada, e NÃO um team_member real dela. isAdmin também
   * é true (escrita operacional full). Edge functions de roster/billing devem
   * negar o Gestor via requireAdmin({ denyGestor: true }) — carve-out §3.
   */
  isGestor: boolean;
  /**
   * ADR-0021 §7: `gestores.id` REAL do ator quando `isGestor`. Usado para
   * atribuir a escrita cross-org ao ator real na trilha forense (`runtime_logs`
   * via `gestorRuntimeActor`). `undefined` quando não é gestor. NUNCA é o
   * virtual member (`gestor-virtual-<userId>`) — esse é UI-only, não persistido.
   */
  gestorId?: string;
  jobTitle: string;
  metricType: "meetings" | "sales";
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

// ─── Supabase client helpers ─────────────────────────────

function getServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // `autoRefreshToken: false`: `persistSession` sozinho não impede o auth-js de
  // armar um `setInterval` de 30 s por cliente, que ninguém desarma. Ver
  // `_shared/supabase-admin.ts`.
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getAnonKey(): string {
  return (
    Deno.env.get("ANON_KEY_2")?.trim() ||
    Deno.env.get("ANON_KEY")?.trim() ||
    Deno.env.get("SUPABASE_ANON_KEY")?.trim() ||
    ""
  );
}

// ─── Token extraction ────────────────────────────────────

function extractToken(req: Request, body?: Record<string, unknown>): string | null {
  // 1. user_jwt no body (padrão usado pelas Edge Functions existentes)
  if (body?.user_jwt && typeof body.user_jwt === "string") {
    return body.user_jwt.trim() || null;
  }
  // 2. X-User-JWT header
  const userJwt = req.headers.get("X-User-JWT")?.trim();
  if (userJwt) return userJwt;
  // 3. Authorization Bearer
  const auth = req.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7).trim() || null;
  }
  return null;
}

// ─── requireAuth ─────────────────────────────────────────

/**
 * Autentica o usuário e retorna contexto completo.
 *
 * Fluxo:
 * 1. Extrai JWT do request
 * 2. Valida com Supabase Auth
 * 3. Busca team_member na organização (se organizationId fornecido)
 *    ou o primeiro team_member ativo do usuário
 * 4. Verifica se é master
 *
 * @throws AuthError se não autenticado
 */
export async function requireAuth(
  req: Request,
  options?: {
    organizationId?: string;
    body?: Record<string, unknown>;
    /** Se true, permite chamadas internas via X-Internal-Api-Key */
    allowInternalKey?: boolean;
    /**
     * Se true, exige organization_id (via option ou body). Falha com
     * AuthError 400 em vez de cair no fallback "primeiro team_member ativo".
     *
     * Use para edge functions org-scoped (ex.: get-member-permissions,
     * save-member-permissions). O fallback é inseguro para usuários
     * multi-org — avalia permissões/dados contra a org errada.
     */
    requireOrganization?: boolean;
  },
): Promise<AuthContext> {
  const supabase = getServiceClient();
  const body = options?.body;

  // Check internal API key first
  if (options?.allowInternalKey) {
    const internalKey = Deno.env.get("INTERNAL_API_KEY")?.trim();
    const providedKey = req.headers.get("X-Internal-Api-Key")?.trim();
    if (internalKey && providedKey && timingSafeCompare(providedKey, internalKey)) {
      // Chamada interna — precisa do organization_id e user_id no body
      const orgId = (body?.organization_id as string) || options?.organizationId || "";
      if (!orgId) {
        throw new AuthError("organization_id obrigatório para chamadas internas", 400);
      }
      return {
        userId: "internal",
        teamMemberId: "internal",
        organizationId: orgId,
        role: "admin",
        isMaster: false,
        isAdmin: true,
        isGestor: false,
        jobTitle: "Internal",
        metricType: "sales",
      };
    }
  }

  // Extract and validate JWT
  const token = extractToken(req, body);
  if (!token) {
    throw new AuthError("Token de autenticação não fornecido");
  }

  const anonKey = getAnonKey();
  if (!anonKey) {
    throw new AuthError("Servidor mal configurado: chave anon não encontrada", 500);
  }

  const anonClient = createClient(Deno.env.get("SUPABASE_URL")!, anonKey, {
    // `autoRefreshToken: false`: o token vem por parâmetro em `getUser(token)`,
    // não há sessão a renovar — e o ticker de 30 s do auth-js nunca é desarmado.
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user }, error: userError } = await anonClient.auth.getUser(token);
  if (userError || !user?.id) {
    throw new AuthError("JWT inválido ou expirado");
  }

  // Check master
  const { data: masterRow } = await supabase
    .from("master_users")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  const isMaster = Boolean(masterRow?.id);

  // Resolve organization + team member
  const orgId = (body?.organization_id as string) || options?.organizationId || "";
  let teamMember: { id: string; role: string; organization_id: string; job_title: string | null; metric_type: string | null } | null = null;

  if (orgId) {
    const { data } = await supabase
      .from("team_members")
      .select("id, role, organization_id, job_title, metric_type")
      .eq("user_id", user.id)
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .maybeSingle();
    teamMember = data;
  } else {
    // `requireOrganization` vale para TODO MUNDO, master inclusive. O
    // `&& !isMaster` que ficava aqui era um escape com nome enganoso: um master
    // sem organization_id no body pulava este throw, caía no fallback legado
    // (`order('created_at').limit(1)`) com um mero console.warn, atravessava as
    // duas redes de segurança abaixo — ambas condicionais em `!isMaster` — e saía
    // com a org MAIS ANTIGA em que ele tem team_member. E ele tem: o
    // `ensure_master_team_member` insere linhas reais toda vez que um master passa
    // por `assertPermission` em qualquer org. Resultado: escrita org-scoped na org
    // errada, em silêncio. Master é global em PERMISSÃO, nunca em ALVO.
    // Precedente do formato correto no repo: `_shared/voip/caller.ts` ("Master
    // must provide organization_id").
    if (options?.requireOrganization) {
      throw new AuthError(
        "organization_id obrigatório (edge function org-scoped; fallback por created_at é inseguro em multi-org). " +
          "Vale também para usuário master: ele é global em permissão, não em alvo — precisa dizer em QUAL org está agindo.",
        400,
      );
    }
    // Sem org específica — pega o primeiro team_member ativo (legado).
    // Telemetria: identifica callers que ainda dependem do fallback para
    // ser migrados para requireOrganization:true.
    console.warn(
      JSON.stringify({
        event: "requireAuth.org_fallback_used",
        user_id: user.id,
        is_master: isMaster,
        url: req.url,
      }),
    );
    const { data } = await supabase
      .from("team_members")
      .select("id, role, organization_id, job_title, metric_type")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    teamMember = data;
  }

  // Gestor de Portfólio (scoped master — ADR-0021 §6): ator FORA de
  // team_members com escrita full de admin operacional nas orgs vinculadas.
  // Só é reconhecido quando há um orgId concreto (o Gestor opera SEMPRE dentro
  // de uma org vinculada). Sem orgId não há alvo a checar → mantém o gate
  // original (fail-closed). Um team_member real tem precedência (já resolvido
  // acima); a checagem de Gestor só roda quando não há membro nem master.
  let isGestor = false;
  let gestorId: string | undefined;
  if (!teamMember && !isMaster && orgId) {
    // Resolve o gestor real (gestores.id) — não só um booleano — para que a
    // escrita cross-org seja atribuível ao ator real na trilha (ADR-0021 §7).
    const gestorCtx = await getActiveGestorForOrg(supabase, user.id, orgId);
    if (gestorCtx) {
      isGestor = true;
      gestorId = gestorCtx.gestorId;
    }
  }

  if (!teamMember && !isMaster && !isGestor) {
    throw new AuthError("Você não pertence a esta organização", 403);
  }

  // Safety net: se a org foi fornecida mas o user não é membro/master/gestor
  // dela, falha explicitamente (evita service-role bypass silencioso quando
  // body.organization_id é arbitrário).
  if (orgId && !teamMember && !isMaster && !isGestor) {
    throw new AuthError("Você não pertence a esta organização", 403);
  }

  const role = teamMember?.role || (isMaster || isGestor ? "admin" : "member");
  const isAdmin = isMaster || isGestor || role === "admin";

  return {
    userId: user.id,
    teamMemberId: teamMember?.id || "",
    organizationId: teamMember?.organization_id || orgId,
    role,
    isMaster,
    isAdmin,
    isGestor,
    gestorId,
    jobTitle: teamMember?.job_title || "",
    metricType: (teamMember?.metric_type as "meetings" | "sales") || "meetings",
  };
}

// ─── requireAdmin ────────────────────────────────────────

/**
 * Garante que o usuário é admin da organização.
 * Lança AuthError(403) se não for.
 */
export async function requireAdmin(
  req: Request,
  options?: {
    organizationId?: string;
    body?: Record<string, unknown>;
    allowInternalKey?: boolean;
    /**
     * Carve-out ADR-0021 §3: quando true, nega o Gestor de Portfólio mesmo
     * sendo isAdmin. Use em edge functions de roster do cliente (criar/remover
     * membro, permissões) e billing/plano — o Gestor NÃO gerencia a estrutura
     * da org do cliente. Default false (operação normal libera o Gestor).
     */
    denyGestor?: boolean;
  },
): Promise<AuthContext> {
  const ctx = await requireAuth(req, options);

  if (options?.denyGestor && ctx.isGestor) {
    await logRuntime({
      // ADR-0021 §7: tentativa negada também é ação do gestor — atribui ao ator
      // real (gestor_id + triggered_by), nunca anonimizada.
      ...(ctx.gestorId ? gestorRuntimeActor(ctx.userId, ctx.gestorId) : {}),
      organizationId: ctx.organizationId,
      module: "permission",
      action: "require_admin_gestor_carveout",
      status: "error",
      errorMessage: `Gestor ${ctx.userId} tentou ação de roster/billing restrita ao admin do cliente`,
      entityType: "user",
      entityId: ctx.userId,
    });
    throw new AuthError("Esta ação é restrita ao administrador da organização", 403);
  }

  if (!ctx.isAdmin) {
    await logRuntime({
      organizationId: ctx.organizationId,
      module: "permission",
      action: "require_admin_denied",
      status: "error",
      errorMessage: `User ${ctx.userId} (role: ${ctx.role}) tentou ação que requer admin`,
      entityType: "user",
      entityId: ctx.userId,
    });
    throw new AuthError("Apenas administradores podem realizar esta ação", 403);
  }

  return ctx;
}

// ─── resolvePermission ───────────────────────────────────

const ORG_KEY_TO_FEATURE: Record<string, string> = {
  see_unassigned_cards:   "leads.view_unassigned",
  see_subordinates_cards: "leads.view_subordinates",
  see_general_info:       "leads.view_general_info",
  see_all_leads:          "leads.view_all",
  can_delete_leads:       "leads.delete",
};

/**
 * Resolve uma permissão seguindo a cascata:
 * master → admin → feature_permissions → false
 *
 * Legacy org permission keys are mapped to feature keys internally.
 */
export async function resolvePermission(
  userId: string,
  organizationId: string,
  permissionKey: string,
): Promise<boolean> {
  const supabase = getServiceClient();

  // 1. Master sempre true
  const { data: masterRow } = await supabase
    .from("master_users")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (masterRow) return true;

  // 2. Admin sempre true
  const { data: tm } = await supabase
    .from("team_members")
    .select("id, role")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .maybeSingle();

  // 2b. Gestor de Portfólio: admin operacional na org vinculada. As keys
  // resolvidas aqui (ORG_KEY_TO_FEATURE — visão de leads) são operacionais,
  // fora dos carve-outs de roster/billing, então o Gestor herda como admin.
  if (!tm) {
    return isActiveGestorForOrg(supabase, userId, organizationId);
  }
  if (tm.role === "admin") return true;

  // 3. Map org key → feature key, check feature permission
  const featureKey = ORG_KEY_TO_FEATURE[permissionKey] ?? permissionKey;

  const { data: feature } = await supabase
    .from("feature_permissions")
    .select("is_admin_only, default_value")
    .eq("key", featureKey)
    .maybeSingle();

  if (!feature) return false;
  if (feature.is_admin_only) return false;

  const { data: override } = await supabase
    .from("member_feature_permissions")
    .select("enabled")
    .eq("team_member_id", tm.id)
    .eq("feature_key", featureKey)
    .maybeSingle();

  if (override) return override.enabled;

  return feature.default_value;
}

// ─── Helper: JSON error response ─────────────────────────

export function authErrorResponse(
  error: AuthError,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: error.status === 401 ? "Unauthorized" : "Forbidden",
      message: error.message,
    }),
    {
      status: error.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
