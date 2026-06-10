import { describe, it, expect } from "vitest";
import { resolveMeetingGoals } from "@/modules/engagement/lib/goal-progress";

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
