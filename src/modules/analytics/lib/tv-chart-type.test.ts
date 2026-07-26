import { describe, it, expect } from "vitest";
import { resolveChartType } from "./tv-chart-type";

describe("tv-chart-type (spec §9 — tipo é escolha de composição; v1 deriva do recorte)", () => {
  it("total → number (só valor de cabeça, sem corpo)", () => {
    expect(resolveChartType("total")).toBe("number");
    expect(resolveChartType(null)).toBe("number");
    expect(resolveChartType(undefined)).toBe("number");
  });

  it("tempo → linha", () => {
    expect(resolveChartType("tempo")).toBe("line");
  });

  it("categórico → barra por padrão (donut é escolha explícita, §3.3)", () => {
    for (const r of ["closer", "sdr", "origem", "tag", "produto", "stream", "etapa", "pipeline"]) {
      expect(resolveChartType(r)).toBe("bar");
    }
  });

  it("override explícito do Composer sempre vence a derivação", () => {
    expect(resolveChartType("origem", "donut")).toBe("donut");
    expect(resolveChartType("tempo", "bar")).toBe("bar");
    expect(resolveChartType("total", "line")).toBe("line");
  });

  it("recorte desconhecido cai em number, não quebra a parede", () => {
    expect(resolveChartType("inventado")).toBe("number");
  });
});
