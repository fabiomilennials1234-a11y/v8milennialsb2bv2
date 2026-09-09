/**
 * `propor_acao` prepara uma mudança; nunca a executa.
 *
 * O modelo escolhe um verbo de catálogo e um critério fechado. O servidor
 * resolve ids e conta os alvos por uma RPC somente-leitura. O id nasce aqui,
 * fora do modelo, para a proposta poder ser persistida junto do turno.
 */
import type { OracleScope } from "../scope.ts";
import type { ToolDb } from "./metricas.ts";

export const ACTION_TYPES = [
  "mover_etapa",
  "criar_follow_up",
  "atribuir_responsavel",
  "adicionar_tag",
] as const;
export type ActionType = typeof ACTION_TYPES[number];

export const CRITERION_TYPES = ["leads_parados", "leads_sem_contato"] as const;
export type CriterionType = typeof CRITERION_TYPES[number];

export interface ActionProposal {
  kind: "oraculo_action_proposal";
  id: string;
  acao: ActionType;
  criterio: { tipo: CriterionType; dias: number };
  parametros: Record<string, unknown>;
  previsao: number;
  status: "pendente";
}

interface ProposalDeps {
  db: ToolDb;
  randomUUID?: () => string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function texto(value: unknown, max = 160): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : null;
}

function dias(value: unknown, fallback: number, max = 365): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(Math.floor(parsed), max) : fallback;
}

function parametrosDaAcao(
  action: ActionType,
  args: Record<string, unknown>,
): Record<string, unknown> | null {
  if (action === "mover_etapa") {
    const pipeline = texto(args.pipeline, 80);
    const etapa = texto(args.etapa_destino, 80);
    return pipeline && etapa ? { pipeline, etapa_destino: etapa } : null;
  }
  if (action === "criar_follow_up") {
    const titulo = texto(args.titulo, 160);
    return titulo ? { titulo, prazo_dias: dias(args.prazo_dias, 1, 365) } : null;
  }
  if (action === "atribuir_responsavel") {
    const responsavel = texto(args.responsavel, 120);
    return responsavel ? { responsavel } : null;
  }
  const tag = texto(args.tag, 80);
  return tag ? { tag } : null;
}

export const proporAcaoTool = {
  name: "propor_acao",

  async execute(
    args: Record<string, unknown>,
    scope: OracleScope,
    deps: ProposalDeps,
  ): Promise<ActionProposal | { error: string }> {
    const action = texto(args.acao) as ActionType | null;
    if (!action || !ACTION_TYPES.includes(action)) return { error: "acao_invalida" };

    const criterionType = texto(args.criterio) as CriterionType | null;
    if (!criterionType || !CRITERION_TYPES.includes(criterionType)) {
      return { error: "criterio_invalido" };
    }

    const parameters = parametrosDaAcao(action, args);
    if (!parameters) return { error: "parametros_invalidos" };

    const criterion = {
      tipo: criterionType,
      dias: dias(args.dias, criterionType === "leads_parados" ? 14 : 0),
    };
    const { data, error } = await deps.db.rpc("oraculo_preview_action_proposal", {
      p_organization_id: scope.organizationId,
      p_team_member_id: scope.kind === "assigned" ? scope.teamMemberId : null,
      p_action_type: action,
      p_criterion: criterion,
      p_parameters: parameters,
    });
    if (error || !data || typeof data !== "object") return { error: "proposta_invalida" };

    const preview = data as { previsao?: unknown; parametros_resolvidos?: unknown };
    const resolved = preview.parametros_resolvidos;
    if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) {
      return { error: "proposta_invalida" };
    }

    return {
      kind: "oraculo_action_proposal",
      id: (deps.randomUUID ?? crypto.randomUUID)(),
      acao: action,
      criterio: criterion,
      parametros: resolved as Record<string, unknown>,
      previsao: Math.max(0, Number(preview.previsao) || 0),
      status: "pendente",
    };
  },
};

export function isActionProposal(value: unknown): value is ActionProposal {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ActionProposal>;
  return candidate.kind === "oraculo_action_proposal" &&
    typeof candidate.id === "string" &&
    UUID.test(candidate.id) &&
    ACTION_TYPES.includes(candidate.acao as ActionType) &&
    candidate.status === "pendente";
}
