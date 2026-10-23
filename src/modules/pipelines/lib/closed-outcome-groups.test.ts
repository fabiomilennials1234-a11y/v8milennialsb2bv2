import { describe, expect, it } from "vitest";
import {
  UNDATED_MONTH_KEY,
  monthLabelOf,
  partitionClosedOutcomes,
  type ClosedGroupingAccessors,
  type ClosedMonthSummary,
} from "./closed-outcome-groups";

interface Card {
  id: string;
  outcome?: "won" | "lost" | null;
  closedAt?: string | null;
  value?: number | null;
}

const accessors: ClosedGroupingAccessors<Card> = {
  outcomeOf: (c) => c.outcome,
  closedAtOf: (c) => c.closedAt,
  amountOf: (c) => c.value,
};

// Datas no fuso LOCAL, como o operador as vê — o teste não depende do TZ da máquina.
const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();

describe("partitionClosedOutcomes", () => {
  it("deixa abertos fora do agrupamento, na ordem em que vieram", () => {
    const { open, closed } = partitionClosedOutcomes(
      [{ id: "a" }, { id: "g", outcome: "won", closedAt: local(2026, 9, 1) }, { id: "b", outcome: null }],
      accessors,
    );
    expect(open.map((c) => c.id)).toEqual(["a", "b"]);
    expect(closed.map((g) => g.outcome)).toEqual(["won"]);
  });

  it("separa ganhos de perdidos, ganhos primeiro, e omite grupo vazio", () => {
    const { closed } = partitionClosedOutcomes(
      [
        { id: "p", outcome: "lost", closedAt: local(2026, 9, 2) },
        { id: "g", outcome: "won", closedAt: local(2026, 9, 1) },
      ],
      accessors,
    );
    expect(closed.map((g) => [g.outcome, g.items.map((c) => c.id)])).toEqual([
      ["won", ["g"]],
      ["lost", ["p"]],
    ]);
    expect(partitionClosedOutcomes([{ id: "x" }], accessors).closed).toEqual([]);
  });

  it("agrupa por mês do desfecho, mês mais recente primeiro, card mais recente primeiro", () => {
    const { closed } = partitionClosedOutcomes(
      [
        { id: "ago-1", outcome: "won", closedAt: local(2026, 8, 3) },
        { id: "set-1", outcome: "won", closedAt: local(2026, 9, 2) },
        { id: "set-2", outcome: "won", closedAt: local(2026, 9, 20) },
        { id: "jul-1", outcome: "won", closedAt: local(2026, 7, 15) },
      ],
      accessors,
    );
    const months = closed[0].months;
    expect(months.map((m) => m.key)).toEqual(["2026-09", "2026-08", "2026-07"]);
    expect(months[0].items.map((c) => c.id)).toEqual(["set-2", "set-1"]);
    expect(months[0].label).toBe("Setembro de 2026");
  });

  it("usa o fuso local na virada do mês", () => {
    const { closed } = partitionClosedOutcomes(
      [{ id: "fim-de-agosto", outcome: "won", closedAt: local(2026, 8, 31, 23) }],
      accessors,
    );
    expect(closed[0].months[0].key).toBe("2026-08");
  });

  it("separa o mesmo mês de anos diferentes", () => {
    const { closed } = partitionClosedOutcomes(
      [
        { id: "2025", outcome: "lost", closedAt: local(2025, 9, 10) },
        { id: "2026", outcome: "lost", closedAt: local(2026, 9, 10) },
      ],
      accessors,
    );
    expect(closed[0].months.map((m) => m.key)).toEqual(["2026-09", "2025-09"]);
  });

  it("põe data ausente ou inválida em 'Sem data', por último", () => {
    const { closed } = partitionClosedOutcomes(
      [
        { id: "sem", outcome: "won", closedAt: null },
        { id: "lixo", outcome: "won", closedAt: "não é data" },
        { id: "set", outcome: "won", closedAt: local(2026, 9, 1) },
      ],
      accessors,
    );
    const months = closed[0].months;
    expect(months.map((m) => m.key)).toEqual(["2026-09", UNDATED_MONTH_KEY]);
    expect(months[1].label).toBe("Sem data");
    expect(months[1].items.map((c) => c.id)).toEqual(["sem", "lixo"]);
  });

  it("soma só valores conhecidos; sem nenhum valor o total é null", () => {
    const { closed } = partitionClosedOutcomes(
      [
        { id: "a", outcome: "won", closedAt: local(2026, 9, 1), value: 1000 },
        { id: "b", outcome: "won", closedAt: local(2026, 9, 2), value: null },
        { id: "c", outcome: "won", closedAt: local(2026, 8, 2), value: 250 },
        { id: "d", outcome: "lost", closedAt: local(2026, 8, 2) },
      ],
      accessors,
    );
    expect(closed[0].total).toBe(1250);
    expect(closed[0].months.map((m) => m.total)).toEqual([1000, 250]);
    expect(closed[1].total).toBeNull();
  });

  it("sem acessor de valor, total é null", () => {
    const { closed } = partitionClosedOutcomes(
      [{ id: "a", outcome: "won", closedAt: local(2026, 9, 1), value: 10 }],
      { outcomeOf: accessors.outcomeOf, closedAtOf: accessors.closedAtOf },
    );
    expect(closed[0].total).toBeNull();
  });
});

