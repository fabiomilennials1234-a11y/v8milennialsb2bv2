import { describe, it, expect } from "vitest";
import {
  headValueFromMeasure,
  groupTopN,
  withShare,
  seriesState,
  ordinalColor,
  categoricalColor,
  OTHERS_LABEL,
} from "./tv-series";

const pt = (label: string, value: number) => ({ key: label, label, value });

describe("tv-series (spec §3.1/§3.3)", () => {
  describe("headValueFromMeasure — valor de cabeça sempre (§1②)", () => {
    it("escalar do motor manda quando presente", () => {
      expect(headValueFromMeasure({ value: 4000, series: null })).toBe(4000);
    });
    it("soma a série quando não há escalar (barra=soma, donut=total, linha=período)", () => {
      expect(headValueFromMeasure({ value: null, series: [pt("a", 100), pt("b", 250)] })).toBe(350);
    });
    it("empty_reason vence: sem registros → null, nunca 0 (§5.2)", () => {
      expect(headValueFromMeasure({ value: 0, series: [], empty_reason: "no_rows" })).toBeNull();
      expect(headValueFromMeasure({ value: null, series: null })).toBeNull();
    });
  });

  describe("groupTopN — máx categorias + Outros (§3.1 regra 4, §3.3)", () => {
    it("ordena desc e mantém tudo quando cabe no teto", () => {
      const out = groupTopN([pt("a", 1), pt("c", 3), pt("b", 2)], 5);
      expect(out.map((p) => p.label)).toEqual(["c", "b", "a"]);
    });
    it("colapsa o excedente num único bucket Outros", () => {
      const out = groupTopN([pt("a", 10), pt("b", 8), pt("c", 6), pt("d", 4), pt("e", 2), pt("f", 1)], 5);
      expect(out).toHaveLength(5);
      expect(out[4].label).toBe(OTHERS_LABEL);
      // Outros = soma dos que sobraram além das 4 primeiras vagas (e:2 + f:1 = 3)
      expect(out[4].value).toBe(3);
    });
    it("donut cap 5 vira 4 reais + Outros = nunca roda de 30 fatias", () => {
      const many = Array.from({ length: 30 }, (_, i) => pt(`c${i}`, 30 - i));
      const out = groupTopN(many, 5);
      expect(out).toHaveLength(5);
      expect(out[4].label).toBe(OTHERS_LABEL);
    });
    it("série vazia → vazio", () => {
      expect(groupTopN([], 5)).toEqual([]);
    });

    it("INVARIANTE: soma dos buckets exibidos == soma da série original (Outros não conta em dobro)", () => {
      // Foco do Crivo: categoria somada duas vezes é número errado na parede. O
      // valor de cabeça vem da série ORIGINAL; os buckets exibidos vêm de
      // groupTopN. Os dois têm que fechar — senão o total não bate com a soma
      // visível das fatias/barras.
      const raw = [pt("a", 9), pt("b", 7), pt("c", 5), pt("d", 3), pt("e", 2), pt("f", 1), pt("g", 4)];
      const original = raw.reduce((s, p) => s + p.value, 0);
      for (const cap of [3, 4, 5, 6, 10]) {
        const grouped = groupTopN(raw, cap);
        const shown = grouped.reduce((s, p) => s + p.value, 0);
        expect(shown).toBe(original);
      }
    });
  });

  describe("seriesState — degradação (AC)", () => {
    it("empty / single / multi", () => {
      expect(seriesState({ series: [], empty_reason: "no_rows" })).toBe("empty");
      expect(seriesState({ series: [] })).toBe("empty");
      expect(seriesState({ series: [pt("a", 1)] })).toBe("single");
      expect(seriesState({ series: [pt("a", 1), pt("b", 2)] })).toBe("multi");
    });
  });

  it("withShare calcula proporção sobre o total; total 0 → share 0", () => {
    const [a, b] = withShare([pt("a", 25), pt("b", 75)]);
    expect(a.share).toBeCloseTo(0.25);
    expect(b.share).toBeCloseTo(0.75);
    expect(withShare([pt("a", 0)])[0].share).toBe(0);
  });

  it("rampas: ordinal satura no 5º degrau; categórica cicla em 5", () => {
    expect(ordinalColor(0)).toBe("hsl(var(--metric-ramp-1))");
    expect(ordinalColor(9)).toBe("hsl(var(--metric-ramp-5))");
    expect(categoricalColor(0)).toBe("hsl(var(--chart-1))");
    expect(categoricalColor(5)).toBe("hsl(var(--chart-1))");
  });
});
