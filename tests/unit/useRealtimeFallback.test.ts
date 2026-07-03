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
  FALLBACK_POLL_INTERVAL_MS,
  JOINED_BACKSTOP_POLL_INTERVAL_MS,
} from "@/modules/communication/hooks/chat/useRealtimeFallback";

const T0 = 1_000_000;
const CLOSED = false; // circuit breaker closed (healthy)

describe("shouldFallback", () => {
  it("returns false when channel is joined regardless of duration", () => {
    expect(shouldFallback("joined", CLOSED, T0, T0)).toBe(false);
    expect(shouldFallback("joined", CLOSED, T0, T0 + 10 * 60_000)).toBe(false);
  });

  it("polls immediately when the circuit breaker is open", () => {
    expect(shouldFallback("reconnecting", true, T0, T0)).toBe(true);
    expect(shouldFallback("polling", CLOSED, T0, T0)).toBe(true);
  });

  it("returns false during grace window for non-healthy states", () => {
    const justUnder = T0 + FALLBACK_THRESHOLD_MS - 1;
    expect(shouldFallback("offline", CLOSED, T0, justUnder)).toBe(false);
    expect(shouldFallback("reconnecting", CLOSED, T0, justUnder)).toBe(false);
    expect(shouldFallback("joining", CLOSED, T0, justUnder)).toBe(false);
    expect(shouldFallback("unknown", CLOSED, T0, justUnder)).toBe(false);
  });

  it("returns true once threshold elapsed for non-healthy states", () => {
    const exactly = T0 + FALLBACK_THRESHOLD_MS;
    expect(shouldFallback("offline", CLOSED, T0, exactly)).toBe(true);
    expect(shouldFallback("reconnecting", CLOSED, T0, exactly)).toBe(true);
    expect(shouldFallback("joining", CLOSED, T0, exactly)).toBe(true);
    expect(shouldFallback("unknown", CLOSED, T0, exactly)).toBe(true);
  });

  it("respects custom threshold", () => {
    expect(shouldFallback("offline", CLOSED, T0, T0 + 5_000, 10_000)).toBe(false);
    expect(shouldFallback("offline", CLOSED, T0, T0 + 10_000, 10_000)).toBe(true);
  });

  it("flips back to false the instant the channel rejoins (caller resets lastTransitionAt)", () => {
    const offlineLong = shouldFallback("offline", CLOSED, T0, T0 + 10 * 60_000);
    expect(offlineLong).toBe(true);

    const rejoinedAt = T0 + 10 * 60_000 + 500;
    const polledRightAfterRejoin = shouldFallback("joined", CLOSED, rejoinedAt, rejoinedAt + 5 * 60_000);
    expect(polledRightAfterRejoin).toBe(false);
  });
});

describe("backstop reconciliation interval", () => {
  // Guarda a intenção do fix: mesmo no caminho saudável (canal "joined", sem
  // fallback), as queries do chat fazem um refetch de segurança periódico pra
  // reconciliar eventos que o apply_rls derrubou. Este intervalo NUNCA pode ser
  // mais agressivo que o poll de fallback (senão o caminho saudável pesaria mais
  // que o degradado), e precisa ser um valor positivo real.
  it("is a positive value, slower than the unhealthy fallback poll", () => {
    expect(JOINED_BACKSTOP_POLL_INTERVAL_MS).toBeGreaterThan(0);
    expect(JOINED_BACKSTOP_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(
      FALLBACK_POLL_INTERVAL_MS,
    );
  });
});
