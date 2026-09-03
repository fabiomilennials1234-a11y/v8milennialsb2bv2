/**
 * Ferramenta `perdas` — negócio perdido no período.
 *
 * ALCANCE DELIBERADAMENTE MENOR QUE O DO TICKET, decidido pelo CTO em
 * 01/09/2026. A issue pede "motivos reais de negócio perdido"; motivo não
 * existe em produção. Medido: 1.234 negócios com `outcome = 'lost'` e ZERO com
 * motivo — `deals.loss_reason_id` e `deals.loss_reason` vazios, o mesmo em
 * `pipe_propostas`, e as 209 chaves `loss_reason_id` em
 * `pipeline_entries.metadata` têm valor nulo. O catálogo `loss_reasons` é seed
 * de sistema: 108 organizações, zero customizações.
 *
 * Então esta ferramenta responde QUANTO e ONDE se perdeu — volume, valor e
 * recorte por etapa e por pessoa — e não POR QUÊ. Quando alguém passar a
 * registrar o motivo, a dimensão entra sem mudar a forma da ferramenta.
 *
 * O que ela NÃO faz é responder vazio fingindo analisar motivo: ferramenta que
 * devolve vazio é onde o modelo preenche o buraco sozinho.
 */

import type { OracleScope } from "../scope.ts";
import type { ToolDeps } from "./metricas.ts";

export const PERDAS_RPC = "oraculo_perdas";

export const perdasTool = {
  name: "perdas",

  async execute(
    args: Record<string, unknown>,
    scope: OracleScope,
    deps: ToolDeps,
  ): Promise<unknown> {
    const { data, error } = await deps.db.rpc(PERDAS_RPC, {
      p_organization_id: scope.organizationId,
      p_team_member_id: scope.kind === "assigned" ? scope.teamMemberId : null,
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
