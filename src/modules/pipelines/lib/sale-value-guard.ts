/**
 * sale-value-guard — single source of the "value before won" rule (D1 / SQL-I3).
 *
 * The sale ledger (`sale_events`, ADR-0017 §4) is append-only and snapshots
 * `pipeline_entries.metadata->>'sale_value'` AT THE INSTANT a stage becomes
 * `won`. If the value is not in the entry metadata at that moment, the sale is
 * recorded `NULL` forever — a later value-only edit fires no stage event and
 * the ledger is immutable. So every human-driven won-transition must guarantee
 * `sale_value` is present in the same mutation that writes the won `stage_key`.
 *
 * This module owns the RULE (pure, unit-tested). UI wiring lives in
 * `useSaleValueGuard` (modal orchestration) and `SaleValueRequiredModal` (UX).
 * Won resolution is governed by `pipeline_stages.stage_role = 'won'` (#990),
 * NOT a hardcoded 'vendido' — custom/renamed stages must work (R2). The legacy
 * key is only a last-resort fallback when stage config is unavailable.
 */

import type { StageRole } from "@/contracts/pipe";

/**
 * Minimal stage shape the guard needs. `stage_role` / `is_final_positive` are
 * optional so both the governed `PipelineStage` row AND the in-memory default
 * fallback (which omits `stage_role`) satisfy it.
 */
export interface WonStageResolvable {
  stage_key: string;
  stage_role?: StageRole | null;
  is_final_positive?: boolean | null;
  /**
   * Stage-level opt-in (SCRUM-545 fatia 3 · migration 20270903000020).
   *
   * `undefined` means the column has not reached this client yet (stale types,
   * board hydrated before the migration, or a caller that selects a narrower
   * shape). In that case the rule falls back to the legacy won-resolution —
   * NEVER to `false`, which would silently stop guarding won transitions.
   */
  requires_sale_value?: boolean | null;
}

/**
 * Parse a raw metadata `sale_value` into a strictly-positive number, or `null`.
 * Mirrors the ledger's tolerance: empty / malformed / non-positive → unknown.
 */
export function parseSaleValue(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n =
    typeof raw === "number"
      ? raw
      : Number(String(raw).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Usable = present, finite, strictly positive. */
export function hasUsableSaleValue(value: unknown): boolean {
  return parseSaleValue(value) !== null;
}

/**
 * Resolve whether `stageKey` lands in a `won`-role stage.
 *
 * Priority:
 *  1. Governed role `stage_role === 'won'` (canonical, mirrors the DB capture).
 *  2. Pre-governance bridge: an ungoverned stage (role still the default
 *     `open`) flagged `is_final_positive` — the legacy "success" signal.
 *  3. Last resort (no stage config loaded): the legacy key `vendido`.
 */
export function isWonStageKey(
  stageKey: string,
  stages: readonly WonStageResolvable[] | null | undefined,
): boolean {
  if (stages && stages.length > 0) {
    const stage = stages.find((s) => s.stage_key === stageKey);
    // Config is loaded: trust it. A key absent from the loaded board is not a
    // won stage (and isn't a real move target) — do NOT legacy-fallback here.
    if (!stage) return false;
    if (stage.stage_role === "won") return true;
    const ungoverned: StageRole | null | undefined = stage.stage_role;
    if ((ungoverned == null || ungoverned === "open") && stage.is_final_positive) {
      return true;
    }
    return false;
  }
  // No stage config loaded → last-resort legacy key so the guard still fires
  // on the default board before stages hydrate.
  return stageKey === "vendido";
}

/**
 * Does landing on `stageKey` require a sale value?
 *
 * Two sources, in order:
 *  1. The stage's own `requires_sale_value` flag (SCRUM-545 fatia 3). This is
 *     the configurable answer, and it is the ONLY way to require a value on a
 *     stage that is not a won stage.
 *  2. The legacy won-resolution, when the flag has not reached this client.
 *
 * The fallback is deliberate and one-directional. `requires_sale_value === false`
 * on a won stage is honoured (an admin turned it off knowingly), but a MISSING
 * flag never disables the guard — a stale board or a narrow `select()` must not
 * be able to let a won transition through unpriced. The ledger is append-only:
 * a sale captured with `NULL` stays `NULL` forever (ADR-0017 §4).
 */
export function stageRequiresSaleValue(
  stageKey: string,
  stages: readonly WonStageResolvable[] | null | undefined,
): boolean {
  const stage = stages?.find((s) => s.stage_key === stageKey);
  // Type check, not truthiness: `false` is a real answer and must win over the
  // legacy fallback, while `undefined`/`null` mean "not loaded" and must not.
  if (typeof stage?.requires_sale_value === "boolean") {
    return stage.requires_sale_value;
  }
  return isWonStageKey(stageKey, stages);
}

/**
 * The decision: prompt for a value before allowing this transition?
 * True iff the target stage requires a value AND none is present yet.
 */
export function shouldPromptForSaleValue(
  targetStageKey: string,
  currentValue: unknown,
  stages: readonly WonStageResolvable[] | null | undefined,
): boolean {
  return stageRequiresSaleValue(targetStageKey, stages) && !hasUsableSaleValue(currentValue);
}

