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

describe("NovaBuscaDialog: Instagram cobrado por seguidor varrido, no tamanho que o cliente escolhe (ADR-0047)", () => {
  const abrirInstagram = async (saldos: { normal: number; meta: number }) => {
    const user = userEvent.setup();
    montar(saldos);
    await user.click(screen.getByRole("button", { name: /Instagram/ }));
    await user.type(await screen.findByLabelText("URL da conta"), "https://www.instagram.com/clinicaodontovida/");
    return user;
  };
  const digitar = async (user: ReturnType<typeof userEvent.setup>, n: string) => {
    const campo = screen.getByLabelText("Seguidores a analisar");
    await user.clear(campo);
    await user.type(campo, n);
  };

  it("sugere 50, mostra o preço do que foi escolhido e o risco", async () => {
    await abrirInstagram({ normal: 0, meta: 100 });
    const bloco = screen.getByTestId("preco-instagram");
    expect(screen.getByLabelText("Seguidores a analisar")).toHaveValue(50);
    expect(bloco).toHaveTextContent(/Esta busca custa 50 créditos Meta/);
    expect(bloco.textContent?.replace(/\s/g, " ")).toContain("R$ 7,50");
    expect(bloco).toHaveTextContent(/Saldo depois:\s*50/);
    expect(bloco).toHaveTextContent(/Cada seguidor analisado gasta 1 crédito, venha contato ou não/);
    expect(bloco).toHaveTextContent(/metade dos créditos gastos volta/);
  });

  it("o preço acompanha o que se digita, e envia exatamente esse número", async () => {
    const user = await abrirInstagram({ normal: 0, meta: 500 });
    await digitar(user, "200");
    expect(screen.getByTestId("preco-instagram").textContent?.replace(/\s/g, " ")).toContain("R$ 30,00");
    await user.click(screen.getByRole("button", { name: /Iniciar busca/ }));
    expect(criar).toHaveBeenCalledTimes(1);
    expect(criar.mock.calls[0][0]).toEqual({ alvo: { fonte: "instagram", url: "https://www.instagram.com/clinicaodontovida/" }, creditos: 200 });
  });

  it("recusa menos de 10, mais de 1.000 e mais que o saldo", async () => {
    const user = await abrirInstagram({ normal: 0, meta: 300 });
    const iniciar = () => screen.getByRole("button", { name: /Iniciar busca/ });
    for (const n of ["9", "1001", "301", "0"]) {
      await digitar(user, n);
      expect(iniciar(), `valor ${n}`).toBeDisabled();
    }
    await digitar(user, "10");
    expect(iniciar()).toBeEnabled();
    await digitar(user, "300");
    expect(iniciar()).toBeEnabled();
  });

  it("com menos de 10 créditos Meta, não deixa iniciar e oferece comprar", async () => {
    await abrirInstagram({ normal: 500, meta: 9 });
    expect(screen.getByRole("button", { name: /Iniciar busca/ })).toBeDisabled();
    expect(screen.getByTestId("preco-instagram")).toHaveTextContent(/até o seu saldo \(9\)/);
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
