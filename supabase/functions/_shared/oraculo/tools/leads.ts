/**
 * Ferramenta `leads` — listas recortadas.
 *
 * Dois recortes, e não os três do ticket. "Sem próximo passo" sairia de
 * `follow_ups` sem conclusão, e em produção há 574 follow-ups abertos para
 * 57.834 leads: o recorte devolveria quase a base inteira, o que não é um
 * recorte. Fica de fora até existir sinal que o sustente.
 *
 * O recorte vem de uma lista fechada. Recorte desconhecido cai no padrão em
 * vez de virar consulta livre — o modelo não escolhe o que o banco filtra.
 */

import type { OracleScope } from "../scope.ts";
import type { ToolDeps } from "./metricas.ts";

export const LEADS_RPC = "oraculo_leads";

const RECORTES = ["parados", "sem_contato"] as const;
type Recorte = (typeof RECORTES)[number];
const RECORTE_PADRAO: Recorte = "parados";

export const leadsTool = {
  name: "leads",

  async execute(
    args: Record<string, unknown>,
    scope: OracleScope,
    deps: ToolDeps,
  ): Promise<unknown> {
    const { data, error } = await deps.db.rpc(LEADS_RPC, {
      p_organization_id: scope.organizationId,
      p_team_member_id: scope.kind === "assigned" ? scope.teamMemberId : null,
      p_recorte: lerRecorte(args),
      p_dias: lerDias(args),
      p_limite: lerLimite(args),
    });

    if (error) return { error: "consulta_falhou" };
    return data;
  },
};

const DIAS_MAX = 365;
const DIAS_PADRAO = 14;
const LIMITE_MAX = 50;
const LIMITE_PADRAO = 20;

function lerRecorte(args: Record<string, unknown>): Recorte {
  const bruto = String(args.recorte ?? "");
  return (RECORTES as readonly string[]).includes(bruto)
    ? (bruto as Recorte)
    : RECORTE_PADRAO;
}

function lerDias(args: Record<string, unknown>): number {
  const bruto = Number(args.dias);
  if (!Number.isFinite(bruto) || bruto <= 0) return DIAS_PADRAO;
  return Math.min(Math.floor(bruto), DIAS_MAX);
}

function lerLimite(args: Record<string, unknown>): number {
  const bruto = Number(args.limite);
  if (!Number.isFinite(bruto) || bruto <= 0) return LIMITE_PADRAO;
  return Math.min(Math.floor(bruto), LIMITE_MAX);
}
