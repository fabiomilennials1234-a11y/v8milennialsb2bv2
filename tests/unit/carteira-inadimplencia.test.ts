/**
 * Tests for the Inadimplência projection (module G, S9, ADR-0020).
 * Pure aggregation over a client's Títulos → receita-em-risco. No React/DB.
 */
import { describe, it, expect } from "vitest";
import { computeInadimplencia } from "../../src/modules/carteira/lib/inadimplencia";

describe("computeInadimplencia", () => {
  it("is not inadimplente when there are no overdue títulos", () => {
    const r = computeInadimplencia([
      { status: "aberto", valor: 100 },
      { status: "pago", valor: 50 },
    ]);
    expect(r.isInadimplente).toBe(false);
    expect(r.overdueCount).toBe(0);
    expect(r.receitaEmRisco).toBe(0);
  });

  it("counts and sums only the atrasado títulos (receita-em-risco)", () => {
    const r = computeInadimplencia([
      { status: "atrasado", valor: 100 },
      { status: "atrasado", valor: 250 },
      { status: "aberto", valor: 99 },
      { status: "pago", valor: 500 },
    ]);
    expect(r.isInadimplente).toBe(true);
    expect(r.overdueCount).toBe(2);
    expect(r.receitaEmRisco).toBe(350);
  });

  it("treats a null valor as zero", () => {
    const r = computeInadimplencia([{ status: "atrasado", valor: null }]);
    expect(r.isInadimplente).toBe(true);
    expect(r.overdueCount).toBe(1);
    expect(r.receitaEmRisco).toBe(0);
  });

  it("is all zeros for an empty list", () => {
    const r = computeInadimplencia([]);
    expect(r.isInadimplente).toBe(false);
    expect(r.overdueCount).toBe(0);
    expect(r.receitaEmRisco).toBe(0);
  });
});
