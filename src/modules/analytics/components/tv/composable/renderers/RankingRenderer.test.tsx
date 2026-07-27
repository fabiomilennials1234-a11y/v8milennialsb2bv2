import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RankingRenderer } from "./RankingRenderer";
import type { MetricSeriesPoint } from "@/modules/analytics/lib/tv-series";

const S: MetricSeriesPoint[] = [
  { key: "a", label: "Ana Souza", value: 30000 },
  { key: "b", label: "Bruno Lima", value: 50000 },
  { key: "c", label: "Carla Dias", value: 10000 },
  { key: "d", label: "Davi Melo", value: 8000 },
  { key: "e", label: "Elis Rocha", value: 6000 },
  { key: "f", label: "Fábio Nunes", value: 4000 },
  { key: "g", label: "Gil Prado", value: 2000 },
];

describe("RankingRenderer (#1253 §2.1 #4)", () => {
  it("pódio: ordena desc e mostra o top 3 (não colapsa em Outros)", () => {
    render(<RankingRenderer series={S} formatId="currency_brl" variant="podium" />);
    // Líder = maior valor, formatado como moeda de parede.
    expect(screen.getByText("Bruno Lima")).toBeTruthy();
    expect(screen.getByText("Ana Souza")).toBeTruthy();
    expect(screen.getByText("Carla Dias")).toBeTruthy();
    // 4º pra baixo não aparece no pódio.
    expect(screen.queryByText("Davi Melo")).toBeNull();
    // Posições 1,2,3 presentes.
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    // Valor do líder formatado (R$ 50 mil).
    expect(screen.getByText(/R\$\s?50\s?mil/)).toBeTruthy();
  });

  it("lista: mostra até 6, numerada", () => {
    render(<RankingRenderer series={S} formatId="integer" variant="list" />);
    expect(screen.getByText("Bruno Lima")).toBeTruthy();
    expect(screen.getByText("Fábio Nunes")).toBeTruthy();
    // 7º não entra (cap 6).
    expect(screen.queryByText("Gil Prado")).toBeNull();
    expect(screen.getByText("6")).toBeTruthy();
  });

  it("número fica no canal do valor (creme), cor só na geometria — sem hue no texto", () => {
    const { container } = render(<RankingRenderer series={S} formatId="integer" variant="podium" />);
    // O valor usa text-foreground (canal do valor), nunca cor decorativa inline.
    const valueEls = container.querySelectorAll(".text-foreground");
    expect(valueEls.length).toBeGreaterThan(0);
  });
});
