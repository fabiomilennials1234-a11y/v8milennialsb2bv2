/**
 * Slice 12 — per-org engine routing decision (Copilot v2 cutover).
 *
 * whatsapp-webhook reads organizations.copilot_engine_version and routes the
 * inbound to the v2 border ONLY when the org is explicitly flipped to 'v2'.
 * Everything else — legacy value, null, garbage, read error — MUST resolve to
 * v1. This is a 🔴 fail-safe: a bug here would divert ALL orgs' inbound.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  decideEngine,
  routeCopilotInbound,
} from '../../../supabase/functions/_shared/copilot-v2/engine-router.ts';

describe('decideEngine', () => {
  it("routes to v2 only on the exact string 'v2'", () => {
    expect(decideEngine('v2')).toBe('v2');
  });

  it("routes the legacy value 'v1' to v1", () => {
    expect(decideEngine('v1')).toBe('v1');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['uppercase V2', 'V2'],
    ['padded v2', ' v2'],
    ['unknown engine', 'gen3'],
    ['v2-ish', 'v2x'],
  ] as [string, string | null | undefined][])(
    'fails safe to v1 for %s',
    (_label, value) => {
      expect(decideEngine(value)).toBe('v1');
    },
  );
});

describe('routeCopilotInbound — 🔴 fail-safe webhook orchestration', () => {
  function deps(over: Partial<Parameters<typeof routeCopilotInbound>[0]> = {}) {
    return {
      readEngineFlag: vi.fn().mockResolvedValue('v1'),
      enqueueV1: vi.fn().mockResolvedValue({ error: null }),
      fallbackV1Direct: vi.fn().mockResolvedValue(undefined),
      dispatchV2: vi.fn().mockResolvedValue(undefined),
      ...over,
    };
  }

  it("routes a v2-flagged org to the v2 border and NEVER enqueues v1", async () => {
    const d = deps({ readEngineFlag: vi.fn().mockResolvedValue('v2') });
    const out = await routeCopilotInbound(d);
    expect(out).toBe('v2_dispatched');
    expect(d.dispatchV2).toHaveBeenCalledOnce();
    expect(d.enqueueV1).not.toHaveBeenCalled();
  });

  it('routes a v1 org to the legacy queue and never touches the v2 border', async () => {
    const d = deps({ readEngineFlag: vi.fn().mockResolvedValue('v1') });
    const out = await routeCopilotInbound(d);
    expect(out).toBe('v1_queued');
    expect(d.enqueueV1).toHaveBeenCalledOnce();
    expect(d.dispatchV2).not.toHaveBeenCalled();
  });

  it('fails safe to v1 when the engine-flag read throws (never diverts to v2 on error)', async () => {
    const d = deps({ readEngineFlag: vi.fn().mockRejectedValue(new Error('db down')) });
    const out = await routeCopilotInbound(d);
    expect(out).toBe('v1_queued');
    expect(d.enqueueV1).toHaveBeenCalledOnce();
    expect(d.dispatchV2).not.toHaveBeenCalled();
  });

  it('a null/legacy flag stays on v1', async () => {
    const d = deps({ readEngineFlag: vi.fn().mockResolvedValue(null) });
    expect(await routeCopilotInbound(d)).toBe('v1_queued');
    expect(d.dispatchV2).not.toHaveBeenCalled();
  });

  it('when the v2 border throws, it reports v2_failed and does NOT cross-route to v1 (no double-send)', async () => {
    const d = deps({
      readEngineFlag: vi.fn().mockResolvedValue('v2'),
      dispatchV2: vi.fn().mockRejectedValue(new Error('border boom')),
    });
    const out = await routeCopilotInbound(d);
    expect(out).toBe('v2_failed');
    expect(d.enqueueV1).not.toHaveBeenCalled();
    expect(d.fallbackV1Direct).not.toHaveBeenCalled();
  });

  it('falls back to the direct v1 call when the legacy queue insert errors', async () => {
    const d = deps({
      readEngineFlag: vi.fn().mockResolvedValue('v1'),
      enqueueV1: vi.fn().mockResolvedValue({ error: { message: 'queue full' } }),
    });
    const out = await routeCopilotInbound(d);
    expect(out).toBe('v1_fallback');
    expect(d.fallbackV1Direct).toHaveBeenCalledOnce();
  });
});
