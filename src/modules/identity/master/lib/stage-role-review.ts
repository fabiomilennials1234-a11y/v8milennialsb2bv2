/**
 * stage-role-review — lógica pura da revisão master de won/lost (#991).
 *
 * ADR-0017 §1: won/lost = dinheiro = confirmação humana obrigatória. O
 * classifier grava a sugestão em `pipeline_stages.suggested_stage_role`; esta
 * camada transforma a fila em grupos por org e traduz a decisão do master em
 * payload de update — o ÚNICO caminho de código que aplica um won/lost
 * sugerido. Pura (sem IO) para os invariantes serem testáveis em unit.
 */

import type { StageRole, SuggestableStageRole, StageRoleSuggestionSource } from "@/contracts/pipe";

/** Linha da fila de revisão (query do hook, com org embedada). */
export interface StageRoleSuggestionRow {
  id: string;
  organization_id: string;
  /** NULL nas etapas de funil custom (pós-SCRUM-616 todas vivem em pipeline_stages). */
  pipeline_type: string | null;
  stage_key: string;
  name: string;
  color: string | null;
  stage_role: StageRole;
  suggested_stage_role: SuggestableStageRole;
  stage_role_suggested_at: string | null;
  stage_role_suggestion_source: StageRoleSuggestionSource | null;
  organization: { name: string } | null;
  /** Funil dono da etapa — é o rótulo quando pipeline_type é NULL (custom). */
  pipeline: { name: string; slug: string | null; type: string | null } | null;
  /**
   * O nome do funil como a ORG o vê (display_config → nome de fábrica →
   * pipelines.name), resolvido no hook. NULL quando a etapa está órfã
   * (pipeline_id nulo — funil excluído/legacy): a tela mostra o fallback
   * honesto em vez de inventar um nome de catálogo (SCRUM-641).
   */
  funil_label: string | null;
}

export interface OrgSuggestionGroup {
  orgId: string;
  orgName: string;
  suggestions: StageRoleSuggestionRow[];
}

/**
 * Agrupa a fila por organização (ordem alfabética de org; dentro da org,
 * pipe + nome) — a tela master varre as ~30 orgs numa passada só.
 */
export function groupSuggestionsByOrg(
  rows: readonly StageRoleSuggestionRow[],
): OrgSuggestionGroup[] {
  const byOrg = new Map<string, OrgSuggestionGroup>();
  for (const row of rows) {
    const group = byOrg.get(row.organization_id);
    if (group) group.suggestions.push(row);
    else {
      byOrg.set(row.organization_id, {
        orgId: row.organization_id,
        orgName: row.organization?.name ?? "Organização sem nome",
        suggestions: [row],
      });
    }
  }
  const groups = [...byOrg.values()];
  for (const group of groups) {
    group.suggestions.sort(
      (a, b) =>
        (a.pipeline_type ?? a.pipeline?.name ?? "").localeCompare(
          b.pipeline_type ?? b.pipeline?.name ?? "",
        ) || a.name.localeCompare(b.name),
    );
  }
  return groups.sort((a, b) => a.orgName.localeCompare(b.orgName));
}

export type ReviewAction = "approve" | "correct" | "dismiss";

export interface ReviewUpdatePayload {
  stage_role?: StageRole;
  suggested_stage_role: null;
  stage_role_reviewed_at: string;
  stage_role_reviewed_by: string;
}

/**
 * Traduz a decisão humana em payload de update de `pipeline_stages`.
 *
 * - approve → aplica exatamente o role sugerido
 * - correct → aplica o role escolhido pelo master (qualquer um dos 5)
 * - dismiss → NÃO toca em stage_role (fica 'open'); só limpa a pendência
 *
 * Em todos os casos a sugestão é limpa e a revisão é carimbada
 * (reviewed_at/by = trilha de auditoria + marcador anti-re-sugestão).
 */
export function buildReviewUpdate(params: {
  action: ReviewAction;
  suggestedRole: SuggestableStageRole;
  correctedRole?: StageRole;
  reviewerId: string;
  nowIso?: string;
}): ReviewUpdatePayload {
  const { action, suggestedRole, correctedRole, reviewerId } = params;
  const nowIso = params.nowIso ?? new Date().toISOString();

  const base: ReviewUpdatePayload = {
    suggested_stage_role: null,
    stage_role_reviewed_at: nowIso,
    stage_role_reviewed_by: reviewerId,
  };

  switch (action) {
    case "approve":
      return { ...base, stage_role: suggestedRole };
    case "correct": {
      if (!correctedRole) {
        throw new Error("buildReviewUpdate: correct exige correctedRole");
      }
      return { ...base, stage_role: correctedRole };
    }
    case "dismiss":
      return base;
  }
}
