import { describe, it, expect } from "vitest";
import { resolveMeetingGoals, resolveSalesGoalProgress } from "@/modules/engagement/lib/goal-progress";

const goal = (type: string, target: number) => ({ type, target_value: target }) as any;
const metrics = { reunioesMarcadas: 93, reunioesComparecidas: 4 };

describe("resolveMeetingGoals", () => {
  it("meta legada 'reunioes' mede realizadas (compareceu)", () => {
    const r = resolveMeetingGoals([goal("reunioes", 40)], metrics);

    expect(r.realizadas).toEqual({ target: 40, current: 4, progress: 10 });
    expect(r.marcadas).toBeNull();
  });

  it("meta 'reunioes_marcadas' mede marcadas no período da marcação", () => {
    const r = resolveMeetingGoals([goal("reunioes_marcadas", 100)], metrics);

    expect(r.marcadas).toEqual({ target: 100, current: 93, progress: 93 });
    expect(r.realizadas).toBeNull();
  });

  it("'reunioes_realizadas' tem precedência sobre a legada quando ambas existem", () => {
    const r = resolveMeetingGoals(
      [goal("reunioes", 40), goal("reunioes_realizadas", 8)],
      metrics,
    );

    expect(r.realizadas).toEqual({ target: 8, current: 4, progress: 50 });
  });
});

/**
 * FIX-D (code review): resolveSalesGoalProgress é o mapeamento de dinheiro de maior
 * risco do #1000 (barra de meta = pódio = bônus OTE, UM número). Cobre o
 * discriminador receita×contagem e a segurança de divisão (finding #9 + R5).
 */
describe("resolveSalesGoalProgress", () => {
  it("meta de faturamento (isRevenue) → current = receita canônica", () => {
    const r = resolveSalesGoalProgress({
      goalTarget: 40000,
      goalIsRevenue: true,
      canonicalRevenue: 30000,
      canonicalSaleCount: 6,
    });
    // Usa receita, NÃO contagem — 30000/40000 = 75%.
    expect(r).toEqual({ target: 40000, current: 30000, progress: 75 });
  });

  it("meta de contagem (vendas/clientes, !isRevenue) → current = contagem canônica", () => {
    const r = resolveSalesGoalProgress({
      goalTarget: 10,
      goalIsRevenue: false,
      canonicalRevenue: 30000,
      canonicalSaleCount: 6,
    });
    // Usa contagem, NÃO receita — 6/10 = 60%.
    expect(r).toEqual({ target: 10, current: 6, progress: 60 });
  });

  it("goal=0 → progress 0, sem NaN/Infinity (division-safety)", () => {
    const rRevenue = resolveSalesGoalProgress({
      goalTarget: 0,
      goalIsRevenue: true,
      canonicalRevenue: 30000,
      canonicalSaleCount: 6,
    });
    expect(rRevenue.progress).toBe(0);
    expect(Number.isFinite(rRevenue.progress)).toBe(true);

    const rCount = resolveSalesGoalProgress({
      goalTarget: 0,
      goalIsRevenue: false,
      canonicalRevenue: 30000,
      canonicalSaleCount: 6,
    });
    expect(rCount.progress).toBe(0);
    expect(Number.isNaN(rCount.progress)).toBe(false);
  });

  it("goal negativo (defensivo) → progress 0", () => {
    const r = resolveSalesGoalProgress({
      goalTarget: -100,
      goalIsRevenue: true,
      canonicalRevenue: 30000,
      canonicalSaleCount: 6,
    });
    expect(r.progress).toBe(0);
  });

  it("progress passa de 100 quando a receita supera a meta (não satura)", () => {
    const r = resolveSalesGoalProgress({
      goalTarget: 10000,
      goalIsRevenue: true,
      canonicalRevenue: 15000,
      canonicalSaleCount: 3,
    });
    expect(r.progress).toBe(150);
  });
});
