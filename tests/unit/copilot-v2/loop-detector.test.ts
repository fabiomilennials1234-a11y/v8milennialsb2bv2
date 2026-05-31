/**
 * Slice 1 — loop-detector (Copilot v2)
 *
 * Regression — incident "Bertin" (2026-05-08/09): an external real-estate bot
 * (5515935004596) exchanged 3000+ messages with Copilot Bia in 9h13min. v1 had
 * a pure evaluator that declared `inbound_outbound_pingpong` in its type union
 * but NEVER implemented the branch (bot-loop-detector.ts:78 returned null), and
 * the detector was never wired into the turn loop. v2 implements pingpong and
 * the gate is fail-CLOSED (a failed loop check blocks the turn, never sends).
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateLoopSignal,
  decideLoopGate,
  type LoopMessage,
} from '../../../supabase/functions/_shared/copilot-v2/loop-detector.ts';

const now = new Date('2026-05-31T12:00:00.000Z');
const at = (secondsAgo: number) => new Date(now.getTime() - secondsAgo * 1000).toISOString();

function out(hash: string, secondsAgo: number): LoopMessage {
  return { content_hash: hash, direction: 'outgoing', timestamp: at(secondsAgo) };
}
function inc(hash: string, secondsAgo: number): LoopMessage {
  return { content_hash: hash, direction: 'incoming', timestamp: at(secondsAgo) };
}

describe('evaluateLoopSignal — identical outgoing burst (mirrors v1)', () => {
  it('pauses on 3 identical outgoing within the burst window', () => {
    const signal = evaluateLoopSignal({
      messages: [out('A', 30), out('A', 20), out('A', 10)],
      now,
    });
    expect(signal?.shouldPause).toBe(true);
    expect(signal?.reason).toBe('identical_outgoing_burst');
  });

  it('does not pause on 2 identical outgoing (below threshold)', () => {
    const signal = evaluateLoopSignal({ messages: [out('A', 20), out('A', 10)], now });
    expect(signal).toBeNull();
  });

  it('does not count identical messages older than the window', () => {
    const signal = evaluateLoopSignal({
      messages: [out('A', 200), out('A', 150), out('A', 10)],
      now,
      burstWindowSeconds: 60,
    });
    expect(signal).toBeNull();
  });
});

describe('evaluateLoopSignal — inbound/outbound pingpong (NEW: v1 branch was a no-op)', () => {
  it('pauses on rapid alternation even when content differs (the real bot-loop)', () => {
    const signal = evaluateLoopSignal({
      messages: [
        inc('a', 12), out('b', 10), inc('c', 8), out('d', 6), inc('e', 4), out('f', 2),
      ],
      now,
    });
    expect(signal?.shouldPause).toBe(true);
    expect(signal?.reason).toBe('inbound_outbound_pingpong');
  });

  it('does NOT pause a normal slow back-and-forth (gaps exceed max)', () => {
    const signal = evaluateLoopSignal({
      messages: [
        inc('a', 600), out('b', 480), inc('c', 360), out('d', 240), inc('e', 120), out('f', 5),
      ],
      now,
    });
    expect(signal).toBeNull();
  });

  it('does NOT pause when alternation run is too short (2 pairs)', () => {
    const signal = evaluateLoopSignal({
      messages: [inc('a', 8), out('b', 6), inc('c', 4), out('d', 2)],
      now,
    });
    expect(signal).toBeNull();
  });

  it('breaks the run on a single large gap mid-sequence (no false positive)', () => {
    const signal = evaluateLoopSignal({
      messages: [
        inc('a', 12), out('b', 10), inc('c', 8), out('d', 400), inc('e', 4), out('f', 2),
      ],
      now,
    });
    expect(signal).toBeNull();
  });
});

describe('decideLoopGate — fail-CLOSED', () => {
  it('blocks the turn when the loop check itself errored (fail-closed)', () => {
    const gate = decideLoopGate({ signal: null, checkErrored: true });
    expect(gate.block).toBe(true);
    expect(gate.reason).toBe('loop_check_failed');
  });

  it('blocks when a loop signal fired', () => {
    const gate = decideLoopGate({
      signal: { shouldPause: true, reason: 'identical_outgoing_burst', evidence: { count: 3, windowSeconds: 60, contentHashes: ['A'] } },
      checkErrored: false,
    });
    expect(gate.block).toBe(true);
    expect(gate.reason).toBe('bot_loop_detected');
  });

  it('allows when no signal and no error', () => {
    const gate = decideLoopGate({ signal: null, checkErrored: false });
    expect(gate.block).toBe(false);
  });
});
