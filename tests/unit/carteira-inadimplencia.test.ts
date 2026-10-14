/**
 * Tests for the Inadimplência projection (module G, S9, ADR-0020).
 * Pure aggregation over a client's Títulos → receita-em-risco. No React/DB.
 */
import { describe, it, expect } from "vitest";
import {
  computeInadimplencia,
  resumirInadimplencia,
} from "../../src/modules/carteira/lib/inadimplencia";
import type { Titulo } from "../../src/modules/integrations";

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

// Chamado 065e4890: o selo dizia "Inadimplente · R$ 2.220" e o card "Atrasado
// R$ 2.960" na MESMA tela. O selo contava só `status = atrasado`; o card usa a
// data como régua. O título 107317 (aberto, venceu 14/09) entrava num e não no
// outro. Uma tela, um número.
describe("computeInadimplencia — mesma régua do card (status OU data)", () => {
  const HOJE = new Date(2026, 9, 13); // 13/10/2026, fuso local

  it("título ABERTO com vencimento passado conta no selo", () => {
    const r = computeInadimplencia([{ status: "aberto", valor: 740, vencimento: "2026-09-14" }], HOJE);
    expect(r.isInadimplente).toBe(true);
    expect(r.overdueCount).toBe(1);
    expect(r.receitaEmRisco).toBe(740);
  });

  it("título PAGO com vencimento passado NÃO conta", () => {
    const r = computeInadimplencia([{ status: "pago", valor: 740, vencimento: "2026-09-14" }], HOJE);
    expect(r.isInadimplente).toBe(false);
    expect(r.receitaEmRisco).toBe(0);
  });

  it("vence hoje ainda não está atrasado", () => {
    const r = computeInadimplencia([{ status: "aberto", valor: 740, vencimento: "2026-10-13" }], HOJE);
    expect(r.isInadimplente).toBe(false);
  });

  it("aberto sem vencimento não vira atrasado por omissão", () => {
    const r = computeInadimplencia([{ status: "aberto", valor: 740, vencimento: null }], HOJE);
    expect(r.isInadimplente).toBe(false);
  });

  it("🔴 selo e card dão o MESMO número — o caso do cliente 14535", () => {
    const base = { order_id: null, client_id: "c", pago_em: null };
    const titulos: Titulo[] = [
      { ...base, id: "107316", status: "atrasado", valor: 740, vencimento: "2026-09-07" },
      { ...base, id: "107317", status: "aberto", valor: 740, vencimento: "2026-09-14" },
      { ...base, id: "108322", status: "atrasado", valor: 740, vencimento: "2026-09-29" },
      { ...base, id: "108323", status: "atrasado", valor: 740, vencimento: "2026-10-06" },
      { ...base, id: "109462", status: "aberto", valor: 740, vencimento: "2026-10-29" },
      { ...base, id: "109463", status: "aberto", valor: 740, vencimento: "2026-11-05" },
    ];

    const selo = computeInadimplencia(titulos, HOJE);
    const card = resumirInadimplencia(titulos, HOJE);

    expect(selo.receitaEmRisco).toBe(card.atrasado);
    expect(selo.overdueCount).toBe(card.quantidadeAtrasada);
    expect(selo.receitaEmRisco).toBe(2960);
  });
});
