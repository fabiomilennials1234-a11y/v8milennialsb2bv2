/**
 * W10 — Inbound rate-limiter (Copilot v2 border gate)
 *
 * Pure decision: given how many inbound messages a phone already sent in the
 * window, decide whether to block the just-arrived one. On breach: drop it, and
 * (once per breach window) send a single canned deflection notice. fail-CLOSED:
 * a check error blocks (a flood must never slip through because the count read
 * failed). Distinct from proactive-scheduler.decideRateLimitGate (that gates
 * OUTBOUND proactive sends; this gates INBOUND at the border).
 *
 * `countInWindow` is the count of PRIOR inbound from this phone in the window
 * (the just-arrived message is NOT yet counted), so max=15 admits exactly 15.
 */

import { describe, it, expect } from 'vitest';
import {
  decideInboundRateLimit,
  type InboundRateLimitInput,
} from '../../../supabase/functions/_shared/copilot-v2/rate-limit-inbound.ts';

const base: InboundRateLimitInput = {
  countInWindow: 0,
  maxPerWindow: 15,
  alreadyNotified: false,
  checkErrored: false,
};

describe('decideInboundRateLimit', () => {
  it('under the limit → allowed, no notice', () => {
    expect(decideInboundRateLimit({ ...base, countInWindow: 14 })).toEqual({
      blocked: false, reason: null, sendNotice: false,
    });
  });

  it('admits exactly maxPerWindow before blocking (prior=max-1 is the last allowed)', () => {
    expect(decideInboundRateLimit({ ...base, countInWindow: 14 }).blocked).toBe(false);
    expect(decideInboundRateLimit({ ...base, countInWindow: 15 }).blocked).toBe(true);
  });

  it('at the limit → blocked + sends one canned notice (not yet notified)', () => {
    expect(decideInboundRateLimit({ ...base, countInWindow: 15 })).toEqual({
      blocked: true, reason: 'rate_limit_exceeded', sendNotice: true,
    });
  });

  it('over the limit but already notified → blocked, NO repeat notice', () => {
    expect(decideInboundRateLimit({ ...base, countInWindow: 40, alreadyNotified: true })).toEqual({
      blocked: true, reason: 'rate_limit_exceeded', sendNotice: false,
    });
  });

  it('checkErrored → fail-CLOSED block, distinct reason, no notice', () => {
    expect(decideInboundRateLimit({ ...base, checkErrored: true })).toEqual({
      blocked: true, reason: 'rate_limit_check_failed', sendNotice: false,
    });
  });

  it('malformed limit (0 / NaN / negative) → fail-CLOSED block', () => {
    expect(decideInboundRateLimit({ ...base, maxPerWindow: 0 }).blocked).toBe(true);
    expect(decideInboundRateLimit({ ...base, maxPerWindow: NaN }).reason).toBe('rate_limit_check_failed');
    expect(decideInboundRateLimit({ ...base, countInWindow: -1 }).reason).toBe('rate_limit_check_failed');
  });

  it('is deterministic: same input → same output', () => {
    const inp = { ...base, countInWindow: 15 };
    expect(decideInboundRateLimit(inp)).toEqual(decideInboundRateLimit(inp));
  });
});
