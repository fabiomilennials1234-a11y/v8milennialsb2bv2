/**
 * Stage Role write-back — pure persistence seam (U4, #991, ADR-0017 §1).
 *
 * The classifier edge function (`classify-stage-roles`) governs ungoverned
 * stages across TWO tables — SYSTEM `pipeline_stages` and CUSTOM
 * `custom_pipeline_stages` — and writes each stage's plan back to the SAME
 * table the row came from. U1 (20270302000110) mirrored the suggestion columns
 * (`stage_role`, `suggested_stage_role`, `stage_role_suggested_at`,
 * `stage_role_suggestion_source`) onto `custom_pipeline_stages`, so the payload
 * shape is IDENTICAL for both tables — one builder, two tables (DRY).
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

/** The two stage tables whose roles the classifier governs. */
export type StageSourceTable = "pipeline_stages" | "custom_pipeline_stages";

export const STAGE_SOURCE_TABLES: readonly StageSourceTable[] = [
  "pipeline_stages",
  "custom_pipeline_stages",
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
 * Builds the column update for a planned suggestion. Table-agnostic: the same
 * payload applies to `pipeline_stages` and `custom_pipeline_stages` (U1 mirror).
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
