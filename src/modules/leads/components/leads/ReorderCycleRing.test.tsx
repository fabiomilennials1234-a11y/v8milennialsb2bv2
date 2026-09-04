/**
 * O anel é a única superfície onde o ciclo aparece na lista, e o CTO pediu o
 * texto DENTRO do círculo — não ao lado, não em tooltip. Estes testes prendem
 * as três frases e o rótulo acessível; a matemática está em `reorder-cycle.test`.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ReorderCycleRing } from "./ReorderCycleRing";
import { calcularCicloDeRecompra } from "../../lib/reorder-cycle";

const DIA = 86_400_000;
const HOJE = Date.parse("2026-09-04T12:00:00Z");
const diasAtras = (n: number) => new Date(HOJE - n * DIA).toISOString();

describe("ReorderCycleRing", () => {
  it("sem compra escreve 'Sem compra' no miolo", () => {
    render(<ReorderCycleRing ciclo={calcularCicloDeRecompra([], HOJE)} />);
    expect(screen.getByText("Sem")).toBeInTheDocument();
    expect(screen.getByText("compra")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAccessibleName("Sem compra registrada");
  });

  it("com uma compra escreve 'Sem informações'", () => {
    render(<ReorderCycleRing ciclo={calcularCicloDeRecompra([diasAtras(10)], HOJE)} />);
    expect(screen.getByText("informações")).toBeInTheDocument();
  });

  it("com ciclo escreve a média em dias", () => {
    render(
      <ReorderCycleRing ciclo={calcularCicloDeRecompra([diasAtras(90), diasAtras(45)], HOJE)} />,
    );
    expect(screen.getByText("45D")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAccessibleName(/Recompra a cada 45 dias/);
  });

  it("na época de recompra o arco vira verde", () => {
    const { container } = render(
      <ReorderCycleRing ciclo={calcularCicloDeRecompra([diasAtras(113), diasAtras(53)], HOJE)} />,
    );
    expect(container.querySelector(".stroke-success")).toBeTruthy();
  });

  it("fora da época o arco fica no accent, não no verde", () => {
    // Ciclo de 90 dias, última compra há 30 → faltam 60, longe da janela de 7.
    const { container } = render(
      <ReorderCycleRing ciclo={calcularCicloDeRecompra([diasAtras(120), diasAtras(30)], HOJE)} />,
    );
    expect(container.querySelector(".stroke-primary")).toBeTruthy();
    expect(container.querySelector(".stroke-success")).toBeFalsy();
  });

  it("atrasado diz em quantos dias passou do ponto", () => {
    render(
      <ReorderCycleRing ciclo={calcularCicloDeRecompra([diasAtras(230), diasAtras(200)], HOJE)} />,
    );
    expect(screen.getByRole("img")).toHaveAccessibleName(/atrasado em 170 dias/);
  });
});
