/**
 * Stage Role write-back — pure persistence seam (U4, #991, ADR-0017 §1).
 *
 * The classifier edge function (`classify-stage-roles`) governs system and
 * custom stages in the single `pipeline_stages` table. The source kind below
 * exists only to split the operator report.
 *
 * Money invariant (ADR-0017 §1 — won/lost = dinheiro = confirmação humana):
 *   · meeting_booked / meeting_held (auto_apply) → sets `stage_role` directly.
 *   · won / lost (queue_review)                  → sets `suggested_stage_role`
 *     ONLY; NEVER `stage_role`. Held until a human confirms. This function is
 *     the write-side mirror of `decideStageRoleAction` and must never diverge.
 *
 * Pure — no IO, no side effects. The supabase update lives in the edge function.
 */

import type {
  StagePlanItem,
  SuggestableStageRole,
  SuggestionSource,
} from "./stage-role-classifier.ts";

/** Logical family in the classifier report. */
export type StageSourceTable = "system" | "custom";

export const STAGE_SOURCE_TABLES: readonly StageSourceTable[] = [
  "system",
  "custom",
] as const;

export interface StageRoleUpdate {
  /** Set only on auto_apply (meeting_*). Absent for won/lost. */
  stage_role?: SuggestableStageRole;
  /** Set only on queue_review (won/lost). Absent for meeting_*. */
  suggested_stage_role?: SuggestableStageRole;
  stage_role_suggested_at: string;
  stage_role_suggestion_source: SuggestionSource;
}

/**
 * Builds the column update for a planned suggestion.
 * won/lost land in `suggested_stage_role` — never in `stage_role`.
 */
export function buildStageRoleUpdate(
  item: StagePlanItem,
  nowIso: string,
): StageRoleUpdate {
  return item.action === "auto_apply"
    ? {
      stage_role: item.role,
      stage_role_suggested_at: nowIso,
      stage_role_suggestion_source: item.source,
    }
    : {
      suggested_stage_role: item.role,
      stage_role_suggested_at: nowIso,
      stage_role_suggestion_source: item.source,
    };
}
