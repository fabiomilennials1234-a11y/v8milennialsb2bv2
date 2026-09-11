/** Diagnóstico determinístico. O modelo recebe o cálculo; nunca o inventa. */

import type { OracleScope } from "../scope.ts";
import type { ToolDeps } from "./metricas.ts";

export const GARGALO_RPC = "oraculo_revenue_bottleneck";

function memberSafeResult(data: unknown): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const source = data as Record<string, unknown>;
  const { people: _people, profiles: _profiles, ...safe } = source;
  const bottleneck = safe.bottleneck;
  if (!bottleneck || typeof bottleneck !== "object" || Array.isArray(bottleneck)) return safe;
  const value = bottleneck as Record<string, unknown>;
  if (value.dimension !== "person") return safe;
  const {
    team_member_id: _teamMemberId,
    team_member_name: _teamMemberName,
    ...anonymous
  } = value;
  return {
    ...safe,
    bottleneck: {
      ...anonymous,
      dimension: "self",
      key: "self",
      label: "Seu desempenho",
    },
  };
}

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
    return scope.kind === "assigned" ? memberSafeResult(data) : data;
  },
};
