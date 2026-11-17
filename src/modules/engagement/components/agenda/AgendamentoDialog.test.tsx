import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  criar: vi.fn(),
  busca: { data: [] as Array<Record<string, unknown>>, isLoading: false, isError: false },
}));

vi.mock("@/modules/engagement/hooks/useMeetings", () => ({
  useCreateMeeting: () => ({ mutateAsync: mocks.criar, isPending: false }),
}));
vi.mock("@/modules/engagement/hooks/useBuscaClientes", () => ({
  useBuscaClientes: () => mocks.busca,
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

const CLIENTE = { id: "l1", name: "Padaria Sol", company: "Sol Ltda", erp_code: "123", uf: "SC", cidade: "Itajaí", representante: "Carlos", telefones: ["48999990000"] };

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
