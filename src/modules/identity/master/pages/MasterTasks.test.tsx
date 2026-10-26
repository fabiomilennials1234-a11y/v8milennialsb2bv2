import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import MasterTasks from "./MasterTasks";

const mocks = vi.hoisted(() => ({ user: 0, full: true, error: false, save: vi.fn(), move: vi.fn(), remove: vi.fn(), query: vi.fn(), notify: vi.fn() }));
const owners = ["Gabriel", "Marcelo", "Lucas"].map((name, index) => ({
  name, id: `00000000-0000-4000-8000-00000000000${index + 1}`, userId: `user-${index}`,
}));
const tasks = owners.map((owner, index) => ({
  id: `task-${index}`, owner_master_user_id: owner.id, title: `Trabalho de ${owner.name}`, description: "Contexto da tarefa",
  due_date: "2026-10-30", estimated_minutes: 150,
  status: index === 1 ? "fazendo" : "a_fazer", created_at: "2026-10-26T12:00:00Z", updated_at: "2026-10-26T12:00:00Z", completed_at: null,
}));
vi.mock("../hooks/useMasterAuth", () => ({ useMasterAuth: () => ({
  masterUser: { id: owners[mocks.user].id, user_id: owners[mocks.user].userId }, isFullMaster: mocks.full, isLoading: false,
}) }));
vi.mock("../hooks/useMasterTasks", () => ({
  useMasterTaskOwners: () => ({ data: owners, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() }),
  useMasterTasks: (ownerId: string) => {
    mocks.query(ownerId);
    return { data: tasks.filter(task => task.owner_master_user_id === ownerId), isLoading: false, isError: mocks.error, isFetching: false, refetch: vi.fn() };
  },
  useMasterTaskMutations: () => ({
    save: { mutate: mocks.save, isPending: false }, move: { mutate: mocks.move, isPending: false }, remove: { mutate: mocks.remove, isPending: false },
  }),
}));
vi.mock("../components/MasterPageHeader", () => ({ MasterPageHeader: ({ title, actions }: { title: string; actions: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header> }));
vi.mock("@/shared/errors", () => ({ notifyError: (...args: unknown[]) => mocks.notify(...args) }));

beforeEach(() => {
  cleanup(); vi.resetAllMocks(); mocks.user = 0; mocks.full = true; mocks.error = false;
});
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, value: () => false });
});
afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  Reflect.deleteProperty(HTMLElement.prototype, "hasPointerCapture");
});

