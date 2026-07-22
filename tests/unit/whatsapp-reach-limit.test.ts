// @vitest-environment node
/**
 * Unit tests for the WhatsApp reach-allowance gate.
 *
 * `assessReach` is pure. `cachedReachLimitSource` owns its cache instance, so
 * each test gets a fresh one — no module-level state leaking between tests.
 */

import { describe, it, expect, vi } from "vitest";

const { assessReach, cachedReachLimitSource } = await import(
  "../../supabase/functions/_shared/whatsapp-reach-limit.ts"
);

describe("assessReach", () => {
  it("reports headroom when the account is below its allowance", () => {
    expect(assessReach({ current: 30, limit: 80 })).toMatchObject({
      exhausted: false,
      headroom: 50,
    });
  });

  it("marks the account exhausted at the ceiling", () => {
    expect(assessReach({ current: 80, limit: 80 })).toMatchObject({
      exhausted: true,
      headroom: 0,
    });
  });

  it("marks the account exhausted above the ceiling and never reports negative headroom", () => {
    expect(assessReach({ current: 95, limit: 80 })).toMatchObject({
      exhausted: true,
      headroom: 0,
    });
  });

  it("preserves the raw reading so it can be logged for calibration", () => {
    const raw = { current: 30, limit: 80, reachout_timelock: 1_700_000_000 };
    expect(assessReach(raw).limit).toEqual(raw);
  });

  // --- fail-open cases -----------------------------------------------------
  // Deliberately the OPPOSITE of the other blast guards, which are fail-closed.
  // Those ledgers are ours and a read failure means we lost track of our own
  // accounting. This one is the provider's opinion: not knowing it must never
  // become a reason to refuse a send the user is entitled to make.

  it("does not block when the reading is unavailable", () => {
    expect(assessReach(null)).toMatchObject({ exhausted: false, headroom: null });
  });

  it("does not block on a malformed reading", () => {
    for (const bad of [
      { current: Number.NaN, limit: 80 },
      { current: 10, limit: Number.NaN },
      { current: 10, limit: Number.POSITIVE_INFINITY },
      { current: "10", limit: 80 },
      {},
    ]) {
      expect(assessReach(bad as never)).toMatchObject({
        exhausted: false,
        headroom: null,
      });
    }
  });

  it("does not block when the provider reports a non-positive allowance", () => {
    // limit 0 is ambiguous — "no allowance" and "field not applicable" look the
    // same. Refusing on an ambiguous zero would block accounts that are fine.
    expect(assessReach({ current: 0, limit: 0 })).toMatchObject({
      exhausted: false,
      headroom: null,
    });
  });

  it("never blocks on reachout_timelock alone", () => {
    // The field's unit is undocumented in this codebase (epoch? seconds left?
    // 0 = no lock?). It is carried for calibration, never used as a verdict.
    expect(
      assessReach({ current: 1, limit: 80, reachout_timelock: 999_999 })
    ).toMatchObject({ exhausted: false });
  });
});

describe("cachedReachLimitSource", () => {
  it("reads through on first call", async () => {
    const fetcher = vi.fn().mockResolvedValue({ current: 10, limit: 80 });
    const source = cachedReachLimitSource(fetcher, { ttlMs: 30_000 });

    await expect(source.get("inst-1")).resolves.toEqual({ current: 10, limit: 80 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("serves repeat reads from cache within the window", async () => {
    const fetcher = vi.fn().mockResolvedValue({ current: 10, limit: 80 });
    const source = cachedReachLimitSource(fetcher, { ttlMs: 30_000 });

    await source.get("inst-1");
    await source.get("inst-1");
    await source.get("inst-1");

    // Without this the gate becomes its own source of provider traffic —
    // the exact problem it exists to reduce.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("caches per instance, not globally", async () => {
    const fetcher = vi.fn().mockResolvedValue({ current: 10, limit: 80 });
    const source = cachedReachLimitSource(fetcher, { ttlMs: 30_000 });

    await source.get("inst-1");
    await source.get("inst-2");

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reads again once the window expires", async () => {
    let now = 1_000;
    const fetcher = vi.fn().mockResolvedValue({ current: 10, limit: 80 });
    const source = cachedReachLimitSource(fetcher, { ttlMs: 30_000, now: () => now });

    await source.get("inst-1");
    now += 30_001;
    await source.get("inst-1");

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns null and does not throw when the read fails", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("provider down"));
    const source = cachedReachLimitSource(fetcher, { ttlMs: 30_000 });

    await expect(source.get("inst-1")).resolves.toBeNull();
  });

  it("does not cache a failure — the next call retries", async () => {
    // Caching a failure would extend one transient blip into a blind window.
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValue({ current: 10, limit: 80 });
    const source = cachedReachLimitSource(fetcher, { ttlMs: 30_000 });

    await expect(source.get("inst-1")).resolves.toBeNull();
    await expect(source.get("inst-1")).resolves.toEqual({ current: 10, limit: 80 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
