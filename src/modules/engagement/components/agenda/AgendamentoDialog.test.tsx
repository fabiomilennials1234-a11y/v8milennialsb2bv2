import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  criar: vi.fn(),
  busca: { data: [] as Array<Record<string, unknown>>, isLoading: false, isError: false },
  semeado: { data: undefined as Record<string, unknown> | null | undefined, isLoading: false, isError: false },
  semeadoId: [] as Array<string | null>,
}));

vi.mock("@/modules/engagement/hooks/useMeetings", () => ({
  useCreateMeeting: () => ({ mutateAsync: mocks.criar, isPending: false }),
}));
vi.mock("@/modules/engagement/hooks/useBuscaClientes", () => ({
  useBuscaClientes: () => mocks.busca,
  useClienteParaAgenda: (id: string | null) => {
    mocks.semeadoId.push(id);
    return id ? mocks.semeado : { data: undefined, isLoading: false, isError: false };
  },
}));
vi.mock("@/modules/identity", () => ({
  useTeamMembers: () => ({ data: [{ id: "tm1", name: "Ana" }, { id: "tm2", name: "Bia" }] }),
}));
vi.mock("@/modules/pipelines/funis-da-agenda", () => ({
  usePipelines: () => ({ data: [{ id: "p1", name: "Vendas", is_active: true }] }),
  isPipelineVisible: () => true,
  sortPipelinesForNavigation: <T,>(rows: T[]) => rows,
}));
vi.mock("@/shared/hooks/useDebounce", () => ({ useDebounce: <T,>(v: T) => v }));

import { AgendamentoDialog } from "./AgendamentoDialog";

const CLIENTE = { id: "l1", name: "Padaria Sol", company: "Sol Ltda", erp_code: "123", uf: "SC", cidade: "Itajaí", representante: "Carlos", telefones: ["48999990000"], contatos: [] };
const CARLOS = { id: "ph1", nome: "Carlos - Compras", telefone: "5548999990000", principal: true };
const ANA = { id: "ph2", nome: "Ana - Financeiro", telefone: "5548988880000", principal: false };

function abrir(props: Partial<React.ComponentProps<typeof AgendamentoDialog>> = {}) {
  const onOpenChange = vi.fn();
  render(<AgendamentoDialog open onOpenChange={onOpenChange} {...props} />);
  return { onOpenChange };
}

async function escolherCliente() {
  fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "padaria" } });
  fireEvent.click(await screen.findByRole("button", { name: /Padaria Sol/ }));
}

