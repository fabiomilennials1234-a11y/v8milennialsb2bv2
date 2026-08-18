/**
 * Seat check de create-org-user — decisão pura sobre o resultado da RPC
 * canônica org_resolve_quota (fonte única de quota).
 *
 * Contexto: o bloco antigo lia subscription_plans.limits.users — key que não
 * existe (a correta é max_users) → checagem era no-op silencioso. A decisão
 * agora vive em _shared/seat-quota.ts e é testável sem Deno.
 *
 * O trigger trg_enforce_seat_limit continua como backstop autoritativo no DB;
 * este pre-check só devolve erro claro (403) antes de criar o auth user.
 */
import { describe, it, expect } from "vitest";
import { evaluateSeatQuota } from "../../supabase/functions/_shared/seat-quota";

function quota(overrides: Record<string, unknown> = {}) {
  return {
    plan_base: 5,
    purchased_addons: 0,
    admin_adjustment: 0,
    effective_limit: 5,
    current_usage: 4,
    is_unlimited: false,
    can_add: true,
    remaining: 1,
    ...overrides,
  };
}

describe("evaluateSeatQuota", () => {
  it("recusa 403 quando limite 5 e 5 ativos (can_add=false)", () => {
    const d = evaluateSeatQuota({
      isMaster: false,
      quota: quota({ current_usage: 5, can_add: false, remaining: 0 }),
      quotaError: null,
    });
    expect(d.allowed).toBe(false);
    expect(d.status).toBe(403);
    expect(d.message).toMatch(/Limite de usuários/i);
  });

  it("permite quando limite 5 e 4 ativos (can_add=true)", () => {
    const d = evaluateSeatQuota({ isMaster: false, quota: quota(), quotaError: null });
    expect(d.allowed).toBe(true);
  });

  it("permite quando ilimitado (-1)", () => {
    const d = evaluateSeatQuota({
      isMaster: false,
      quota: quota({ plan_base: -1, effective_limit: -1, is_unlimited: true, can_add: true, remaining: -1 }),
      quotaError: null,
    });
    expect(d.allowed).toBe(true);
  });

  // 🔴 Regressão DAFINI-ORFA (Bolivar, 17/08/2026). Antes existia
  // `if (isMaster) return { allowed: true }` no topo, onde `isMaster` é quem
  // CHAMA. O trigger trg_enforce_seat_limit isenta outra coisa —
  // `is_master_user(NEW.user_id)`, quem NASCE. Master criando pessoa comum em
  // org no teto passava pelo pre-check, criava auth.users, e o trigger
  // derrubava o INSERT em team_members: usuário órfão.
  it("master NÃO bypassa a quota: org no teto devolve 403 igual a qualquer um", () => {
    const d = evaluateSeatQuota({
      isMaster: true,
      quota: quota({ current_usage: 5, can_add: false, remaining: 0 }),
      quotaError: null,
    });
    expect(d.allowed).toBe(false);
    expect(d.status).toBe(403);
  });

  it("403 para master aponta o painel de quotas, não uma coluna que não existe", () => {
    const d = evaluateSeatQuota({
      isMaster: true,
      quota: quota({ can_add: false }),
      quotaError: null,
    });
    expect(d.message).toMatch(/painel de quotas/i);
    // `max_users` é VALOR de resource_key e `effective_limit` é GENERATED
    // ALWAYS: citar "org_quotas.<x>" manda o operador escrever onde não dá.
    expect(d.message).not.toMatch(/org_quotas\./);
    // Não-master não recebe instrução de painel interno.
    const comum = evaluateSeatQuota({
      isMaster: false,
      quota: quota({ can_add: false }),
      quotaError: null,
    });
    expect(comum.message).not.toMatch(/painel de quotas/i);
  });

  it("master com vaga continua permitido", () => {
    const d = evaluateSeatQuota({ isMaster: true, quota: quota(), quotaError: null });
    expect(d.allowed).toBe(true);
  });

  it("master com quota ausente continua permitido (backstop no DB decide)", () => {
    const d = evaluateSeatQuota({ isMaster: true, quota: null, quotaError: null });
    expect(d.allowed).toBe(true);
  });

  it("erro na RPC nega até para master — não cria conta às cegas", () => {
    const d = evaluateSeatQuota({
      isMaster: true,
      quota: null,
      quotaError: { message: "connection refused" },
    });
    expect(d.allowed).toBe(false);
    expect(d.status).toBe(500);
  });

  it("erro na RPC → 500 explícito (não no-op)", () => {
    const d = evaluateSeatQuota({
      isMaster: false,
      quota: null,
      quotaError: { message: "connection refused" },
    });
    expect(d.allowed).toBe(false);
    expect(d.status).toBe(500);
    expect(d.message).toMatch(/Falha ao resolver limite/i);
  });

  it("quota null sem erro → permite (trigger no DB é o backstop)", () => {
    const d = evaluateSeatQuota({ isMaster: false, quota: null, quotaError: null });
    expect(d.allowed).toBe(true);
  });

  it("can_add ausente/shape inesperado → permite (backstop no DB)", () => {
    const d = evaluateSeatQuota({
      isMaster: false,
      quota: { unexpected: true },
      quotaError: null,
    });
    expect(d.allowed).toBe(true);
  });
});
