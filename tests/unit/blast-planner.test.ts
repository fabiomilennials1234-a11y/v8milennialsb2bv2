// @vitest-environment node
/**
 * BlastPlanner — pure multi-number lot planning (ADR-0015).
 *
 * Generalizes plan-slicing.ts from one org-wide daily budget to a set of
 * selected WhatsApp numbers, each with its own per-day cap. Daily capacity is
 * the sum of the selected numbers' caps; an audience larger than one day's
 * capacity is sliced into consecutive daily lots, each day distributing the
 * day's send round-robin across the numbers, never exceeding any number's cap.
 *
 * No IO, no clock dependence (the start date is passed in). Fail-closed:
 * no numbers / non-positive caps yield a safe empty plan, never a divide-by-zero.
 */

import { describe, it, expect } from "vitest";

const { planBlast } = await import(
  "../../supabase/functions/_shared/quick-blast/blast-planner.ts"
);

describe("planBlast — audience that fits a single day", () => {
  it("emits one lot, isPlan=false, when recipients fit the combined daily capacity", () => {
    const result = planBlast({
      totalRecipients: 100,
      numbers: [
        { id: "a", cap: 80 },
        { id: "b", cap: 80 },
      ],
      startDateIso: "2026-06-25",
    });

    expect(result.isPlan).toBe(false);
    expect(result.dayCount).toBe(1);
    expect(result.dailyCapacity).toBe(160);
    expect(result.lots).toHaveLength(1);
    expect(result.lots[0].dateIso).toBe("2026-06-25");
    expect(result.lots[0].dayTotal).toBe(100);
  });
});

describe("planBlast — audience that exceeds one day's capacity", () => {
  it("slices into ceil(total / Σcaps) consecutive daily lots, isPlan=true", () => {
    const result = planBlast({
      totalRecipients: 240,
      numbers: [
        { id: "a", cap: 80 },
        { id: "b", cap: 80 },
      ],
      startDateIso: "2026-06-25",
    });

    expect(result.dailyCapacity).toBe(160);
    expect(result.isPlan).toBe(true);
    expect(result.dayCount).toBe(2); // ceil(240/160)
    expect(result.lots).toHaveLength(2);
    expect(result.lots.map((l) => l.dateIso)).toEqual([
      "2026-06-25",
      "2026-06-26",
    ]);
    // capacity fills earlier days; remainder on the last
    expect(result.lots[0].dayTotal).toBe(160);
    expect(result.lots[1].dayTotal).toBe(80);
  });
});

describe("planBlast — per-day distribution across numbers", () => {
  const share = (lot: { perNumber: { id: string; count: number }[] }, id: string) =>
    lot.perNumber.find((p) => p.id === id)?.count ?? 0;

  it("never lets a number exceed its own cap (round-robin spills to others)", () => {
    const result = planBlast({
      totalRecipients: 60,
      numbers: [
        { id: "a", cap: 80 },
        { id: "b", cap: 20 },
      ],
      startDateIso: "2026-06-25",
    });

    const lot = result.lots[0];
    expect(lot.dayTotal).toBe(60);
    expect(share(lot, "b")).toBeLessThanOrEqual(20); // capped
    expect(share(lot, "a")).toBeLessThanOrEqual(80);
    expect(share(lot, "a") + share(lot, "b")).toBe(60);
    // b fills to its cap, a absorbs the rest
    expect(share(lot, "b")).toBe(20);
    expect(share(lot, "a")).toBe(40);
  });

  it("splits evenly between equal-cap numbers (difference ≤ 1)", () => {
    const result = planBlast({
      totalRecipients: 81,
      numbers: [
        { id: "a", cap: 80 },
        { id: "b", cap: 80 },
      ],
      startDateIso: "2026-06-25",
    });

    const lot = result.lots[0];
    expect(lot.dayTotal).toBe(81);
    expect(Math.abs(share(lot, "a") - share(lot, "b"))).toBeLessThanOrEqual(1);
    expect(share(lot, "a") + share(lot, "b")).toBe(81);
  });

  it("puts only the remainder on the last day (not a forced full lot)", () => {
    const result = planBlast({
      totalRecipients: 200,
      numbers: [
        { id: "a", cap: 80 },
        { id: "b", cap: 80 },
      ],
      startDateIso: "2026-06-25",
    });

    expect(result.dayCount).toBe(2); // ceil(200/160)
    expect(result.lots[0].dayTotal).toBe(160);
    expect(result.lots[1].dayTotal).toBe(40); // remainder, not 160
    expect(share(result.lots[1], "a")).toBe(20);
    expect(share(result.lots[1], "b")).toBe(20);
  });
});

describe("planBlast — fail-closed edge cases", () => {
  it("returns an empty plan for an empty audience", () => {
    const result = planBlast({
      totalRecipients: 0,
      numbers: [{ id: "a", cap: 80 }],
      startDateIso: "2026-06-25",
    });

    expect(result.lots).toEqual([]);
    expect(result.dayCount).toBe(0);
    expect(result.isPlan).toBe(false);
  });

  it("returns an empty plan when no numbers are selected (no divide-by-zero)", () => {
    const result = planBlast({
      totalRecipients: 100,
      numbers: [],
      startDateIso: "2026-06-25",
    });

    expect(result.dailyCapacity).toBe(0);
    expect(result.lots).toEqual([]);
    expect(result.dayCount).toBe(0);
    expect(result.isPlan).toBe(false);
  });

  it("treats non-positive caps as zero capacity (fail-closed, never Infinity)", () => {
    const result = planBlast({
      totalRecipients: 100,
      numbers: [
        { id: "a", cap: 0 },
        { id: "b", cap: -5 },
      ],
      startDateIso: "2026-06-25",
    });

    expect(result.dailyCapacity).toBe(0);
    expect(result.lots).toEqual([]);
    expect(result.dayCount).toBe(0);
  });
});