describe("quadro pessoal compartilhado dos masters", () => {
  it.each([0, 1, 2])("abre nas tarefas do usuário conectado %i", index => {
    mocks.user = index;
    render(<MasterTasks />);
    expect(screen.getByRole("combobox", { name: "Tarefas de" })).toHaveTextContent(`${owners[index].name} (você)`);
    expect(screen.getByText(`Trabalho de ${owners[index].name}`)).toBeInTheDocument();
    expect(screen.getByText("Minhas tarefas")).toBeInTheDocument();
    for (let other = 0; other < 3; other++) if (other !== index) expect(screen.queryByText(`Trabalho de ${owners[other].name}`)).not.toBeInTheDocument();
  });

  it("troca o quadro e os contadores; reentrar retorna ao próprio usuário", async () => {
    const view = render(<MasterTasks />);
    await userEvent.click(screen.getByRole("combobox", { name: "Tarefas de" }));
    await userEvent.click(screen.getByRole("option", { name: "Marcelo" }));
    expect(screen.getByText("Trabalho de Marcelo")).toBeInTheDocument();
    expect(screen.queryByText("Trabalho de Gabriel")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Fazendo, 1 item" })).toBeInTheDocument();
    view.unmount(); render(<MasterTasks />);
    expect(screen.getByRole("combobox", { name: "Tarefas de" })).toHaveTextContent("Gabriel (você)");
  });

  it("troca de conta descarta a seleção do usuário anterior", async () => {
    const view = render(<MasterTasks />);
    mocks.user = 2; view.rerender(<MasterTasks />);
    expect(screen.getByRole("combobox", { name: "Tarefas de" })).toHaveTextContent("Lucas (você)");
    expect(screen.queryByText("Trabalho de Gabriel")).not.toBeInTheDocument();
  });

  it("cria tarefa para o quadro selecionado e permite escolher outro responsável", async () => {
    render(<MasterTasks />);
    await userEvent.click(screen.getByRole("combobox", { name: "Tarefas de" }));
    await userEvent.click(screen.getByRole("option", { name: "Marcelo" }));
    await userEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: "Responsável" })).toHaveTextContent("Marcelo");
    await userEvent.type(within(dialog).getByLabelText("Título"), "Revisar implantação");
    await userEvent.type(within(dialog).getByLabelText("Data limite"), "2026-10-30");
    await userEvent.type(within(dialog).getByLabelText("Horas"), "2");
    await userEvent.type(within(dialog).getByLabelText("Minutos"), "30");
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Responsável" }));
    await userEvent.click(screen.getByRole("option", { name: "Lucas" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Criar tarefa" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ task: undefined, input: {
      title: "Revisar implantação", due_date: "2026-10-30", estimated_minutes: 150, description: "", status: "a_fazer", owner_master_user_id: owners[2].id,
    } }, expect.any(Object)));
  });

  it("edita o status pela gaveta sem precisar arrastar e preserva conteúdo em falha", async () => {
    mocks.save.mockImplementation((_value, callbacks) => callbacks.onError(new Error("Falha simulada")));
    render(<MasterTasks />);
    await userEvent.click(screen.getByText("Trabalho de Gabriel"));
    await userEvent.click(screen.getByRole("combobox", { name: "Status" }));
    await userEvent.click(screen.getByRole("option", { name: "Feito" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ status: "feito" }) }), expect.any(Object));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Título")).toHaveValue("Trabalho de Gabriel");
    expect(mocks.notify).toHaveBeenCalled();
  });

  it("distingue falha de carga de um quadro vazio", () => {
    mocks.error = true; render(<MasterTasks />);
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar");
    expect(screen.queryByText("Nenhuma tarefa a fazer.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nova tarefa" })).toBeDisabled();
  });

  it("pega a tarefa de outro master sem mudar o status ou perder a descrição", async () => {
    mocks.save.mockImplementation((_value, callbacks) => callbacks.onSuccess());
    render(<MasterTasks />);
    await userEvent.click(screen.getByRole("combobox", { name: "Tarefas de" }));
    await userEvent.click(screen.getByRole("option", { name: "Marcelo" }));
    await userEvent.click(screen.getByText("Trabalho de Marcelo"));
    await userEvent.click(screen.getByRole("button", { name: "Pegar para mim" }));
    expect(mocks.save).toHaveBeenCalledWith({ task: tasks[1], input: expect.objectContaining({
      owner_master_user_id: owners[0].id, status: "fazendo", description: tasks[1].description, due_date: tasks[1].due_date, estimated_minutes: tasks[1].estimated_minutes,
    }) }, expect.any(Object));
    expect(screen.getByRole("combobox", { name: "Tarefas de" })).toHaveTextContent("Gabriel (você)");
  });

  it("encaminha uma tarefa para outro master e acompanha o quadro de destino", async () => {
    mocks.save.mockImplementation((_value, callbacks) => callbacks.onSuccess());
    render(<MasterTasks />);
    await userEvent.click(screen.getByText("Trabalho de Gabriel"));
    await userEvent.click(screen.getByRole("combobox", { name: "Responsável" }));
    await userEvent.click(screen.getByRole("option", { name: "Lucas" }));
    await userEvent.click(screen.getByRole("button", { name: "Encaminhar tarefa" }));
    expect(mocks.save).toHaveBeenCalledWith({ task: tasks[0], input: expect.objectContaining({ owner_master_user_id: owners[2].id, status: "a_fazer", due_date: tasks[0].due_date, estimated_minutes: tasks[0].estimated_minutes }) }, expect.any(Object));
    expect(screen.getByRole("combobox", { name: "Tarefas de" })).toHaveTextContent("Lucas");
  });

  it("exige data limite e tempo estimado positivo antes de criar", async () => {
    render(<MasterTasks />);
    await userEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    await userEvent.type(screen.getByLabelText("Título"), "Planejar entrega");
    await userEvent.click(screen.getByRole("button", { name: "Criar tarefa" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Informe uma data limite válida.");
    expect(mocks.save).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Data limite"), "2026-10-30");
    await userEvent.click(screen.getByRole("button", { name: "Criar tarefa" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Informe o tempo estimado");
    expect(mocks.save).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Minutos"), "15");
    await userEvent.type(screen.getByLabelText("Descrição", { exact: true }), "Conferir a entrega com a equipe.");
    await userEvent.click(screen.getByRole("button", { name: "Criar tarefa" }));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({
      due_date: "2026-10-30", estimated_minutes: 15, description: "Conferir a entrega com a equipe.",
    }) }), expect.any(Object));
    expect(screen.queryByText(/Codex|Claude Code|Complexidade do trabalho|Contexto para o prompt/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Gerar descrição|Copiar prompt/ })).not.toBeInTheDocument();
  });

  it("edita o prazo e a estimativa e mantém os valores se o salvamento falhar", async () => {
    mocks.save.mockImplementation((_value, callbacks) => callbacks.onError(new Error("Falha simulada")));
    render(<MasterTasks />);
    await userEvent.click(screen.getByText("Trabalho de Gabriel"));
    expect(screen.getByLabelText("Data limite")).toHaveValue("2026-10-30");
    expect(screen.getByLabelText("Horas")).toHaveValue(2);
    expect(screen.getByLabelText("Minutos")).toHaveValue(30);
    await userEvent.clear(screen.getByLabelText("Data limite"));
    await userEvent.type(screen.getByLabelText("Data limite"), "2026-11-05");
    await userEvent.clear(screen.getByLabelText("Horas"));
    await userEvent.type(screen.getByLabelText("Horas"), "3");
    await userEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({
      due_date: "2026-11-05", estimated_minutes: 210,
    }) }), expect.any(Object));
    expect(screen.getByLabelText("Data limite")).toHaveValue("2026-11-05");
    expect(screen.getByLabelText("Horas")).toHaveValue(3);
    expect(screen.getByLabelText("Minutos")).toHaveValue(30);
  });

  it("rejeita frações de hora e minutos fora da faixa", async () => {
    render(<MasterTasks />);
    await userEvent.click(screen.getByText("Trabalho de Gabriel"));
    await userEvent.clear(screen.getByLabelText("Horas"));
    await userEvent.type(screen.getByLabelText("Horas"), "1.5");
    await userEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Informe horas inteiras e minutos entre 0 e 59.");
    expect(mocks.save).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText("Horas"));
    await userEvent.clear(screen.getByLabelText("Minutos"));
    await userEvent.type(screen.getByLabelText("Minutos"), "60");
    await userEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Informe horas inteiras e minutos entre 0 e 59.");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("exibe a data limite e a estimativa no cartão", () => {
    render(<MasterTasks />);
    expect(screen.getByText(/Até 30\/10\/2026/)).toBeInTheDocument();
    expect(screen.getByText("Estimativa: 2h 30min")).toBeInTheDocument();
  });

  it("nega acesso direto a um master restrito", () => {
    mocks.full = false; render(<MasterTasks />);
    expect(screen.getByRole("alert")).toHaveTextContent("acesso completo");
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
