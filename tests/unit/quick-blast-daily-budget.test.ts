// @vitest-environment node
/**
 * dailyBlastBudget — Organization-wide daily ceiling on Mass Send volume (ADR-0003).
 *
 * Supersedes the per-blast cap *framing* of ADR-0002: the guardrail is now an
 * Org-wide ceiling on how many Leads may be messaged via Mass Send per calendar
 * day, summed across every blast (manual Quick Blasts + Blast Plan lots). The
 * per-blast `quick_blast_max_leads` stays as an optional clamp WITHIN the daily
 * budget.
 *
 * MUST fail closed: missing/invalid `daily_blast_budget` → default ceiling
 * (never unlimited); a ledger READ error must NOT open the gate to unlimited —
 * it resolves to ZERO remaining (block the day) rather than risk a banned number.
 */

import { describe, it, expect } from "vitest";

const {
  resolveDailyBudget,
  computeDailyClamp,
  saoPauloUsageDate,
  DEFAULT_DAILY_BUDGET,
} = await import("../../supabase/functions/_shared/quick-blast/daily-budget.ts");

describe("resolveDailyBudget — fail-closed ceiling", () => {
  it("uses the default when config is null", () => {
    expect(resolveDailyBudget(null)).toBe(DEFAULT_DAILY_BUDGET);
  });

  it("uses the default when config is undefined", () => {
    expect(resolveDailyBudget(undefined)).toBe(DEFAULT_DAILY_BUDGET);
  });

  it("honors a positive integer ceiling", () => {
    expect(resolveDailyBudget(500)).toBe(500);
  });

  it("fails closed to default on zero (never unlimited)", () => {
    expect(resolveDailyBudget(0)).toBe(DEFAULT_DAILY_BUDGET);
  });

  it("fails closed to default on negative values", () => {
    expect(resolveDailyBudget(-10)).toBe(DEFAULT_DAILY_BUDGET);
  });

  it("fails closed to default on NaN / Infinity", () => {
    expect(resolveDailyBudget(Number.NaN)).toBe(DEFAULT_DAILY_BUDGET);
    expect(resolveDailyBudget(Number.POSITIVE_INFINITY)).toBe(DEFAULT_DAILY_BUDGET);
  });

  it("floors fractional ceilings to an integer", () => {
    expect(resolveDailyBudget(99.9)).toBe(99);
  });

  it("default is 200", () => {
    expect(DEFAULT_DAILY_BUDGET).toBe(200);
  });
});

describe("computeDailyClamp — remaining + effective cap", () => {
  it("remaining = budget - usage", () => {
    const r = computeDailyClamp({ dailyBudget: 200, usedToday: 50 });
    expect(r.remaining).toBe(150);
  });

  it("clamps remaining at zero (never negative) when usage exceeds budget", () => {
    const r = computeDailyClamp({ dailyBudget: 200, usedToday: 250 });
    expect(r.remaining).toBe(0);
  });

  it("effective cap is the min of perBlastMax, dailyBudget and remaining", () => {
    // perBlastMax 80 is the tightest → wins.
    expect(computeDailyClamp({ dailyBudget: 200, usedToday: 0, perBlastMax: 80 }).effectiveCap).toBe(80);
    // remaining 30 is the tightest → wins.
    expect(computeDailyClamp({ dailyBudget: 200, usedToday: 170, perBlastMax: 80 }).effectiveCap).toBe(30);
    // dailyBudget 50 is the tightest → wins (no perBlastMax).
    expect(computeDailyClamp({ dailyBudget: 50, usedToday: 0 }).effectiveCap).toBe(50);
  });

  it("ignores a non-positive perBlastMax (treated as unset)", () => {
    expect(computeDailyClamp({ dailyBudget: 200, usedToday: 0, perBlastMax: 0 }).effectiveCap).toBe(200);
    expect(computeDailyClamp({ dailyBudget: 200, usedToday: 0, perBlastMax: -5 }).effectiveCap).toBe(200);
  });

  it("zero remaining → effectiveCap 0 and overBudget flag", () => {
    const r = computeDailyClamp({ dailyBudget: 200, usedToday: 200 });
    expect(r.remaining).toBe(0);
    expect(r.effectiveCap).toBe(0);
    expect(r.overBudget).toBe(true);
  });

  it("non-zero remaining → overBudget false", () => {
    expect(computeDailyClamp({ dailyBudget: 200, usedToday: 1 }).overBudget).toBe(false);
  });
});

describe("saoPauloUsageDate — calendar day in business tz", () => {
  it("derives the America/Sao_Paulo calendar date (UTC-3) for a late-UTC instant", () => {
    // 2026-06-06T02:00:00Z is still 2026-06-05 23:00 in Sao Paulo.
    expect(saoPauloUsageDate(new Date("2026-06-06T02:00:00Z"))).toBe("2026-06-05");
  });

  it("rolls to the next day once Sao Paulo passes midnight", () => {
    // 2026-06-06T03:00:00Z is 2026-06-06 00:00 in Sao Paulo.
    expect(saoPauloUsageDate(new Date("2026-06-06T03:00:00Z"))).toBe("2026-06-06");
  });
});
