/**
 * useRealtimeFallback — unit coverage for the pure decision function.
 *
 * The hook itself is a thin React wrapper around `shouldFallback` plus a
 * 15s ticker; we test the pure logic (which is what carries the contract)
 * and trust React's scheduling for the rest.
 */
import { describe, it, expect } from "vitest";
import {
  shouldFallback,
  FALLBACK_THRESHOLD_MS,
} from "@/hooks/chat/useRealtimeFallback";

const T0 = 1_000_000;

describe("shouldFallback", () => {
  it("returns false when channel is joined regardless of duration", () => {
    expect(shouldFallback("joined", T0, T0)).toBe(false);
    expect(shouldFallback("joined", T0, T0 + 10 * 60_000)).toBe(false);
  });

  it("returns false during grace window for non-healthy states", () => {
    const justUnder = T0 + FALLBACK_THRESHOLD_MS - 1;
    expect(shouldFallback("offline", T0, justUnder)).toBe(false);
    expect(shouldFallback("stale", T0, justUnder)).toBe(false);
    expect(shouldFallback("reconnecting", T0, justUnder)).toBe(false);
    expect(shouldFallback("joining", T0, justUnder)).toBe(false);
    expect(shouldFallback("unknown", T0, justUnder)).toBe(false);
  });

  it("returns true once threshold elapsed for non-healthy states", () => {
    const exactly = T0 + FALLBACK_THRESHOLD_MS;
    expect(shouldFallback("offline", T0, exactly)).toBe(true);
    expect(shouldFallback("stale", T0, exactly)).toBe(true);
    expect(shouldFallback("reconnecting", T0, exactly)).toBe(true);
    expect(shouldFallback("joining", T0, exactly)).toBe(true);
    expect(shouldFallback("unknown", T0, exactly)).toBe(true);
  });

  it("respects custom threshold", () => {
    expect(shouldFallback("offline", T0, T0 + 5_000, 10_000)).toBe(false);
    expect(shouldFallback("offline", T0, T0 + 10_000, 10_000)).toBe(true);
  });

  it("flips back to false the instant the channel rejoins (caller resets lastTransitionAt)", () => {
    const offlineLong = shouldFallback("offline", T0, T0 + 10 * 60_000);
    expect(offlineLong).toBe(true);

    const rejoinedAt = T0 + 10 * 60_000 + 500;
    const polledRightAfterRejoin = shouldFallback("joined", rejoinedAt, rejoinedAt + 5 * 60_000);
    expect(polledRightAfterRejoin).toBe(false);
  });
});
