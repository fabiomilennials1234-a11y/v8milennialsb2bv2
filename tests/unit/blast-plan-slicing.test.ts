// @vitest-environment node
/**
 * Blast Plan slicing — pure lot math (ADR-0003, #707).
 *
 * A Blast Plan freezes an audience at creation and drains it over consecutive
 * days, each day's lot bounded by the shared Daily Blast Budget. The two pure
 * pieces under test:
 *
 *   - planLotCount  : how many daily lots an audience of N needs at a daily cap.
 *   - selectLotSlice: given a lot's PENDING recipients + the remaining budget for
 *     today, decide how many go out now and how many defer to the next day
 *     (elastic duration — a lot that can't fully fit pushes its remainder).
 *
 * No IO. Mirrors the dep-injection + pure-core split of #704/#706.
 */

import { describe, it, expect } from "vitest";

const { planLotCount, selectLotSlice, addDaysIso } = await import(
  "../../supabase/functions/_shared/quick-blast/plan-slicing.ts"
);

describe("planLotCount — slicing an audience into daily lots", () => {
  it("returns 1 when the audience fits a single day's budget", () => {
    expect(planLotCount(80, 200)).toBe(1);
    expect(planLotCount(200, 200)).toBe(1);
  });

  it("ceils into consecutive daily lots when the audience exceeds the budget", () => {
    expect(planLotCount(201, 200)).toBe(2);
    expect(planLotCount(450, 200)).toBe(3);
    expect(planLotCount(600, 200)).toBe(3);
  });

  it("returns 0 for an empty audience", () => {
    expect(planLotCount(0, 200)).toBe(0);
  });

  it("fails closed to a 1-per-day cap when the daily budget is non-positive", () => {
    // A zero/garbage budget must not produce Infinity lots or divide-by-zero;
    // it collapses to one recipient per day (never unlimited, never crash).
    expect(planLotCount(5, 0)).toBe(5);
    expect(planLotCount(3, -10)).toBe(3);
  });
});

describe("selectLotSlice — budget-bounded release with deferral", () => {
  it("sends the whole lot when it fits the remaining budget", () => {
    const out = selectLotSlice({ pendingCount: 30, remainingBudget: 200 });
    expect(out.toSend).toBe(30);
    expect(out.deferred).toBe(0);
    expect(out.lotFullyDrained).toBe(true);
  });

  it("sends only the remaining budget and defers the rest (elastic duration)", () => {
    // 120 pending but only 80 budget left today → 80 out, 40 pushed to tomorrow.
    const out = selectLotSlice({ pendingCount: 120, remainingBudget: 80 });
    expect(out.toSend).toBe(80);
    expect(out.deferred).toBe(40);
    expect(out.lotFullyDrained).toBe(false);
  });

  it("defers the entire lot when zero budget remains today", () => {
    const out = selectLotSlice({ pendingCount: 50, remainingBudget: 0 });
    expect(out.toSend).toBe(0);
    expect(out.deferred).toBe(50);
    expect(out.lotFullyDrained).toBe(false);
  });

  it("is a no-op (drained) when the lot has no pending recipients", () => {
    const out = selectLotSlice({ pendingCount: 0, remainingBudget: 200 });
    expect(out.toSend).toBe(0);
    expect(out.deferred).toBe(0);
    expect(out.lotFullyDrained).toBe(true);
  });

  it("never sends a negative count when budget is negative (fail-closed)", () => {
    const out = selectLotSlice({ pendingCount: 10, remainingBudget: -5 });
    expect(out.toSend).toBe(0);
    expect(out.deferred).toBe(10);
    expect(out.lotFullyDrained).toBe(false);
  });
});

describe("addDaysIso — Sao Paulo calendar date arithmetic", () => {
  it("advances a YYYY-MM-DD date by N days", () => {
    expect(addDaysIso("2026-06-05", 1)).toBe("2026-06-06");
    expect(addDaysIso("2026-06-05", 3)).toBe("2026-06-08");
  });

  it("rolls over month + year boundaries", () => {
    expect(addDaysIso("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("is timezone-stable (no DST drift) — pure date math, not instant math", () => {
    // Brazil has no DST since 2019, but the function must not depend on the
    // server's own zone. Adding 0 days returns the same date verbatim.
    expect(addDaysIso("2026-06-05", 0)).toBe("2026-06-05");
  });
});
