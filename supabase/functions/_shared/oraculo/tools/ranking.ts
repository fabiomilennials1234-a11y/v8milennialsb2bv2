/**
 * Ferramenta `ranking` — desempenho por pessoa.
 *
 * A única do catálogo que não existe em Escopo `assigned`: comparar colegas é
 * exatamente o que esse recorte não alcança. A recusa acontece ANTES da
 * consulta, e não como filtro depois — se a consulta sair, o dado já saiu do
 * banco, e um filtro aplicado na volta não desfaz isso.
 *
 * Como sempre, a organização vem do Escopo e nunca do modelo.
 */

import type { OracleScope } from "../scope.ts";
import type { ToolDeps } from "./metricas.ts";

export const RANKING_RPC = "oraculo_ranking";

export const rankingTool = {
  name: "ranking",

  async execute(
    args: Record<string, unknown>,
    scope: OracleScope,
    deps: ToolDeps,
  ): Promise<unknown> {
    if (scope.kind !== "organization") return { error: "fora_do_escopo" };

    const { data, error } = await deps.db.rpc(RANKING_RPC, {
      p_organization_id: scope.organizationId,
      p_periodo_dias: lerPeriodo(args),
      p_limite: lerLimite(args),
    });

    if (error) return { error: "consulta_falhou" };
    return data;
  },
};

const PERIODO_MAX_DIAS = 365;
const PERIODO_PADRAO_DIAS = 30;
const LIMITE_MAX = 50;
const LIMITE_PADRAO = 20;

/** Pergunta ampla não puxa a base inteira. */
function lerPeriodo(args: Record<string, unknown>): number {
  const bruto = Number(args.periodo_dias);
  if (!Number.isFinite(bruto) || bruto <= 0) return PERIODO_PADRAO_DIAS;
  return Math.min(Math.floor(bruto), PERIODO_MAX_DIAS);
}

function lerLimite(args: Record<string, unknown>): number {
  const bruto = Number(args.limite);
  if (!Number.isFinite(bruto) || bruto <= 0) return LIMITE_PADRAO;
  return Math.min(Math.floor(bruto), LIMITE_MAX);
}
