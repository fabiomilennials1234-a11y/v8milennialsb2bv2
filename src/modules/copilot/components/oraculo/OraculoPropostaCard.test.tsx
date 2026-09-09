import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { OraculoPropostaCard } from "./OraculoPropostaCard";

const proposta = {
  id: "30000000-0000-4000-8000-000000000001",
  acao: "mover_etapa" as const,
  criterio: { tipo: "leads_parados" as const, dias: 14 },
  parametros: { pipeline_name: "Comercial", target_stage_name: "Negociação" },
  previsao: 5,
  status: "pending" as const,
};

it("mostra previsão e só confirma após clique humano", async () => {
  const confirmar = vi.fn();
  const user = userEvent.setup();
  render(<OraculoPropostaCard proposta={proposta} onConfirmar={confirmar} ocupada={false} />);

  expect(screen.getByText(/previsão: 5 leads/i)).toBeInTheDocument();
  expect(screen.getByText(/negociação/i)).toBeInTheDocument();
  expect(confirmar).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: /confirmar ação em 5 leads/i }));
  expect(confirmar).toHaveBeenCalledWith(proposta.id);
});

it("depois do clique mostra aplicados e já tratados", () => {
  render(<OraculoPropostaCard proposta={{
    ...proposta,
    status: "executed",
    resultado: { status: "sucesso", alterados: 3, ja_tratados: 2 },
  }} onConfirmar={vi.fn()} ocupada={false} />);

  expect(screen.getByText(/3 alterados/i)).toBeInTheDocument();
  expect(screen.getByText(/2 já tratados/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /confirmar/i })).not.toBeInTheDocument();
});

it("avisa quando nenhum lead continua elegível no clique", () => {
  render(<OraculoPropostaCard proposta={{
    ...proposta,
    status: "executed",
    resultado: { status: "aviso", alterados: 0, ja_tratados: 5 },
  }} onConfirmar={vi.fn()} ocupada={false} />);

  expect(screen.getByText(/nenhum lead continuava elegível/i)).toBeInTheDocument();
});
