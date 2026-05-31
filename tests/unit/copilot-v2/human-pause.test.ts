/**
 * Slice 1 — human-pause gate decision (Copilot v2)
 *
 * Regression — incident "40% ai_disabled": when a human takes over a chat, the
 * agent must stay silent until the pause expires. The pause is phone-keyed via
 * the canonical phone (see phone-normalizer). This pure decision layer is
 * fail-CLOSED: if we cannot determine the pause state, we BLOCK (do not send) —
 * the CTO-locked decision. A missing record (no pause) is a clean "not paused".
 */

import { describe, it, expect } from 'vitest';
import {
  decideHumanPauseGate,
  type PauseRecord,
} from '../../../supabase/functions/_shared/copilot-v2/human-pause.ts';

const now = new Date('2026-05-31T12:00:00.000Z');
const future = new Date(now.getTime() + 30 * 60_000).toISOString();
const past = new Date(now.getTime() - 5 * 60_000).toISOString();

describe('decideHumanPauseGate — fail-CLOSED', () => {
  it('blocks when the pause check errored (fail-closed, CTO decision)', () => {
    const gate = decideHumanPauseGate({ record: null, checkErrored: true, now });
    expect(gate.blocked).toBe(true);
    expect(gate.reason).toBe('pause_check_failed');
  });

  it('blocks while a pause is active (paused_until in the future)', () => {
    const gate = decideHumanPauseGate({ record: { paused_until: future }, checkErrored: false, now });
    expect(gate.blocked).toBe(true);
    expect(gate.reason).toBe('human_pause_active');
  });

  it('allows when the pause has expired (paused_until in the past)', () => {
    const gate = decideHumanPauseGate({ record: { paused_until: past }, checkErrored: false, now });
    expect(gate.blocked).toBe(false);
  });

  it('allows when there is no pause record at all (clean not-paused)', () => {
    const gate = decideHumanPauseGate({ record: null, checkErrored: false, now });
    expect(gate.blocked).toBe(false);
  });

  it('allows when paused_until is null on the record', () => {
    const gate = decideHumanPauseGate({ record: { paused_until: null }, checkErrored: false, now });
    expect(gate.blocked).toBe(false);
  });

  it('never throws on a malformed record', () => {
    expect(() =>
      decideHumanPauseGate({ record: { paused_until: 'not-a-date' } as PauseRecord, checkErrored: false, now }),
    ).not.toThrow();
    // An unparseable date must not silently allow — treat as blocked (fail-closed).
    const gate = decideHumanPauseGate({ record: { paused_until: 'not-a-date' } as PauseRecord, checkErrored: false, now });
    expect(gate.blocked).toBe(true);
    expect(gate.reason).toBe('pause_check_failed');
  });
});
