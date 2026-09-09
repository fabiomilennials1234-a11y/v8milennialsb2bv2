/**
 * Quota diária do Oráculo.
 *
 * O teto atual é de 3 perguntas por dia, gravado em `check_oraculo_limit`, e
 * impede o uso exploratório que o produto depende para existir. O novo teto
 * conta TURNOS DO USUÁRIO — não chamadas ao modelo: um turno que consultou seis
 * ferramentas continua sendo uma pergunta para quem perguntou.
 */

export const DEFAULT_DAILY_TURNS = 25;

export interface CheckQuotaArgs {
  /** Turnos do usuário já gastos hoje. */
  turnsToday: number;
  /** Teto da organização, quando ela ajusta o default. */
  orgLimit: number | null;
}

export interface QuotaVerdict {
  allowed: boolean;
  limit: number;
  remaining: number;
}

export function checkQuota(args: CheckQuotaArgs): QuotaVerdict {
  const limit = args.orgLimit && args.orgLimit > 0 ? args.orgLimit : DEFAULT_DAILY_TURNS;

  return {
    allowed: args.turnsToday < limit,
    limit,
    remaining: Math.max(0, limit - args.turnsToday),
  };
}
