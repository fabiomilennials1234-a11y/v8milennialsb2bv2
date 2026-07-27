import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressRenderer } from "./ProgressRenderer";

describe("ProgressRenderer (#1253 §2.1 #5 — degradação honesta mode b)", () => {
  it("SEM alvo (caso do S1) → não desenha gauge (null): degrada para Número", () => {
    const { container } = render(<ProgressRenderer value={86468} target={null} formatId="currency_brl" variant="tube" />);
    expect(container.firstChild).toBeNull();
  });

  it("alvo undefined ou <=0 também degrada (não inventa meta)", () => {
    expect(render(<ProgressRenderer value={100} target={undefined} formatId="integer" />).container.firstChild).toBeNull();
    expect(render(<ProgressRenderer value={100} target={0} formatId="integer" />).container.firstChild).toBeNull();
  });

  it("valor ausente → null (não desenha progresso de nada)", () => {
    const { container } = render(<ProgressRenderer value={null} target={1000} formatId="integer" />);
    expect(container.firstChild).toBeNull();
  });

  it("COM alvo (futuro, motor serve meta) → desenha gauge com % e valor/alvo", () => {
    render(<ProgressRenderer value={75} target={100} formatId="integer" variant="bar" />);
    // Caption combina %, valor e alvo num nó ("75% · 100").
    expect(screen.getByText(/75%/)).toBeTruthy();
    expect(screen.getByText(/·\s?100/)).toBeTruthy();
  });

  it("% acima de 100 mostra o real no rótulo (fill capa em 100 visual)", () => {
    render(<ProgressRenderer value={150} target={100} formatId="integer" variant="radial" />);
    expect(screen.getByText("150%")).toBeTruthy();
  });
});
