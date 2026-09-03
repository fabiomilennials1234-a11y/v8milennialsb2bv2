/**
 * Identidade do chamador, com marca de tipo.
 *
 * `Caller` é opaco de propósito: o único jeito de obter um é `resolveCaller()`,
 * que valida o JWT e resolve a organização. Nenhuma função do plano de chamada
 * aceita `orgId` ou `userId` como parâmetro solto — se aceitasse, a fronteira de
 * tenant voltaria a ser "quem chamou lembrou de passar a org certa", que é
 * exatamente a classe de furo que o resto deste desenho existe para fechar.
 *
 * A cascata abaixo é a MESMA de `whatsapp-api-proxy/index.ts` (blocos 1–3),
 * extraída para ser reutilizada em vez de copiada: copiar autorização é o
 * mecanismo que fabrica divergência de `is_active` entre funções.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isActiveGestorForOrg } from "../gestor-auth.ts";
import { logRuntime } from "../logger.ts";

declare const callerBrand: unique symbol;

export interface Caller {
  readonly [callerBrand]: true;
  readonly orgId: string;
  readonly userId: string;
  /** team_members.id na org resolvida. NULL para master e gestor, que vivem fora do roster. */
  readonly teamMemberId: string | null;
  readonly role: string | null;
  readonly isMaster: boolean;
  readonly isGestor: boolean;
  /**
   * Cliente com o JWT do chamador — a RLS aplica.
   *
   * Existe para o plano de chamada perguntar ao banco "este usuário ENXERGA
   * este lead?" com a MESMA policy que decide se o lead aparece na tela
   * (`leads_select_by_responsibility_and_permissions`), em vez de reescrever
   * a regra em TypeScript. Vive dentro do `Caller` — e não como parâmetro
   * solto — pelo mesmo motivo de `orgId`: só `resolveCaller()` fabrica um, e
   * o JWT que ele carrega é o que foi validado aqui.
   */
  readonly asUser: SupabaseClient;
}

export type ResolveCallerResult =
  | { ok: true; caller: Caller }
  | { ok: false; status: number; error: string };

/** Admin operacional: admin da org, master, ou gestor de portfólio (ADR-0021 §6). */
export function isOrgAdmin(caller: Caller): boolean {
  return caller.isMaster || caller.isGestor || caller.role === "admin";
}

export function adminClient(): SupabaseClient {
  // `autoRefreshToken: false`: `persistSession` sozinho não impede o auth-js de
  // armar um `setInterval` de 30 s por cliente, que ninguém desarma. Ver
  // `_shared/supabase-admin.ts`.
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/**
 * Valida o Bearer, resolve a org e devolve um `Caller`.
 *
 * `targetOrgId` só é aceito de master e de gestor vinculado — para membro comum
 * ele é comparado com a org real e, se divergir, a tentativa é registrada como
 * `cross_tenant_attempt` antes do 403. Registrar importa: é assim que uma
 * tentativa de atravessar tenant vira evidência em vez de silêncio.
 */
export async function resolveCaller(
  req: Request,
  supabaseAdmin: SupabaseClient,
  targetOrgId?: string,
): Promise<ResolveCallerResult> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Missing auth" };
  }

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: authHeader } },
      // O JWT já vem pronto no cabeçalho: não há sessão a renovar, e o ticker
      // de 30 s do auth-js nunca é desarmado.
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  const { data: userData, error: userErr } = await supabaseUser.auth.getUser(
    authHeader.slice(7),
  );
  if (userErr || !userData?.user) {
    return { ok: false, status: 401, error: "Invalid token" };
  }
  const userId = userData.user.id;

  const { data: masterRow } = await supabaseAdmin
    .from("master_users")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (masterRow) {
    if (!targetOrgId) {
      return { ok: false, status: 400, error: "Master must provide organization_id" };
    }
    const { data: orgRow } = await supabaseAdmin
      .from("organizations")
      .select("id")
      .eq("id", targetOrgId)
      .maybeSingle();
    if (!orgRow) {
      return { ok: false, status: 404, error: "Organization not found" };
    }
    return {
      ok: true,
      caller: brand({
        orgId: targetOrgId,
        userId,
        teamMemberId: null,
        role: null,
        isMaster: true,
        isGestor: false,
        asUser: supabaseUser,
      }),
    };
  }

  // O cast é de TIPO, não de comportamento: `GestorAuthClient` é um contrato
  // estrutural mínimo e casar o SupabaseClient inteiro contra ele estoura o
  // limite de profundidade do TS (TS2589) — o mesmo erro que hoje impede
  // `deno check` em permission_engine.ts. Sem isto, a barreira de tipo do choke
  // não teria como rodar.
  type GestorClient = Parameters<typeof isActiveGestorForOrg>[0];
  if (
    targetOrgId &&
    await isActiveGestorForOrg(supabaseAdmin as unknown as GestorClient, userId, targetOrgId)
  ) {
    return {
      ok: true,
      caller: brand({
        orgId: targetOrgId,
        userId,
        teamMemberId: null,
        role: null,
        isMaster: false,
        isGestor: true,
        asUser: supabaseUser,
      }),
    };
  }

  const { data: member, error: memberErr } = await supabaseAdmin
    .from("team_members")
    .select("id, organization_id, role")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (memberErr || !member?.organization_id) {
    return { ok: false, status: 403, error: "No organization" };
  }

  if (targetOrgId && targetOrgId !== member.organization_id) {
    await logRuntime({
      organizationId: member.organization_id,
      module: "voip",
      action: "cross_tenant_attempt",
      status: "error",
      payloadSnapshot: {
        caller_org: member.organization_id,
        target_org: targetOrgId,
        user_id: userId,
      },
    });
    return { ok: false, status: 403, error: "Cannot target a different organization" };
  }

  return {
    ok: true,
    caller: brand({
      orgId: member.organization_id,
      userId,
      teamMemberId: member.id,
      role: member.role,
      isMaster: false,
      isGestor: false,
      asUser: supabaseUser,
    }),
  };
}

function brand(fields: Omit<Caller, typeof callerBrand>): Caller {
  return fields as Caller;
}
