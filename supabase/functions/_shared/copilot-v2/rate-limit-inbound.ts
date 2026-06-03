/**
 * rate-limit-inbound — Copilot v2 inbound rate-limiter decision (W10, pure).
 *
 * Caps how many inbound messages a single phone can drive into the agent per
 * window (CTO: 15/phone/min). On breach the message is dropped and ONE canned
 * deflection notice is sent (then silence until the window clears). fail-CLOSED:
 * a count-read error blocks — a flood must never slip through because the lookup
 * failed.
 *
 * Pure: `countInWindow` (prior inbound count) + `maxPerWindow` + flags injected;
 * the border owns the windowed DB count and the clock. Named distinctly from
 * proactive-scheduler.decideRateLimitGate (which gates OUTBOUND proactive sends).
 */

export interface InboundRateLimitInput {
  /** Prior inbound from this phone within the window (current msg NOT counted). */
  countInWindow: number;
  /** Max inbound admitted per window. */
  maxPerWindow: number;
  /** True if a deflection notice was already sent this breach window. */
  alreadyNotified: boolean;
  /** True if the count lookup itself threw. */
  checkErrored: boolean;
}

export interface InboundRateLimitDecision {
  blocked: boolean;
  reason: null | 'rate_limit_exceeded' | 'rate_limit_check_failed';
  /** True → send exactly one canned deflection notice for this breach. */
  sendNotice: boolean;
}

function bad(n: number): boolean {
  return typeof n !== 'number' || !Number.isFinite(n) || n < 0;
}

export function decideInboundRateLimit(input: InboundRateLimitInput): InboundRateLimitDecision {
  const { countInWindow, maxPerWindow, alreadyNotified, checkErrored } = input;

  // fail-CLOSED: can't trust the count → block, no notice.
  if (checkErrored || bad(countInWindow) || bad(maxPerWindow) || maxPerWindow <= 0) {
    return { blocked: true, reason: 'rate_limit_check_failed', sendNotice: false };
  }

  if (countInWindow >= maxPerWindow) {
    return { blocked: true, reason: 'rate_limit_exceeded', sendNotice: !alreadyNotified };
  }

  return { blocked: false, reason: null, sendNotice: false };
}
