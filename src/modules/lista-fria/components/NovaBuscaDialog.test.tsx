import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NovaBuscaDialog } from "./NovaBuscaDialog";

// A criação da busca vai ao banco; aqui só importa o que a tela mostra e o que ela manda.
const { criar } = vi.hoisted(() => ({ criar: vi.fn() }));
vi.mock("../hooks/useListaFriaMutacoes", () => ({
  useCriarBusca: () => ({ mutate: criar, isPending: false }),
}));

function montar(saldos = { normal: 160, meta: 10 }) {
  render(<NovaBuscaDialog aberto onFechar={() => {}} saldos={saldos} />);
}

beforeEach(() => criar.mockClear());

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

describe("NovaBuscaDialog: Instagram cobrado por seguidor varrido (ADR-0046)", () => {
  const abrirInstagram = async (saldos: { normal: number; meta: number }) => {
    const user = userEvent.setup();
    montar(saldos);
    await user.click(screen.getByRole("button", { name: /Instagram/ }));
    await user.type(await screen.findByLabelText("URL da conta"), "https://www.instagram.com/clinicaodontovida/");
    return user;
  };

  it("mostra o preço fixo da busca e o risco, e não pede quantos créditos usar", async () => {
    await abrirInstagram({ normal: 0, meta: 100 });
    const preco = screen.getByTestId("preco-instagram");
    expect(preco).toHaveTextContent(/Esta busca custa 50 créditos Meta/);
    expect(preco.textContent?.replace(/\s/g, " ")).toContain("R$ 7,50");
    expect(preco).toHaveTextContent(/Cada seguidor analisado gasta 1 crédito, venha contato ou não/);
    expect(preco).toHaveTextContent(/metade dos créditos gastos volta/);
    expect(preco).toHaveTextContent(/Saldo depois:\s*50/);
    expect(screen.queryByLabelText(/Créditos Meta para esta busca/)).not.toBeInTheDocument();
  });

  it("envia sempre a reserva de 50, nunca um número digitado", async () => {
    const user = await abrirInstagram({ normal: 0, meta: 100 });
    await user.click(screen.getByRole("button", { name: /Iniciar busca/ }));
    expect(criar).toHaveBeenCalledTimes(1);
    expect(criar.mock.calls[0][0]).toEqual({ alvo: { fonte: "instagram", url: "https://www.instagram.com/clinicaodontovida/" }, creditos: 50 });
  });

  it("com menos de 50 créditos Meta, não deixa iniciar e oferece comprar", async () => {
    await abrirInstagram({ normal: 500, meta: 49 });
    expect(screen.getByRole("button", { name: /Iniciar busca/ })).toBeDisabled();
    expect(screen.getByTestId("preco-instagram")).toHaveTextContent(/Você tem 49 créditos Meta; a busca precisa de 50/);
    expect(screen.getByRole("button", { name: "Comprar créditos" })).toBeInTheDocument();
  });

  it("Maps continua com o campo de créditos", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole("button", { name: /Google Maps/ }));
    expect(await screen.findByLabelText("Créditos para esta busca")).toBeInTheDocument();
    expect(screen.queryByTestId("preco-instagram")).not.toBeInTheDocument();
  });
});
