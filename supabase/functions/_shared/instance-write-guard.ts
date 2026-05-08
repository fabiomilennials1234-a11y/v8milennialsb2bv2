// deno-lint-ignore-file no-explicit-any
/**
 * instance-write-guard — Etapa B do "vínculo user-instância de escrita".
 *
 * Responsabilidades:
 *   1. Resolver instância de escrita de um lead via RPC get_lead_write_instance
 *      (encapsula error_code estruturado + checagem de status open|connected).
 *   2. Verificar feature flag `user_write_instance_strict` por organização
 *      (organization_features override → feature_flags.default_enabled).
 *   3. Asseverar autorização de escrita de um usuário sobre uma instância via
 *      RPC can_user_write_instance (admin/master bypass + owner exato).
 *
 * Bifurcação por flag:
 *   - Flag OFF → callers ignoram este módulo OU recebem `FLAG_DISABLED`
 *     sentinela e seguem precedência legada (preferred_instance_id → primeira
 *     instância open|connected da org).
 *   - Flag ON → callers chamam resolveLeadWriteInstance + assertUserCanWriteInstance.
 *     Erros propagam como WriteAuthorizationError ou ResolveResult.errorCode.
 *
 * Logging: somente IDs e códigos. Nunca telefone, mensagem ou outros PII.
 *
 * Cache de flag: por orgId, vida = uma invocação Deno (memoizado em Map module-scope).
 *   - Edge functions são reciclados entre cold-starts; no warm-start o cache
 *     persiste por dezenas de segundos. Mudança de flag torna efeito após
 *     reciclagem (aceitável para flag de rollout cauteloso).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================================
// Tipos públicos
// ============================================================================

export type WriteInstanceErrorCode =
  | "LEAD_NOT_FOUND"
  | "NO_RESPONSIBLE"
  | "NO_INSTANCE"
  | "INSTANCE_INACTIVE"
  | "FLAG_DISABLED";

export interface ResolvedWriteInstance {
  instanceId: string;
  instanceName: string;
  ownerTeamMemberId: string | null;
  responsibleUserTeamMemberId: string;
}

export interface ResolveResult {
  ok: boolean;
  instance?: ResolvedWriteInstance;
  errorCode?: WriteInstanceErrorCode;
}

export class WriteAuthorizationError extends Error {
  override readonly name = "WriteAuthorizationError";
  constructor(
    message: string,
    public readonly userId: string,
    public readonly instanceId: string,
  ) {
    super(message);
  }
}

/**
 * Erro propagado por callers de envio quando a flag está ON e nenhuma
 * instância pôde ser resolvida pelo vínculo do responsável (sem fallback).
 */
export class StrictWriteResolutionError extends Error {
  override readonly name = "StrictWriteResolutionError";
  constructor(
    public readonly errorCode: WriteInstanceErrorCode,
    public readonly leadId: string,
  ) {
    super(`StrictWriteResolutionError: ${errorCode} (lead=${leadId})`);
  }
}

/**
 * Helper para callers que mantêm seu próprio `resolveInstance` local
 * (pipe-rule-dispatch, campaign-rule-dispatch, semi-automatic-dispatch,
 * workflow-action-handler, process-scheduled-user-messages).
 *
 * Quando a flag user_write_instance_strict está ON na org E `leadId` é
 * informado, tenta resolver pelo vínculo do responsável e devolve a row
 * canônica de whatsapp_instances (ou lança StrictWriteResolutionError).
 *
 * Quando flag OFF ou `leadId` ausente, devolve `null` e o caller segue com
 * sua precedência legada — ZERO mudança comportamental.
 */
export async function resolveStrictInstanceForCaller(
  client: SupabaseClient,
  organizationId: string,
  leadId: string | null | undefined,
): Promise<Record<string, unknown> | null> {
  if (!leadId) return null;
  const strict = await isStrictWriteEnabled(client, organizationId);
  if (!strict) return null;

  const result = await resolveLeadWriteInstance(client, leadId);
  if (!result.ok || !result.instance) {
    throw new StrictWriteResolutionError(
      result.errorCode ?? "NO_INSTANCE",
      leadId,
    );
  }

  const { data: full, error } = await client
    .from("whatsapp_instances")
    .select("*")
    .eq("id", result.instance.instanceId)
    .maybeSingle();

  if (error || !full) {
    throw new StrictWriteResolutionError("NO_INSTANCE", leadId);
  }

  return full as Record<string, unknown>;
}

// ============================================================================
// Flag cache (module-level, escopo por warm-start do edge runtime)
// ============================================================================

const flagCache = new Map<string, { enabled: boolean; expiresAt: number }>();
const FLAG_CACHE_TTL_MS = 30_000;

/**
 * Invalida o cache de flag (uso primário: testes).
 */
export function _resetFlagCacheForTesting(): void {
  flagCache.clear();
}

// ============================================================================
// API pública
// ============================================================================

/**
 * Resolve a instância de escrita do lead via RPC get_lead_write_instance.
 *
 * Este helper assume que a flag já foi checada pelo caller (caller decide
 * fallback). Verifica também status da instância (open|connected) — se a
 * instância foi resolvida mas está fora do ar, devolve INSTANCE_INACTIVE.
 *
 * Não checa autorização do usuário — para isso use assertUserCanWriteInstance.
 */
