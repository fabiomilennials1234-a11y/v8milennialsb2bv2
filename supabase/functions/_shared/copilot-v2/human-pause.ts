/**
 * human-pause — Copilot v2 phone-keyed pause gate (pure decision layer).
 *
 * When a human takes over a conversation, the agent must go silent until the
 * pause expires. The pause is keyed by the canonical phone (see
 * phone-normalizer) so the key written on takeover is found on check — this is
 * the fix for the "40% ai_disabled" incident, where two phone renderings
 * disagreed and the lookup missed.
 *
 * fail-CLOSED (CTO decision 2026-05-31): if the pause state cannot be
 * determined — the check errored, or paused_until is present but unparseable —
 * BLOCK the turn. We never send when unsure whether a human is in control.
 * A missing record (no row) is an unambiguous "not paused" and is allowed.
 */

export interface PauseRecord {
  paused_until: string | null;
}

export interface HumanPauseGateInput {
  /** The pause row for this (org, canonical_phone), or null if none exists. */
  record: PauseRecord | null;
  /** True if the lookup itself threw. */
  checkErrored: boolean;
  now: Date;
}

export interface HumanPauseGateDecision {
  blocked: boolean;
  reason: "pause_check_failed" | "human_pause_active" | null;
}

export function decideHumanPauseGate(input: HumanPauseGateInput): HumanPauseGateDecision {
  if (input.checkErrored) {
    return { blocked: true, reason: "pause_check_failed" };
  }

  const until = input.record?.paused_until ?? null;
  if (until == null) {
    return { blocked: false, reason: null };
  }

  const untilMs = new Date(until).getTime();
  if (Number.isNaN(untilMs)) {
    // Present but unparseable — cannot trust it. Fail closed.
    return { blocked: true, reason: "pause_check_failed" };
  }

  if (untilMs > input.now.getTime()) {
    return { blocked: true, reason: "human_pause_active" };
  }
  return { blocked: false, reason: null };
}
