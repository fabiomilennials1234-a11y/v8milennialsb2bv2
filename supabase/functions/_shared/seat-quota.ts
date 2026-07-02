/**
 * seat-quota — decisão pura do pre-check de assentos (create-org-user).
 *
 * Fonte única de quota: RPC org_resolve_quota(p_org_id, 'max_users')
 * (mesma resolução usada pelo trigger trg_enforce_seat_limit, que continua
 * como backstop autoritativo no DB). Este pre-check existe pra devolver um
 * 403 claro ANTES de criar o auth user — não pra substituir o trigger.
 *
 * Política de falha:
 * - Erro na RPC → 500 explícito (o bloco antigo falhava silencioso lendo
 *   limits.users, key inexistente).
 * - Shape inesperado/quota ausente sem erro → permite (o trigger no DB nega
 *   de verdade se o limite estiver estourado).
 */

export interface SeatQuotaDecision {
  allowed: boolean;
  status?: 403 | 500;
  message?: string;
}

export interface SeatQuotaInput {
  isMaster: boolean;
  quota: Record<string, unknown> | null;
  quotaError: { message: string } | null;
}

export function evaluateSeatQuota({ isMaster, quota, quotaError }: SeatQuotaInput): SeatQuotaDecision {
  if (isMaster) {
    return { allowed: true };
  }
  if (quotaError) {
    return {
      allowed: false,
      status: 500,
      message: "Falha ao resolver limite de usuários do plano",
    };
  }
  if (quota && quota["can_add"] === false) {
    return {
      allowed: false,
      status: 403,
      message: "Limite de usuários do plano atingido.",
    };
  }
  return { allowed: true };
}
