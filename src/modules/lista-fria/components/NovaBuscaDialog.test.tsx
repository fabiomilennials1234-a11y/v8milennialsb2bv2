import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { NovaBuscaDialog } from "./NovaBuscaDialog";

// A criação da busca vai ao banco; aqui só importa o que a tela mostra.
vi.mock("../hooks/useListaFriaMutacoes", () => ({
  useCriarBusca: () => ({ mutate: vi.fn(), isPending: false }),
}));

function montar(saldos = { normal: 160, meta: 10 }) {
  render(<NovaBuscaDialog aberto onFechar={() => {}} saldos={saldos} />);
}

describe("NovaBuscaDialog: onde comprar créditos", () => {
  it('mostra o "+" ao lado dos saldos, na escolha da fonte, e ele abre os pacotes', async () => {
    const user = userEvent.setup();
    montar();
    expect(screen.getByText(/160 créditos/)).toBeInTheDocument();
    expect(screen.getByText(/10 créditos Meta/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Comprar créditos" }));
    expect(await screen.findByRole("button", { name: /^Google \+:/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Meta Max:/ })).toBeInTheDocument();
  });

  it("sem saldo, o aviso do formulário oferece comprar", async () => {
    const user = userEvent.setup();
    montar({ normal: 0, meta: 0 });
    await user.click(screen.getByRole("button", { name: /Google Maps/ }));

    expect(await screen.findByText(/Precisa de mais\?/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Comprar créditos" })).toBeInTheDocument();
  });
});