/**
 * Chamado 172ef046 — a pilha contava só os 20 cards carregados. O cenário é o
 * da Café Jurerê (Envase, coluna Vendido, 20/10/2026): a 1ª página trouxe 1
 * ganho de agosto, 8 de setembro e 11 de outubro; a etapa tem 10, 69 e 25.
 */
describe("partitionClosedOutcomes — com o resumo do servidor", () => {
  const loadedWon = (): Card[] => [
    { id: "ago-0", outcome: "won", closedAt: local(2026, 8, 20), value: 1000 },
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `set-${i}`,
      outcome: "won" as const,
      closedAt: local(2026, 9, 2 + i),
      value: 500,
    })),
    ...Array.from({ length: 11 }, (_, i) => ({
      id: `out-${i}`,
      outcome: "won" as const,
      closedAt: local(2026, 10, 1 + i),
      value: 100,
    })),
  ];

  const resumoWon: ClosedMonthSummary[] = [
    { outcome: "won", monthKey: "2026-08", count: 10, total: 25123.48 },
    { outcome: "won", monthKey: "2026-09", count: 69, total: 411501.3 },
    { outcome: "won", monthKey: "2026-10", count: 25, total: 91084.14 },
  ];

  it("K1 — contagem e valor do grupo e do mês vêm da etapa inteira, não dos 20 carregados", () => {
    const cards = loadedWon();
    expect(cards).toHaveLength(20);

    const { closed } = partitionClosedOutcomes(cards, accessors, resumoWon);
    const won = closed[0];

    expect(won.outcome).toBe("won");
    expect(won.exact).toBe(true);
    expect(won.count).toBe(104);
    expect(won.total).toBeCloseTo(527708.92, 2);
    // Os cards continuam sendo só os carregados: o resumo não inventa card.
    expect(won.items).toHaveLength(20);

    const setembro = won.months.find((m) => m.key === "2026-09");
    expect(setembro?.count).toBe(69);
    expect(setembro?.total).toBeCloseTo(411501.3, 2);
    expect(setembro?.items).toHaveLength(8);
    expect(won.months.map((m) => m.key)).toEqual(["2026-10", "2026-09", "2026-08"]);
  });

  it("mês que só o servidor conhece aparece com a contagem e sem card", () => {
    const { closed } = partitionClosedOutcomes(
      [{ id: "out", outcome: "won", closedAt: local(2026, 10, 3), value: 10 }],
      accessors,
      [
        { outcome: "won", monthKey: "2026-10", count: 1, total: 10 },
        { outcome: "won", monthKey: "2026-07", count: 3, total: 900 },
      ],
    );
    const julho = closed[0].months.find((m) => m.key === "2026-07");
    expect(julho).toMatchObject({ count: 3, total: 900, items: [], label: "Julho de 2026" });
    expect(closed[0].count).toBe(4);
  });

  it("grupo que só o servidor conhece aparece mesmo sem card carregado", () => {
    const { open, closed } = partitionClosedOutcomes(
      [{ id: "aberto" }],
      accessors,
      [{ outcome: "lost", monthKey: "2026-09", count: 34, total: 38498 }],
    );
    expect(open.map((c) => c.id)).toEqual(["aberto"]);
    expect(closed.map((g) => [g.outcome, g.count, g.items.length])).toEqual([["lost", 34, 0]]);
  });

  it("card carregado num mês que o resumo ainda não tem (resumo velho) não some", () => {
    const { closed } = partitionClosedOutcomes(
      [
        { id: "a", outcome: "won", closedAt: local(2026, 10, 3), value: 10 },
        { id: "b", outcome: "won", closedAt: local(2026, 10, 4), value: 20 },
      ],
      accessors,
      [{ outcome: "won", monthKey: "2026-10", count: 1, total: 10 }],
    );
    // O carregado é prova de que o mês tem pelo menos 2: vale o maior.
    expect(closed[0].months[0]).toMatchObject({ key: "2026-10", count: 2, total: 30 });
    expect(closed[0].count).toBe(2);
  });

  it("sem resumo o comportamento é o de antes: conta e soma o carregado, sem ser exato", () => {
    const { closed } = partitionClosedOutcomes(loadedWon(), accessors);
    const won = closed[0];
    expect(won.exact).toBe(false);
    expect(won.count).toBe(20);
    expect(won.months.find((m) => m.key === "2026-09")?.count).toBe(8);
    expect(won.months.find((m) => m.key === "2026-09")?.total).toBe(4000);
  });
});

describe("monthLabelOf", () => {
  it("rotula o mês por extenso com inicial maiúscula", () => {
    expect(monthLabelOf("2026-01")).toBe("Janeiro de 2026");
    expect(monthLabelOf(UNDATED_MONTH_KEY)).toBe("Sem data");
  });
});
