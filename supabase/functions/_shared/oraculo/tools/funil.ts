/**
 * Ferramenta `funil` — conversão etapa a etapa, para localizar onde trava.
 *
 * A posição no funil vive em `pipeline_entries` (`pipeline_id`, `stage_key`),
 * e NÃO em `deals`: medido em produção, `deals` tem 35.230 linhas e não tem
 * `pipeline_id` nem `stage_id`, embora `types.ts` sugira o contrário. Quem
 * consultar `deals` atrás de etapa não acha nenhuma.
 */

import type { OracleScope } from "../scope.ts";
import type { ToolDeps } from "./metricas.ts";

export const FUNIL_RPC = "oraculo_funil";

export const funilTool = {
  name: "funil",

  async execute(
    args: Record<string, unknown>,
    scope: OracleScope,
    deps: ToolDeps,
  ): Promise<unknown> {
    const { data, error } = await deps.db.rpc(FUNIL_RPC, {
      p_organization_id: scope.organizationId,
      p_team_member_id: scope.kind === "assigned" ? scope.teamMemberId : null,
      p_periodo_dias: lerPeriodo(args),
    });

    if (error) return { error: "consulta_falhou" };
    return data;
  },
};

const PERIODO_MAX_DIAS = 365;
const PERIODO_PADRAO_DIAS = 30;

function lerPeriodo(args: Record<string, unknown>): number {
  const bruto = Number(args.periodo_dias);
  if (!Number.isFinite(bruto) || bruto <= 0) return PERIODO_PADRAO_DIAS;
  return Math.min(Math.floor(bruto), PERIODO_MAX_DIAS);
}