export async function resolveLeadWriteInstance(
  client: SupabaseClient,
  leadId: string,
): Promise<ResolveResult> {
  const { data, error } = await client.rpc("get_lead_write_instance", {
    p_lead_id: leadId,
  });

  if (error) {
    console.warn(
      "[InstanceWriteGuard] resolve_lead rpc_error leadId=%s code=%s",
      leadId,
      (error as { code?: string }).code ?? "unknown",
    );
    return { ok: false, errorCode: "LEAD_NOT_FOUND" };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    console.log(
      "[InstanceWriteGuard] resolve_lead leadId=%s outcome=miss error_code=LEAD_NOT_FOUND",
      leadId,
    );
    return { ok: false, errorCode: "LEAD_NOT_FOUND" };
  }

  const errorCode = (row.error_code ?? null) as WriteInstanceErrorCode | null;
  if (errorCode) {
    console.log(
      "[InstanceWriteGuard] resolve_lead leadId=%s outcome=fail error_code=%s",
      leadId,
      errorCode,
    );
    return { ok: false, errorCode };
  }

  // Sucesso pela RPC — verifica status da instância (open|connected).
  const instanceId = row.instance_id as string | null;
  if (!instanceId) {
    return { ok: false, errorCode: "NO_INSTANCE" };
  }

  const { data: inst, error: instErr } = await client
    .from("whatsapp_instances")
    .select("status")
    .eq("id", instanceId)
    .maybeSingle();

  if (instErr) {
    console.warn(
      "[InstanceWriteGuard] resolve_lead status_query_error leadId=%s instanceId=%s",
      leadId,
      instanceId,
    );
    return { ok: false, errorCode: "NO_INSTANCE" };
  }

  const status = (inst?.status ?? null) as string | null;
  if (status !== "open" && status !== "connected") {
    console.log(
      "[InstanceWriteGuard] resolve_lead leadId=%s outcome=fail error_code=INSTANCE_INACTIVE status=%s",
      leadId,
      status,
    );
    return { ok: false, errorCode: "INSTANCE_INACTIVE" };
  }

  console.log(
    "[InstanceWriteGuard] resolve_lead leadId=%s outcome=ok instanceId=%s",
    leadId,
    instanceId,
  );

  return {
    ok: true,
    instance: {
      instanceId,
      instanceName: (row.instance_name ?? "") as string,
      ownerTeamMemberId: (row.owner_team_member_id ?? null) as string | null,
      responsibleUserTeamMemberId: row.responsible_user_id as string,
    },
  };
}

/**
 * Verifica se a flag user_write_instance_strict está ATIVA na organização.
 *
 * Precedência:
 *   1. organization_features.is_enabled (override por org)
 *   2. feature_flags.default_enabled (default global)
 *
 * Resultado memoizado por orgId com TTL curto.
 */
export async function isStrictWriteEnabled(
  client: SupabaseClient,
  organizationId: string,
): Promise<boolean> {
  const now = Date.now();
  const cached = flagCache.get(organizationId);
  if (cached && cached.expiresAt > now) {
    return cached.enabled;
  }

  let enabled = false;

  try {
    // Override por organização (se existir e for true|false explícito)
    const { data: orgFeature } = await client
      .from("organization_features")
      .select("is_enabled")
      .eq("organization_id", organizationId)
      .eq("feature_key", "user_write_instance_strict")
      .maybeSingle();

    if (orgFeature && typeof orgFeature.is_enabled === "boolean") {
      enabled = orgFeature.is_enabled;
    } else {
      // Default global
      const { data: flag } = await client
        .from("feature_flags")
        .select("default_enabled")
        .eq("key", "user_write_instance_strict")
        .maybeSingle();
      enabled = flag?.default_enabled === true;
    }
  } catch (err) {
    console.warn(
      "[InstanceWriteGuard] flag_lookup_error orgId=%s — defaulting to false",
      organizationId,
      (err as Error)?.message ?? "unknown",
    );
    enabled = false;
  }

  flagCache.set(organizationId, { enabled, expiresAt: now + FLAG_CACHE_TTL_MS });
  return enabled;
}

/**
 * Asserta que `userId` pode escrever via `instanceId`. Lança
 * WriteAuthorizationError se não autorizado.
 *
 * Implementação: invoca RPC can_user_write_instance que faz:
 *   - master plataforma → permite
 *   - admin da org → permite
 *   - owner_team_member_id == team_member_id do user → permite
 *   - resto → nega
 */
export async function assertUserCanWriteInstance(
  client: SupabaseClient,
  userId: string,
  instanceId: string,
): Promise<void> {
  const { data, error } = await client.rpc("can_user_write_instance", {
    p_user_id: userId,
    p_instance_id: instanceId,
  });

  if (error) {
    console.warn(
      "[InstanceWriteGuard] can_user_write_instance rpc_error userId=%s instanceId=%s",
      userId,
      instanceId,
    );
    throw new WriteAuthorizationError(
      "authorization_check_failed",
      userId,
      instanceId,
    );
  }

  // RPC retorna boolean. data === true ⇒ autorizado.
  if (data !== true) {
    console.log(
      "[InstanceWriteGuard] can_user_write_instance userId=%s instanceId=%s outcome=denied",
      userId,
      instanceId,
    );
    throw new WriteAuthorizationError(
      "user_cannot_write_via_instance",
      userId,
      instanceId,
    );
  }

  console.log(
    "[InstanceWriteGuard] can_user_write_instance userId=%s instanceId=%s outcome=allowed",
    userId,
    instanceId,
  );
}
