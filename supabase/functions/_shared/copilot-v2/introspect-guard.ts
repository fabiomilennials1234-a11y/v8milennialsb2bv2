/**
 * introspect-guard — Copilot v2 write-after-introspect invariant (Slice 3).
 *
 * ADR-0002 #6: every write tool is preceded by an introspection read pulling the
 * LIVE structure (pipeline stages, custom fields, agenda). The write target must
 * exist in that introspection, or the write is blocked. This structurally
 * eliminates the orphaned-stage / orphaned-field bug class.
 *
 * Fail-CLOSED: a write attempted with no introspection (`introspected == null`)
 * is blocked.
 */

export interface Introspection {
  stages: string[];
  fields: string[];
}

export interface AssertWriteTargetInput {
  tool: string;
  /** The entity the write targets (stage_key, field_key) or null for tools
   *  whose target is not a structural slot (transfer_to_human, send_media). */
  target: string | null;
  introspected: Introspection | null;
}

export interface AssertWriteTargetResult {
  ok: boolean;
  reason: "missing_introspect" | "orphaned_target" | null;
}

/** Which introspection collection a tool's target must belong to. */
const TARGET_COLLECTION: Record<string, keyof Introspection> = {
  move_lead_stage: "stages",
  fill_lead_field: "fields",
};

export function assertWriteTarget(input: AssertWriteTargetInput): AssertWriteTargetResult {
  // No introspection performed → cannot validate the target → fail closed.
  if (input.introspected == null) {
    return { ok: false, reason: "missing_introspect" };
  }

  const collection = TARGET_COLLECTION[input.tool];
  // Tools without a structural target are fine once an introspection exists.
  if (!collection) {
    return { ok: true, reason: null };
  }

  if (input.target != null && input.introspected[collection].includes(input.target)) {
    return { ok: true, reason: null };
  }
  return { ok: false, reason: "orphaned_target" };
}
