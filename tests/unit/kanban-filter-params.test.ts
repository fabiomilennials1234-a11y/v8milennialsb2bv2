import { describe, it, expect } from "vitest";
import {
  priorityBandToRating,
  calorBandToBounds,
  CONFIRMACAO_OVERDUE_EXCLUDE_STATUS_KEYS,
} from "@/modules/pipelines/lib/kanbanFilterParams";

// These bounds drive the server-side count. If they drift from the legacy
// client predicates, the column badge silently disagrees with the cards.
describe("priorityBandToRating — parity with legacy client predicate", () => {
  it("high → rating >= 8", () => {
    expect(priorityBandToRating("high")).toEqual({ ratingMin: 8, ratingMax: null });
  });
  it("medium → rating in [5,7]", () => {
    expect(priorityBandToRating("medium")).toEqual({ ratingMin: 5, ratingMax: 7 });
  });
  it("low → rating <= 4 (rating < 5)", () => {
    expect(priorityBandToRating("low")).toEqual({ ratingMin: null, ratingMax: 4 });
  });
  it("all / unknown → no bounds", () => {
    expect(priorityBandToRating("all")).toEqual({ ratingMin: null, ratingMax: null });
    expect(priorityBandToRating("")).toEqual({ ratingMin: null, ratingMax: null });
  });

  // Boundary cases: every integer rating lands in exactly one band.
  it("partitions ratings 0..10 into exactly one band", () => {
    const inBand = (r: number, { ratingMin, ratingMax }: ReturnType<typeof priorityBandToRating>) =>
      (ratingMin === null || r >= ratingMin) && (ratingMax === null || r <= ratingMax);
    for (let r = 0; r <= 10; r++) {
      const hits = (["high", "medium", "low"] as const).filter((b) =>
        inBand(r, priorityBandToRating(b))
      );
      expect(hits).toHaveLength(1);
    }
  });
});

describe("calorBandToBounds — parity with legacy client predicate", () => {
  it("hot → calor >= 7", () => {
    expect(calorBandToBounds("hot")).toEqual({ calorMin: 7, calorMax: null });
  });
  it("warm → calor in [4,6]", () => {
    expect(calorBandToBounds("warm")).toEqual({ calorMin: 4, calorMax: 6 });
  });
  it("cold → calor <= 3 (calor < 4)", () => {
    expect(calorBandToBounds("cold")).toEqual({ calorMin: null, calorMax: 3 });
  });
  it("all / unknown → no bounds", () => {
    expect(calorBandToBounds("all")).toEqual({ calorMin: null, calorMax: null });
  });

  it("partitions calor 0..10 into exactly one band (default 5 = warm)", () => {
    const inBand = (c: number, { calorMin, calorMax }: ReturnType<typeof calorBandToBounds>) =>
      (calorMin === null || c >= calorMin) && (calorMax === null || c <= calorMax);
    for (let c = 0; c <= 10; c++) {
      const hits = (["hot", "warm", "cold"] as const).filter((b) =>
        inBand(c, calorBandToBounds(b))
      );
      expect(hits).toHaveLength(1);
    }
    // default calor (5) must fall in "warm" — matches `item.calor ?? 5`
    expect(inBand(5, calorBandToBounds("warm"))).toBe(true);
  });
});

describe("status-key constants", () => {
  it("confirmação overdue exclusions", () => {
    expect([...CONFIRMACAO_OVERDUE_EXCLUDE_STATUS_KEYS]).toEqual(["compareceu", "perdido"]);
  });
});
