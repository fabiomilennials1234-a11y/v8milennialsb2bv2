import { describe, expect, it } from "vitest";
import {
  UNDATED_MONTH_KEY,
  monthLabelOf,
  partitionClosedOutcomes,
  type ClosedGroupingAccessors,
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

describe("monthLabelOf", () => {
  it("rotula o mês por extenso com inicial maiúscula", () => {
    expect(monthLabelOf("2026-01")).toBe("Janeiro de 2026");
    expect(monthLabelOf(UNDATED_MONTH_KEY)).toBe("Sem data");
  });
});
