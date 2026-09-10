import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { DealCardTimeline } from "@/modules/leads/components/deal-card/DealCardTimeline";
it("mostra o percurso completo entre funis com etapa, data e autor", () => {
  render(<DealCardTimeline movimentacoes={[{
    id: "move", de: "Venda ganha", para: "Implantação", funilDe: "Vendas", funilPara: "Pós-venda",
    paraChave: "open", quando: "2026-09-10T12:00:00Z", autor: "Vendedor", origem: "manual",
  }]} />);
  expect(screen.getByText("Vendas · Venda ganha")).toBeInTheDocument();
  expect(screen.getByText("Pós-venda · Implantação")).toBeInTheDocument();
  expect(screen.getByText(/Vendedor · 10\/09\/2026/)).toBeInTheDocument();
});
