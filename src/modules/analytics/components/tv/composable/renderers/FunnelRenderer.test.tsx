import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FunnelRenderer } from "./FunnelRenderer";
import type { MetricSeriesPoint } from "@/modules/analytics/lib/tv-series";

// Estágios NA ORDEM DO FUNIL (não por volume).
const STAGES: MetricSeriesPoint[] = [
  { key: "booked", label: "Marcadas", value: 100 },
  { key: "held", label: "Compareceram", value: 60 },
  { key: "sold", label: "Vendido", value: 24 },
];

describe("FunnelRenderer (#1293 map §1 card #8)", () => {
  it("mostra os 3 estágios com valor", () => {
    render(<FunnelRenderer series={STAGES} formatId="integer" variant="bars" />);
    expect(screen.getByText("Marcadas")).toBeTruthy();
    expect(screen.getByText("Compareceram")).toBeTruthy();
    expect(screen.getByText("Vendido")).toBeTruthy();
    expect(screen.getByText("100")).toBeTruthy();
    expect(screen.getByText("24")).toBeTruthy();
  });

  it("TAXA entre etapas: value[i]/value[i-1] (60% e 40%), não no 1º estágio", () => {
    render(<FunnelRenderer series={STAGES} formatId="integer" variant="bars" />);
    expect(screen.getByText(/↓\s?60%/)).toBeTruthy(); // 60/100
    expect(screen.getByText(/↓\s?40%/)).toBeTruthy(); // 24/60
    // 1º estágio não tem taxa (não há anterior).
    expect(screen.queryAllByText(/↓/).length).toBe(2);
  });

  it("PRESERVA a ordem de estágio — não re-ordena por volume (funil fora de ordem não é funil)", () => {
    // Estágio do meio maior que o 1º (anomalia de dado): a ORDEM fica como veio.
    const oddOrder: MetricSeriesPoint[] = [
      { key: "a", label: "Alpha", value: 30 },
      { key: "b", label: "Bravo", value: 80 },
      { key: "c", label: "Charlie", value: 10 },
    ];
    const { container } = render(<FunnelRenderer series={oddOrder} formatId="integer" variant="bars" />);
    const labels = Array.from(container.querySelectorAll("[title]")).map((e) => e.getAttribute("title"));
    expect(labels).toEqual(["Alpha", "Bravo", "Charlie"]); // ordem de entrada, não [Bravo, Alpha, Charlie]
  });

  it("série vazia → não renderiza (null)", () => {
    const { container } = render(<FunnelRenderer series={[]} formatId="integer" />);
    expect(container.firstChild).toBeNull();
  });

  it("taxa null quando o estágio anterior é 0 (sem divisão por zero)", () => {
    const withZero: MetricSeriesPoint[] = [
      { key: "a", label: "Zero", value: 0 },
      { key: "b", label: "Um", value: 5 },
    ];
    render(<FunnelRenderer series={withZero} formatId="integer" />);
    expect(screen.queryAllByText(/↓/).length).toBe(0); // sem taxa (prev=0)
  });
});
