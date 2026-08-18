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
 *
 * 🔴 O PRE-CHECK NÃO OLHA QUEM CHAMA — e não olhar é o conserto.
 *
 * Até 2026-08-18 este módulo abria com `if (isMaster) return { allowed: true }`,
 * onde `isMaster` é **quem CHAMA**, não quem está sendo criado. O trigger
 * `trg_enforce_seat_limit` no banco isenta outra coisa —
 * `is_master_user(NEW.user_id)`, o usuário que está NASCENDO. Master criando
 * pessoa comum em org no teto caía na assimetria: passava pelo 403 preventivo,
 * `auth.users` era criado, e o trigger derrubava o INSERT em `team_members`.
 * Resultado: usuário órfão (auth.users + profiles sem team_members), que some
 * de todos os seletores e recebe `organizationId=null` se logar. Aconteceu com
 * a Dafini na org Bolivar em 17/08/2026.
 *
 * Nenhuma capacidade se perde ao remover o bypass: com a org no teto o INSERT
 * era rejeitado pelo trigger de qualquer jeito. O que muda é a FORMA da falha —
 * 403 limpo antes de criar a conta, em vez de lixo silencioso depois. Para
 * realmente abrir vaga, mexa em `org_quotas` (`admin_adjustment`), que é a
 * fonte que o trigger lê.
 *
 * `isMaster` sobrevive só para escolher a mensagem: quem opera o painel de
 * master precisa saber que o caminho é ajustar a quota.
 */

export interface SeatQuotaDecision {
  allowed: boolean;
  status?: 403 | 500;
  message?: string;
}

export interface SeatQuotaInput {
  /** Quem CHAMA é master. Não isenta da quota — só troca a mensagem do 403. */
  isMaster: boolean;
  quota: Record<string, unknown> | null;
  quotaError: { message: string } | null;
}

export function evaluateSeatQuota({ isMaster, quota, quotaError }: SeatQuotaInput): SeatQuotaDecision {
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
      // ⚠️ Não cite `org_quotas.max_users` como se fosse coluna: `max_users` é
      // VALOR de `resource_key`, e `effective_limit` é GENERATED ALWAYS
      // (plan_base + purchased_addons + admin_adjustment). O único campo
      // escrevível é `admin_adjustment`, e ele tem painel — QuotaManagementPanel,
      // via RPC `admin_set_quota_adjustment`. Mandar o operador pro SQL errado
      // custa uma tentativa que o Postgres recusa.
      message: isMaster
        ? "Limite de usuários do plano atingido. Aumente os assentos no painel de quotas da organização (recurso “Usuários (Seats)”, ajuste manual) antes de criar — criar por cima deixaria o usuário sem vínculo com a org."
        : "Limite de usuários do plano atingido.",
    };
  }
  return { allowed: true };
}
