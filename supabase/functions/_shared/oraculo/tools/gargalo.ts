/** Diagnóstico determinístico. O modelo recebe o cálculo; nunca o inventa. */

import type { OracleScope } from "../scope.ts";
import type { ToolDeps } from "./metricas.ts";

export const GARGALO_RPC = "oraculo_revenue_bottleneck";

export const gargaloTool = {
  name: "gargalo",

  async execute(
    _args: Record<string, unknown>,
    scope: OracleScope,
    deps: ToolDeps,
  ): Promise<unknown> {
    const { data, error } = await deps.db.rpc(GARGALO_RPC, {
      p_organization_id: scope.organizationId,
      p_team_member_id: scope.kind === "assigned" ? scope.teamMemberId : null,
    });

    if (error) return { error: "consulta_falhou" };
    return data;
  },
};
