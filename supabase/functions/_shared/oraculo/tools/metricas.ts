/**
 * Ferramenta `metricas` — a única do catálogo na Onda 1.
 *
 * Consultada sob demanda pelo laço, em lugar do dump fixo de seis consultas
 * que o Oráculo antigo montava antes de saber a pergunta.
 *
 * O Escopo entra ANTES de tocar no banco, e a organização nunca vem por
 * parâmetro do modelo: é esse o padrão que já vazou nesta base antes.
 */

import type { OracleScope } from "../scope.ts";

export interface ToolDb {
  /**
   * `PromiseLike` e não `Promise`: o `rpc` do supabase-js devolve um
   * `PostgrestFilterBuilder`, que é thenable mas não é uma Promise. Declarar
   * `Promise` fazia o cliente real não caber no próprio tipo — o `await`
   * funcionava em runtime e só o `deno check` acusava.
   */
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface ToolDeps {
  db: ToolDb;
}

export const METRICAS_RPC = "oraculo_metricas";
export const MEETING_PROFILE_METRICS_RPC = "oraculo_meeting_profile_metrics";

export const metricasTool = {
  name: "metricas",

  async execute(
    args: Record<string, unknown>,
    scope: OracleScope,
    deps: ToolDeps,
  ): Promise<unknown> {
    const params = {
      p_organization_id: scope.organizationId,
      p_team_member_id: scope.kind === "assigned" ? scope.teamMemberId : null,
      p_periodo_dias: readPeriodo(args),
    };
    const { data, error } = await deps.db.rpc(METRICAS_RPC, params);

    if (error) return { error: "consulta_falhou" };
    // Reuniões enriquecem o perfil, mas não derrubam a métrica principal se a
    // fonte canônica estiver temporariamente indisponível.
    const meetings = await deps.db.rpc(MEETING_PROFILE_METRICS_RPC, params);
    return isObject(data) && !meetings.error && isObject(meetings.data)
      ? { ...data, ...meetings.data }
      : data;
  },
};

const PERIODO_MAX_DIAS = 365;
const PERIODO_PADRAO_DIAS = 30;

/** Pergunta ampla não puxa a base inteira. */
function readPeriodo(args: Record<string, unknown>): number {
  const raw = Number(args.periodo_dias);
  if (!Number.isFinite(raw) || raw <= 0) return PERIODO_PADRAO_DIAS;
  return Math.min(Math.floor(raw), PERIODO_MAX_DIAS);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
