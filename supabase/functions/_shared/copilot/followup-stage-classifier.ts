/**
 * AI Stage Classifier — deterministic core.
 *
 * Orgs rename funnel stages freely and the stage_key is desynced legacy noise,
 * so a Follow-up Situation's trigger stages cannot be hardcoded (ADR-0006
 * amendment 2026-06-08). An LLM classifies each org's stages (by name) into a
 * canonical role; this pure function turns that classification into the
 * per-Situation trigger_stage_keys, applying the hard terminal override.
 *
 * The LLM call and the DB write live in the edge function; this module has no
 * side effects so the role->situation mapping and the override are testable in
 * isolation.
 */

import type { SituationId } from "./followup-situations.ts";

export type StageRole =
  | "novo"
  | "qualificado"
  | "proposta_ativa"
  | "frio"
  | "reuniao"
  | "no_show"
  | "ganho"
  | "perdido";

export interface StageInfo {
  stageKey: string;
  name: string;
  position: number;
  isFinalPositive: boolean;
  isFinalNegative: boolean;
}

const ROLE_TO_SITUATION: Partial<Record<StageRole, SituationId>> = {
  novo: "new_lead_no_reply",
  qualificado: "qualified_no_meeting",
  proposta_ativa: "proposal_no_reply",
  reuniao: "meeting_reminder",
  no_show: "no_show_rebook",
  // frio / ganho / perdido map to no Situation.
};

export function buildTriggerStageMap(params: {
  stages: StageInfo[];
  classification: Record<string, StageRole>;
}): Partial<Record<SituationId, string[]>> {
  const { stages, classification } = params;
  const map: Partial<Record<SituationId, string[]>> = {};

  for (const stage of stages) {
    // Hard override: terminal (won/lost) stages never trigger anything,
    // regardless of what the LLM classified them as.
    if (stage.isFinalPositive || stage.isFinalNegative) continue;

    const role = classification[stage.stageKey];
    const situation = role ? ROLE_TO_SITUATION[role] : undefined;
    if (!situation) continue;

    (map[situation] ??= []).push(stage.stageKey);
  }

  return map;
}
