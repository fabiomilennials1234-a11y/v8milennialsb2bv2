import { describe, it, expect } from "vitest";
import { calculateMonthlyRecurring } from "@/lib/portfolio";

describe("calculateMonthlyRecurring", () => {
  it("multiplies ticket by monthly frequency based on cycle days", () => {
    const clients = [
      { avg_ticket: 500, reorder_cycle_days: 15 },  // 500 * (30/15) = 1000
      { avg_ticket: 1000, reorder_cycle_days: 60 }, // 1000 * (30/60) = 500
    ];
    expect(calculateMonthlyRecurring(clients)).toBe(1500);
  });

  it("uses default 30-day cycle when null", () => {
    const clients = [
      { avg_ticket: 600, reorder_cycle_days: null }, // 600 * (30/30) = 600
    ];
    expect(calculateMonthlyRecurring(clients)).toBe(600);
  });

  it("clamps cycle to minimum 1 day (avoids division by zero)", () => {
    const clients = [
      { avg_ticket: 100, reorder_cycle_days: 0 }, // 100 * (30/1) = 3000
    ];
    expect(calculateMonthlyRecurring(clients)).toBe(3000);
  });

  it("skips clients with null avg_ticket", () => {
    const clients = [
      { avg_ticket: null, reorder_cycle_days: 15 },
      { avg_ticket: 500, reorder_cycle_days: 30 },
    ];
    expect(calculateMonthlyRecurring(clients)).toBe(500);
  });

  it("returns 0 for empty list", () => {
    expect(calculateMonthlyRecurring([])).toBe(0);
  });

  it("handles single client with exact 30-day cycle", () => {
    const clients = [{ avg_ticket: 1000, reorder_cycle_days: 30 }];
    expect(calculateMonthlyRecurring(clients)).toBe(1000);
  });

  it("differs from naive SUM(avg_ticket) when cycles vary", () => {
    const clients = [
      { avg_ticket: 500, reorder_cycle_days: 15 },
      { avg_ticket: 1000, reorder_cycle_days: 60 },
    ];
    const naiveSum = 500 + 1000; // 1500 — wrong
    const correct = calculateMonthlyRecurring(clients); // 1500 — coincidence here
    // Different example where they diverge
    const clients2 = [
      { avg_ticket: 500, reorder_cycle_days: 10 }, // 500 * 3 = 1500
      { avg_ticket: 200, reorder_cycle_days: 60 }, // 200 * 0.5 = 100
    ];
    const naive2 = 500 + 200; // 700
    const correct2 = calculateMonthlyRecurring(clients2); // 1600
    expect(correct2).not.toBe(naive2);
    expect(correct2).toBe(1600);
  });
});