describe("AgendamentoDialog", () => {
  beforeEach(() => {
    mocks.criar.mockReset().mockResolvedValue({ id: "m1" });
    mocks.busca = { data: [CLIENTE], isLoading: false, isError: false };
    mocks.semeado = { data: undefined, isLoading: false, isError: false };
    mocks.semeadoId = [];
  });

  it("reunião: sem cliente o botão fica travado", () => {
    abrir();
    expect(screen.getByRole("button", { name: "Marcar reunião" })).toBeDisabled();
  });

  it("reunião: grava título, lead, funil e participantes", async () => {
    const { onOpenChange } = abrir({ initialPipelineId: "p1" });
    await escolherCliente();
    fireEvent.click(screen.getByRole("button", { name: "Ana" }));
    fireEvent.change(screen.getByLabelText(/Observação/), { target: { value: "levar amostra" } });
    fireEvent.click(screen.getByRole("button", { name: "Marcar reunião" }));

    await waitFor(() => expect(mocks.criar).toHaveBeenCalledTimes(1));
    expect(mocks.criar.mock.calls[0][0]).toMatchObject({
      title: "Reunião - Padaria Sol",
      description: "levar amostra",
      lead_id: "l1",
      pipeline_id: "p1",
      event_type: "meeting",
      all_day: false,
      participant_ids: ["tm1"],
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("reunião: o fim é a duração depois do início", async () => {
    abrir();
    await escolherCliente();
    fireEvent.change(screen.getByLabelText("Hora"), { target: { value: "14:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Marcar reunião" }));
    await waitFor(() => expect(mocks.criar).toHaveBeenCalled());
    const { start_at, end_at } = mocks.criar.mock.calls[0][0] as { start_at: string; end_at: string };
    expect(new Date(end_at).getTime() - new Date(start_at).getTime()).toBe(60 * 60_000);
    expect(new Date(start_at).getHours()).toBe(14);
    expect(new Date(start_at).getMinutes()).toBe(30);
  });

  it("aberto pelo card do lead já vem com o cliente", () => {
    abrir({ initialLeadId: "l9", initialLeadName: "Mercado Norte" });
    // O nome aparece no chip do cliente e na frase do rodapé.
    expect(screen.getAllByText("Mercado Norte").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Marcar reunião" })).toBeEnabled();
  });

  it("com um tipo só, o seletor de tipo não aparece", () => {
    abrir({ tipos: ["reuniao"] });
    expect(screen.queryByRole("radiogroup", { name: "Tipo de agendamento" })).toBeNull();
  });

  it("próximo contato: chama onMarcarContato com o dia e sem criar reunião", async () => {
    const onMarcarContato = vi.fn().mockResolvedValue(undefined);
    const { onOpenChange } = abrir({ tipos: ["reuniao", "contato"], tipoInicial: "contato", onMarcarContato });
    await escolherCliente();
    expect(screen.queryByLabelText("Hora")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Salvar agenda" }));
    await waitFor(() => expect(onMarcarContato).toHaveBeenCalledTimes(1));
    expect(onMarcarContato.mock.calls[0][0]).toMatchObject({ leadId: "l1", observacao: null });
    expect(mocks.criar).not.toHaveBeenCalled();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("'contato' sem onMarcarContato não é oferecido", () => {
    abrir({ tipos: ["reuniao", "contato"] });
    expect(screen.queryByRole("radiogroup", { name: "Tipo de agendamento" })).toBeNull();
  });
});

describe("AgendamentoDialog — contato do cliente", () => {
  beforeEach(() => {
    mocks.criar.mockReset().mockResolvedValue({ id: "m1" });
    mocks.busca = { data: [CLIENTE], isLoading: false, isError: false };
    mocks.semeado = { data: undefined, isLoading: false, isError: false };
    mocks.semeadoId = [];
  });

  it("com 2+ contatos pede o contato e trava o salvar até escolher", async () => {
    mocks.busca = { data: [{ ...CLIENTE, contatos: [CARLOS, ANA] }], isLoading: false, isError: false };
    abrir();
    await escolherCliente();

    const grupo = screen.getByRole("radiogroup", { name: "Contato" });
    expect(screen.getByRole("radio", { name: /Carlos - Compras/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: /Ana - Financeiro/ })).toHaveAttribute("aria-checked", "false");
    expect(grupo).toBeInTheDocument();
    // Sem pré-seleção: a escolha é do vendedor.
    expect(screen.getByRole("button", { name: "Marcar reunião" })).toBeDisabled();
    expect(screen.getByText("Escolha com quem é: este cliente tem 2 contatos.")).toBeInTheDocument();
  });

  it("reunião grava o contato escolhido em lead_phone_id", async () => {
    mocks.busca = { data: [{ ...CLIENTE, contatos: [CARLOS, ANA] }], isLoading: false, isError: false };
    abrir();
    await escolherCliente();
    fireEvent.click(screen.getByRole("radio", { name: /Ana - Financeiro/ }));
    expect(screen.getByRole("radio", { name: /Ana - Financeiro/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Marcar reunião" }));

    await waitFor(() => expect(mocks.criar).toHaveBeenCalledTimes(1));
    expect(mocks.criar.mock.calls[0][0]).toMatchObject({ lead_id: "l1", lead_phone_id: "ph2" });
  });

  it("próximo contato manda o contato escolhido para onMarcarContato", async () => {
    mocks.busca = { data: [{ ...CLIENTE, contatos: [CARLOS, ANA] }], isLoading: false, isError: false };
    const onMarcarContato = vi.fn().mockResolvedValue(undefined);
    abrir({ tipos: ["reuniao", "contato"], tipoInicial: "contato", onMarcarContato });
    await escolherCliente();
    expect(screen.getByRole("button", { name: "Salvar agenda" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /Carlos - Compras/ }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar agenda" }));

    await waitFor(() => expect(onMarcarContato).toHaveBeenCalledTimes(1));
    expect(onMarcarContato.mock.calls[0][0]).toMatchObject({ leadId: "l1", leadPhoneId: "ph1" });
  });

  it("com um contato só não pergunta e grava ele", async () => {
    mocks.busca = { data: [{ ...CLIENTE, contatos: [CARLOS] }], isLoading: false, isError: false };
    abrir();
    await escolherCliente();
    expect(screen.queryByRole("radiogroup", { name: "Contato" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Marcar reunião" }));
    await waitFor(() => expect(mocks.criar).toHaveBeenCalledTimes(1));
    expect(mocks.criar.mock.calls[0][0]).toMatchObject({ lead_phone_id: "ph1" });
  });

  it("sem contato nenhum não manda lead_phone_id", async () => {
    abrir();
    await escolherCliente();
    expect(screen.queryByRole("radiogroup", { name: "Contato" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Marcar reunião" }));
    await waitFor(() => expect(mocks.criar).toHaveBeenCalledTimes(1));
    expect(mocks.criar.mock.calls[0][0]).not.toHaveProperty("lead_phone_id");
  });

  it("trocar de cliente zera o contato escolhido", async () => {
    const outro = { ...CLIENTE, id: "l2", name: "Padaria Lua", contatos: [{ ...CARLOS, id: "ph3" }, { ...ANA, id: "ph4" }] };
    mocks.busca = { data: [{ ...CLIENTE, contatos: [CARLOS, ANA] }, outro], isLoading: false, isError: false };
    abrir();
    await escolherCliente();
    fireEvent.click(screen.getByRole("radio", { name: /Ana - Financeiro/ }));
    fireEvent.click(screen.getByRole("button", { name: /Padaria Lua/ }));
    expect(screen.getByRole("radio", { name: /Ana - Financeiro/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("button", { name: "Marcar reunião" })).toBeDisabled();
  });

  it("aberto pelo card do lead: busca os contatos e espera por eles", () => {
    mocks.semeado = { data: undefined, isLoading: true, isError: false };
    const { rerender } = render(<AgendamentoDialog open onOpenChange={vi.fn()} initialLeadId="l9" initialLeadName="Mercado Norte" />);
    expect(mocks.semeadoId).toContain("l9");
    expect(screen.getByText(/Carregando os contatos do cliente/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar reunião" })).toBeDisabled();

    mocks.semeado = { data: { ...CLIENTE, id: "l9", name: "Mercado Norte", contatos: [CARLOS, ANA] }, isLoading: false, isError: false };
    rerender(<AgendamentoDialog open onOpenChange={vi.fn()} initialLeadId="l9" initialLeadName="Mercado Norte" />);
    expect(screen.getByRole("radiogroup", { name: "Contato" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar reunião" })).toBeDisabled();
  });

  it("aberto pelo card do lead: falha ao ler contatos avisa e não trava", () => {
    mocks.semeado = { data: undefined, isLoading: false, isError: true };
    abrir({ initialLeadId: "l9", initialLeadName: "Mercado Norte" });
    expect(screen.getByRole("status")).toHaveTextContent("Não deu para carregar os contatos deste cliente");
    expect(screen.getByRole("button", { name: "Marcar reunião" })).toBeEnabled();
  });
});
