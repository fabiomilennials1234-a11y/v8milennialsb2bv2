import type { OracleScope } from "../scope.ts";
import type { ToolDeps } from "./metricas.ts";

export const CONVERSAS_RPC = "oraculo_conversas";

export const conversasTool = {
  name: "conversas",
  async execute(
    args: Record<string, unknown>,
    scope: OracleScope,
    deps: ToolDeps,
  ): Promise<unknown> {
    const { data, error } = await deps.db.rpc(CONVERSAS_RPC, {
      p_organization_id: scope.organizationId,
      p_team_member_id: scope.kind === "assigned"
        ? scope.teamMemberId
        : scope.chatTeamMemberId ?? null,
      p_periodo_dias: bounded(args.periodo_dias, 30, 365),
      p_limite: bounded(args.limite, 20, 50),
    });
    return error ? { error: "consulta_falhou" } : data;
  },
};

function bounded(value: unknown, fallback: number, max: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(Math.floor(number), max) : fallback;
}
