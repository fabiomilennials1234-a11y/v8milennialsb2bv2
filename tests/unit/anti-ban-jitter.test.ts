// @vitest-environment node
/**
 * anti-ban-jitter — inter-recipient spacing math (anti-ban Onda 0 QW3).
 *
 * Two contracts: the per-gap delay stays inside [3s, 8s), and the per-tick
 * batch sizing keeps every jittered cron worker inside its wall-clock budget
 * (fail-closed to 1 — a worker always drains at least one item per tick).
 */
import { describe, it, expect } from "vitest";

const {
  JITTER_MIN_MS,
  JITTER_MAX_MS,
  jitterDelayMs,
  maxBatchForBudget,
} = await import("../../supabase/functions/_shared/anti-ban-jitter.ts");

describe("jitterDelayMs — 3–8s bounds", () => {
  it("hits the floor at rand()=0 and stays below the ceiling at rand()→1", () => {
    expect(jitterDelayMs(() => 0)).toBe(JITTER_MIN_MS);
    expect(jitterDelayMs(() => 0.999999)).toBeLessThan(JITTER_MAX_MS);
    expect(jitterDelayMs(() => 0.5)).toBe(JITTER_MIN_MS + Math.floor(0.5 * (JITTER_MAX_MS - JITTER_MIN_MS)));
  });

  it("never leaves [JITTER_MIN_MS, JITTER_MAX_MS) with the real RNG", () => {
    for (let i = 0; i < 1000; i++) {
      const d = jitterDelayMs();
      expect(d).toBeGreaterThanOrEqual(JITTER_MIN_MS);
      expect(d).toBeLessThan(JITTER_MAX_MS);
    }
  });

  it("constants match the Onda 0 spec (3–8s)", () => {
    expect(JITTER_MIN_MS).toBe(3_000);
    expect(JITTER_MAX_MS).toBe(8_000);
  });
});

describe("maxBatchForBudget — per-tick batch sizing", () => {
  it("computes floor(budget / worst-per-item)", () => {
    expect(maxBatchForBudget(240_000, 20_000)).toBe(12);
    expect(maxBatchForBudget(120_000, 12_000)).toBe(10);
    expect(maxBatchForBudget(100_000, 30_000)).toBe(3);
  });

  it("the workers' actual budgets fit their cron ticks", () => {
    // process-outbound-dispatches: */5 cron, NO per-row lock → the whole run
    // (batch × worst-per-item) must stay under the 300s tick.
    const outboundBatch = maxBatchForBudget(240_000, 20_000);
    expect(outboundBatch * 20_000).toBeLessThanOrEqual(300_000 - 8_000);

    // process-scheduled-user-messages: 1-min tick but per-row lock makes
    // overlap safe; the binding limit is the edge wall clock (~150s).
    const scheduledBatch = maxBatchForBudget(120_000, 12_000);
    expect(scheduledBatch * 12_000).toBeLessThanOrEqual(150_000);
  });

  it("fails closed to 1 on zero/negative/garbage inputs — a worker always drains something", () => {
    expect(maxBatchForBudget(0, 10_000)).toBe(1);
    expect(maxBatchForBudget(-5, 10_000)).toBe(1);
    expect(maxBatchForBudget(10_000, 0)).toBe(1);
    expect(maxBatchForBudget(10_000, -1)).toBe(1);
    expect(maxBatchForBudget(NaN, 10_000)).toBe(1);
    expect(maxBatchForBudget(10_000, Infinity)).toBe(1);
    expect(maxBatchForBudget(5_000, 10_000)).toBe(1); // budget < one item → still 1
  });
});
