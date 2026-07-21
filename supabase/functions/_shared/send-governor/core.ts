/**
 * send-governor/core — PURE decision logic for the Send Governor (anti-ban).
 *
 * Zero IO, clock-free (the evaluation instant is state.nowIso). Mirrors the
 * quick-blast/quiet-hours.ts pattern: all the security-critical branching lives
 * here so it is exhaustively unit-testable without a live DB or provider.
 *
 * Precedence (first match wins):
 *   0. mode 'off'                       → allow  (governor_off)
 *   1. category 'manual'                → allow  (manual_exempt)  [any mode]
 *   2. category 'system'               → allow  (allowed)        [exempt PR-0]
 *   3. P3 quarantine (automation|mass)  → block  (quarantined)
 *   4. category 'mass'                  → allow  (allowed)  [caps: blast_*]
 *   5. P1/P2 per-number cap (automation)→ defer  (per_number_cap)
 *   6. P4 cold gate (automation)        → block  (cold_contact)
 *   7. otherwise                        → allow  (allowed)
 *
 * SHADOW OVERRIDE: when mode === 'shadow', the EFFECTIVE action is ALWAYS
 * 'allow'; the would-be block/defer is preserved in `wouldBe` (+ shadowed=true).
 * Shadow can NEVER emit a real block/defer — that invariant is tested directly.
 */

import type {
  GovernorContext,
  GovernorDecision,
  GovernorDecisionReason,
  GovernorMode,
  GovernorState,
  SendCategory,
} from "./types.ts";

/** Torque-recommended safe per-number ceiling (matches instance-budget.ts). */
export const GOVERNOR_DEFAULT_CAP = 80;

/**
 * Warm-up ramp: the per-number automation cap while a number is warming up,
 * derived from its age in days. Converges to the number's own base cap.
 *
 *   age 0        → 20
 *   age 1–2      → 30
 *   age 3–6      → 50
 *   age 7+       → baseCap (fully warmed)
 *
 * The ramp is always clamped to baseCap (never widens a tighter configured
 * cap). Unknown age (null/NaN) → baseCap: warm-up must never TIGHTEN on missing
 * data (fail-open — the governor is not a single point of failure).
 */
export function warmupCapForAge(
  ageDays: number | null | undefined,
  baseCap: number,
): number {
  if (ageDays === null || ageDays === undefined || !Number.isFinite(ageDays)) {
    return baseCap;
  }
  let ramp: number;
  if (ageDays <= 0) ramp = 20;
  else if (ageDays <= 2) ramp = 30;
  else if (ageDays <= 6) ramp = 50;
  else return baseCap; // 7+ days → fully warmed, use the configured cap
  return Math.min(ramp, baseCap);
}

/**
 * Best-effort classification of a send from its provider trackSource. The
 * wiring layer usually passes an EXPLICIT category at each seam; this is the
 * fallback when only a trackSource string is known.
 *
 * Default (no trackSource) → 'automation': every path that flows through
 * whatsapp-dispatch primitives is automation (the manual human composer bypasses
 * that layer entirely — whatsapp-api-proxy calls provider.sendText directly —
 * so a primitive never carries human traffic).
 */
export function deriveCategory(trackSource?: string | null): SendCategory {
  if (!trackSource) return "automation";
  const s = trackSource.toLowerCase();
  if (
    s === "manual" || s === "composer" || s === "human" || s === "chat" ||
    s === "inbox"
  ) {
    return "manual";
  }
  if (
    s === "mass" || s === "blast" || s === "mass_send" || s === "quick_blast" ||
    s === "sender" || s.startsWith("sender") || s.includes("blast")
  ) {
    return "mass";
  }
  if (s === "system" || s === "cron" || s === "internal") return "system";
  // copilot, copilot_v2, followup, workflow, campaign, pipe, outbound, … .
  return "automation";
}

/** Quarantine is ACTIVE only while quarantined AND now < quarantine_until
 *  (or indefinitely when quarantine_until is null). An expired quarantine
 *  recovers implicitly at read time — no block. */
function quarantineActive(state: GovernorState): boolean {
  if (state.reputation !== "quarantined") return false;
  if (!state.quarantineUntil) return true; // indefinite
  const now = Date.parse(state.nowIso);
  const until = Date.parse(state.quarantineUntil);
  if (Number.isNaN(now) || Number.isNaN(until)) return true; // fail-safe: block
  return now < until;
}

/** Approximate "retry tomorrow": next day at 12:00Z (~09:00 BRT, safely inside
 *  a normal send window). Pure/deterministic — exact window scheduling is the
 *  quiet-hours module's job when wiring adds deferral. */
function nextDayIso(nowIso: string): string {
  const d = new Date(nowIso);
  if (Number.isNaN(d.getTime())) return nowIso;
  const next = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 12, 0, 0),
  );
  return next.toISOString();
}

/**
 * Apply the SHADOW override and build the final decision. In shadow, a would-be
 * block/defer is flipped to an effective allow (shadowed=true) while `wouldBe`
 * records the real verdict. In off/enforce, action === wouldBe.
 */
function finalize(
  mode: GovernorMode,
  wouldBe: GovernorDecision["action"],
  reason: GovernorDecisionReason,
  ctx: GovernorContext,
  retryAt?: string,
): GovernorDecision {
  const shadowFlipped = mode === "shadow" && wouldBe !== "allow";
  return {
    action: shadowFlipped ? "allow" : wouldBe,
    wouldBe,
    reason,
    category: ctx.category,
    mode,
    retryAt,
    shadowed: shadowFlipped,
  };
}

/**
 * The pure verdict. Reads ctx (caller facts) + state (DB-resolved, fail-open)
 * and returns the decision. Never throws for well-formed inputs; never does IO.
 */
export function evaluateSend(
  ctx: GovernorContext,
  state: GovernorState,
): GovernorDecision {
  const decide = (
    wouldBe: GovernorDecision["action"],
    reason: GovernorDecisionReason,
    retryAt?: string,
  ) => finalize(state.mode, wouldBe, reason, ctx, retryAt);

  // 0. Governor inert.
  if (state.mode === "off") return decide("allow", "governor_off");

  // 1. Manual is always exempt, in every mode.
  if (ctx.category === "manual") return decide("allow", "manual_exempt");

  // 2. System messages are exempt in PR-0.
  if (ctx.category === "system") return decide("allow", "allowed");

  // — automation | mass from here —

  // 3. P3 disjuntor: a quarantined number blocks automation AND mass.
  if (quarantineActive(state)) return decide("block", "quarantined");

  // 4. Mass: only the quarantine gate applies here. Volume caps for mass are
  //    enforced by the existing blast_* ledgers — do NOT re-implement them.
  if (ctx.category === "mass") return decide("allow", "allowed");

  // — automation only —

  // 5. P1/P2: per-number daily cap, tightened by the warm-up ramp when enabled.
  const warmupCap = state.warmupEnabled
    ? warmupCapForAge(state.instanceAgeDays, state.instanceCap)
    : state.instanceCap;
  const effectiveCap = Math.min(state.instanceCap, warmupCap);
  if (state.usedToday >= effectiveCap) {
    return decide("defer", "per_number_cap", nextDayIso(state.nowIso));
  }

  // 6. P4: cold-contact gate (only when the org enabled it).
  if (state.coldGateEnabled && ctx.category === "automation" && state.isColdContact) {
    return decide("block", "cold_contact");
  }

  // 7. Nothing tripped.
  return decide("allow", "allowed");
}
