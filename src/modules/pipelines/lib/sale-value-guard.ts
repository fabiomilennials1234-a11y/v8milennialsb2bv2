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
 * The decision: prompt for a value before allowing this transition?
 * True iff the target is a won stage AND no usable value is present yet.
 */
export function shouldPromptForSaleValue(
  targetStageKey: string,
  currentValue: unknown,
  stages: readonly WonStageResolvable[] | null | undefined,
): boolean {
  return isWonStageKey(targetStageKey, stages) && !hasUsableSaleValue(currentValue);
}
