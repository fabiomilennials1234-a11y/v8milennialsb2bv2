import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClienteParaAgenda } from "@/modules/analytics/lib/agenda-contatos";

const h = vi.hoisted(() => ({ data: [] as ClienteParaAgenda[] }));

vi.mock("@/modules/analytics/hooks/useAgendaContatos", () => ({
  useBuscaClientesAgenda: () => ({ data: h.data, isLoading: false, isError: false }),
  useMarcarAgendaContato: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { NovaAgendaDialog } from "./NovaAgendaDialog";

const cliente = (over: Partial<ClienteParaAgenda> = {}): ClienteParaAgenda => ({
  id: "l1",
  name: "Mercearia Santa Mônica Ltda",
  company: "Santa Mônica",
  erp_code: "1042",
  uf: "SC",
  cidade: "Florianópolis",
  representante: "Carlos",
  telefones: ["5548999991234", "554833334444"],
  ...over,
});

async function abrirBuscaCom(clientes: ClienteParaAgenda[]) {
  h.data = clientes;
  const user = userEvent.setup();
  render(<NovaAgendaDialog open onOpenChange={() => undefined} hoje="2026-11-17" />);
  await user.type(screen.getByLabelText("Cliente"), "sa");
  // A lista só aparece depois do debounce da busca.
  const opcao = await screen.findByRole("option");
  return { user, opcao };
}

describe("NovaAgendaDialog — busca de cliente", () => {
  it("o placeholder não promete busca por telefone", () => {
    h.data = [];
    render(<NovaAgendaDialog open onOpenChange={() => undefined} hoje="2026-11-17" />);
    expect(screen.getByPlaceholderText("Nome, empresa ou código do ERP")).toBeInTheDocument();
  });

  it("o código do ERP vem em evidência ANTES do nome", async () => {
    const { opcao } = await abrirBuscaCom([cliente()]);
    const texto = opcao.textContent ?? "";
    expect(texto.indexOf("1042")).toBeGreaterThanOrEqual(0);
    expect(texto.indexOf("1042")).toBeLessThan(texto.indexOf("Mercearia Santa Mônica Ltda"));
  });

  it("a linha da lista não mostra telefone", async () => {
    const { opcao } = await abrirBuscaCom([cliente()]);
    expect(within(opcao).queryByText(/99999-1234|\(48\)/)).toBeNull();
  });

  it("cliente sem código mostra o aviso no lugar, sem quebrar a lista", async () => {
    const { opcao } = await abrirBuscaCom([cliente({ erp_code: null })]);
    expect(within(opcao).getByText("s/ cód.")).toBeInTheDocument();
  });

  it("passar o mouse no cliente abre as informações dele", async () => {
    const { user, opcao } = await abrirBuscaCom([cliente()]);
    expect(screen.queryByText("Representante")).toBeNull();

    // `button` dentro de `role="option"` é apresentacional: pega direto do DOM.
    await user.hover(opcao.querySelector("button") as HTMLButtonElement);

    expect(await screen.findByText("Representante")).toBeInTheDocument();
    expect(screen.getByText("Carlos")).toBeInTheDocument();
    expect(screen.getByText("Florianópolis / SC")).toBeInTheDocument();
    expect(screen.getByText("Nome fantasia")).toBeInTheDocument();
    expect(screen.getByText("+55 (48) 99999-1234")).toBeInTheDocument();
    expect(screen.getByText("+55 (48) 3333-4444")).toBeInTheDocument();
  });
});
