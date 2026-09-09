import type { OracleScope } from "../scope.ts";
import type { ToolDeps } from "./metricas.ts";

export const CONVERSA_DETALHE_RPC = "oraculo_conversa_detalhe";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const conversaDetalheTool = {
  name: "conversa_detalhe",
  async execute(
    args: Record<string, unknown>,
    scope: OracleScope,
    deps: ToolDeps,
  ): Promise<unknown> {
    const leadId = typeof args.lead_id === "string" ? args.lead_id : "";
    const instanceId = typeof args.instance_id === "string" ? args.instance_id : "";
    if (!UUID.test(leadId) || !UUID.test(instanceId)) return { error: "identificador_invalido" };

    const rawLimit = Number(args.limite);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), 200)
      : 100;
    const { data, error } = await deps.db.rpc(CONVERSA_DETALHE_RPC, {
      p_organization_id: scope.organizationId,
      p_team_member_id: scope.kind === "assigned"
        ? scope.teamMemberId
        : scope.chatTeamMemberId ?? null,
      p_lead_id: leadId,
      p_instance_id: instanceId,
      p_limite: limit,
    });
    return error ? { error: "consulta_falhou" } : data;
  },
};
