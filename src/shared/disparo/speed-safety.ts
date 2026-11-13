/**
 * speed-safety — pure cap/risk math for the Velocidade step (ADR-0015, #908).
 *
 * One slider sets the Number Daily Cap applied to every selected number. A
 * number flagged "new" is auto-clamped to a lower effective cap regardless of
 * the slider (new numbers ban easiest). The slider's safe/risk zone is derived
 * from the Torque-recommended value: at or below it is safe, above it the user
 * explicitly assumes ban risk. Hard floor/ceiling bound the slider itself.
 *
 * Vive em `src/shared/` desde #1846: `disparo-numbers` é seu único consumidor
 * fora do wizard e os dois andam juntos. Zero imports — mantenha assim.
 */

export const CAP_MIN = 20;
export const CAP_MAX = 200;
/** Torque-recommended safe value; boundary of the green zone. */
export const CAP_RECOMMENDED = 80;
/** Ceiling a freshly connected number is clamped to, regardless of the slider. */
export const NEW_NUMBER_CAP = 20;

/** Chip uses CAP_MAX; an official channel can supply its configured ceiling. */
export function clampCap(value: number, maximum: number = CAP_MAX): number {
  const cap = Number.isFinite(maximum) && maximum >= 1 ? Math.floor(maximum) : CAP_MAX;
  const raw = Number.isFinite(value) ? Math.floor(value) : CAP_RECOMMENDED;
  return Math.min(cap, Math.max(Math.min(CAP_MIN, cap), raw));
}

/**
 * Effective per-number cap after the new-number clamp: an established number
 * sends at the slider value; a new number sends at most NEW_NUMBER_CAP (but
 * never more than the slider — a low slider still wins).
 */
export function effectiveCap(sliderCap: number, isNew: boolean): number {
  return isNew ? Math.min(sliderCap, NEW_NUMBER_CAP) : sliderCap;
}

export type CapRisk = "safe" | "risk";

/** Safe at/below the recommended value, risk above it. */
export function capRisk(sliderCap: number): CapRisk {
  return sliderCap > CAP_RECOMMENDED ? "risk" : "safe";
}
