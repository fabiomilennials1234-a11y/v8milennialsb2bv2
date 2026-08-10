import { describe, it, expect } from "vitest";
import { buildMetricSample } from "./metrics-studio-sample";
import {
  METRIC_BY_ID,
  STUDIO_METRICS,
  formatMetricValue,
  type StudioMetric,
} from "./metrics-studio-catalog";

const metric = (id: string): StudioMetric => {
  const found = METRIC_BY_ID.get(id);
  if (!found) throw new Error(`métrica ${id} não existe no catálogo`);
  return found;
};

describe("metrics-studio-catalog", () => {
  it("não tem id duplicado", () => {
    const ids = STUDIO_METRICS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("toda métrica oferece pelo menos o cartão de número", () => {
    STUDIO_METRICS.forEach((m) => {
      expect(m.charts.length).toBeGreaterThan(0);
      expect(m.charts[0]).toBe("number");
    });
  });

  it("formata cada unidade sem vazar número cru", () => {
    expect(formatMetricValue(48000, "currency")).toContain("R$");
    expect(formatMetricValue(34.25, "percent")).toContain("%");
    expect(formatMetricValue(125, "duration")).toBe("2m 5s");
    expect(formatMetricValue(1.8, "ratio")).toBe("1,80");
  });
});

describe("buildMetricSample", () => {
  it("é determinístico para o mesmo par (métrica, período)", () => {
    const a = buildMetricSample(metric("receita"), "month");
    const b = buildMetricSample(metric("receita"), "month");
    expect(a).toEqual(b);
  });

  it("muda quando o período muda", () => {
    const mes = buildMetricSample(metric("receita"), "month");
    const semana = buildMetricSample(metric("receita"), "week");
    expect(mes.value).not.toBe(semana.value);
  });

  it("respeita a invariante OHLC em todos os buckets", () => {
    STUDIO_METRICS.forEach((m) => {
      buildMetricSample(m, "month").series.forEach((p) => {
        expect(p.high).toBeGreaterThanOrEqual(Math.max(p.open, p.close));
        expect(p.low).toBeLessThanOrEqual(Math.min(p.open, p.close));
        expect(p.low).toBeGreaterThanOrEqual(0);
      });
    });
  });

  it("soma contagens e nivela percentuais", () => {
    const contagem = buildMetricSample(metric("leads_criados"), "month");
    const soma = contagem.series.reduce((acc, p) => acc + p.value, 0);
    expect(contagem.value).toBe(soma);

    const taxa = buildMetricSample(metric("taxa_conversao"), "month");
    expect(taxa.value).toBe(taxa.series[taxa.series.length - 1].close);
  });

  it("devolve fatias ordenadas que somam o valor do período", () => {
    const sample = buildMetricSample(metric("receita_por_origem"), "month");
    expect(sample.slices.length).toBeGreaterThan(1);

    const ordenado = [...sample.slices].sort((a, b) => b.value - a.value);
    expect(sample.slices).toEqual(ordenado);

    const soma = sample.slices.reduce((acc, s) => acc + s.value, 0);
    // Arredondamento por fatia — tolerância de 1 unidade por fatia.
    expect(Math.abs(soma - sample.value)).toBeLessThanOrEqual(sample.slices.length);
  });
});
