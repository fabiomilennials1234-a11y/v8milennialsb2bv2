import { describe, it, expect } from "vitest";
import { resolveChartType, deriveStyle } from "./tv-chart-type";

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

describe("tv-chart-type #1253 — widget_style vence, deriva é o default", () => {
  it("widget_style explícito vence, incluindo os 3 novos formatos", () => {
    expect(resolveChartType("total", "ranking")).toBe("ranking");
    expect(resolveChartType("total", "progress")).toBe("progress");
    expect(resolveChartType("etapa", "funnel")).toBe("funnel");
    expect(resolveChartType("closer", "ranking")).toBe("ranking");
  });

  it("widget_style inválido/desconhecido cai na derivação (nunca erro — galeria: ausente, não exceção)", () => {
    expect(resolveChartType("closer", "zzz")).toBe("bar");
    expect(resolveChartType("total", "")).toBe("number");
    expect(resolveChartType("tempo", null)).toBe("line");
  });

  it("deriveStyle é o default puro do recorte (o resolveChartType sem escolha)", () => {
    expect(deriveStyle("total")).toBe("number");
    expect(deriveStyle("tempo")).toBe("line");
    expect(deriveStyle("closer")).toBe("bar");
    expect(deriveStyle(null)).toBe("number");
  });
});
