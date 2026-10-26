import { render, screen, within, cleanup, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import MasterTasks from "./MasterTasks";

const mocks = vi.hoisted(() => ({ user: 0, full: true, error: false, generating: false, generate: vi.fn(), save: vi.fn(), move: vi.fn(), remove: vi.fn(), query: vi.fn(), notify: vi.fn() }));
const owners = ["Gabriel", "Marcelo", "Lucas"].map((name, index) => ({
  name, id: `00000000-0000-4000-8000-00000000000${index + 1}`, userId: `user-${index}`,
}));
const tasks = owners.map((owner, index) => ({
  id: `task-${index}`, owner_master_user_id: owner.id, title: `Trabalho de ${owner.name}`, description: "Contexto da tarefa",
  context: "Preservar o fluxo atual", prompt_complexity: "media",
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
vi.mock("../hooks/useMasterTaskDescription", () => ({ useMasterTaskDescription: () => ({ mutateAsync: mocks.generate, isPending: mocks.generating }) }));
vi.mock("../components/MasterPageHeader", () => ({ MasterPageHeader: ({ title, actions }: { title: string; actions: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header> }));
vi.mock("@/shared/errors", () => ({ notifyError: (...args: unknown[]) => mocks.notify(...args) }));

beforeEach(() => {
  cleanup(); vi.resetAllMocks(); mocks.user = 0; mocks.full = true; mocks.error = false; mocks.generating = false;
  mocks.generate.mockResolvedValue({ description: "Objetivo\nRevisar implantação\n\nO que fazer\n1. Conferir o fluxo.\n\nConcluída quando\n• Fluxo validado.", complexity: "baixa" });
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
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Responsável" }));
    await userEvent.click(screen.getByRole("option", { name: "Lucas" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Criar tarefa" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ task: undefined, input: {
      title: "Revisar implantação", context: "", prompt_complexity: "baixa", description: expect.stringContaining("Concluída quando"), status: "a_fazer", owner_master_user_id: owners[2].id,
    } }, expect.any(Object)));
    expect(mocks.generate).toHaveBeenCalledWith({ title: "Revisar implantação", context: "" });
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
      owner_master_user_id: owners[0].id, status: "fazendo", description: tasks[1].description,
    }) }, expect.any(Object));
    expect(screen.getByRole("combobox", { name: "Tarefas de" })).toHaveTextContent("Gabriel (você)");
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("encaminha uma tarefa para outro master e acompanha o quadro de destino", async () => {
    mocks.save.mockImplementation((_value, callbacks) => callbacks.onSuccess());
    render(<MasterTasks />);
    await userEvent.click(screen.getByText("Trabalho de Gabriel"));
    await userEvent.click(screen.getByRole("combobox", { name: "Responsável" }));
    await userEvent.click(screen.getByRole("option", { name: "Lucas" }));
    await userEvent.click(screen.getByRole("button", { name: "Encaminhar tarefa" }));
    expect(mocks.save).toHaveBeenCalledWith({ task: tasks[0], input: expect.objectContaining({ owner_master_user_id: owners[2].id, status: "a_fazer" }) }, expect.any(Object));
    expect(screen.getByRole("combobox", { name: "Tarefas de" })).toHaveTextContent("Lucas");
  });

  it("falha do agente preserva o formulário e permite criar sem descrição sem repetir a geração", async () => {
    mocks.generate.mockRejectedValue(new Error("Provedor indisponível"));
    render(<MasterTasks />);
    await userEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    await userEvent.type(screen.getByLabelText("Título"), "Revisar implantação");
    await userEvent.type(screen.getByLabelText("Contexto para o prompt"), "Manter o fluxo atual");
    await userEvent.click(screen.getByRole("button", { name: "Criar tarefa" }));
    await screen.findByRole("alert");
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Contexto para o prompt")).toHaveValue("Manter o fluxo atual");
    await userEvent.click(screen.getByRole("button", { name: "Criar sem descrição" }));
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ description: "", context: "Manter o fluxo atual" }) }), expect.any(Object));
  });

  it("descrição manual não é substituída automaticamente", async () => {
    render(<MasterTasks />);
    await userEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    await userEvent.type(screen.getByLabelText("Título"), "Minha tarefa");
    await userEvent.type(screen.getByLabelText("Descrição", { exact: true }), "Meu prompt revisado");
    await userEvent.click(screen.getByRole("button", { name: "Criar tarefa" }));
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ description: "Meu prompt revisado" }) }), expect.any(Object));
  });

  it("oferece as duas ferramentas e copia prompt com modelo, esforço e contexto", async () => {
    const user = userEvent.setup();
    const clipboard = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<MasterTasks />);
    await user.click(screen.getByText("Trabalho de Gabriel"));
    const choices = screen.getByRole("group", { name: "Destino do prompt" });
    expect(within(choices).getByRole("button", { name: /Codex/ })).toHaveTextContent("GPT-6.1 Sol");
    expect(within(choices).getByRole("button", { name: /Claude Code/ })).toHaveTextContent("Opus");
    await user.click(screen.getByRole("button", { name: "Copiar prompt para Codex" }));
    expect(clipboard).toHaveBeenLastCalledWith(expect.stringContaining("Modelo recomendado: GPT-6.1 Sol (gpt-6.1-sol)"));
    expect(clipboard).toHaveBeenLastCalledWith(expect.stringContaining("Preservar o fluxo atual"));
    await user.click(within(choices).getByRole("button", { name: /Claude Code/ }));
    await user.click(screen.getByRole("button", { name: "Copiar /model opus" }));
    expect(clipboard).toHaveBeenLastCalledWith("/model opus");
    await user.click(screen.getByRole("button", { name: "Copiar /effort medium" }));
    expect(clipboard).toHaveBeenLastCalledWith("/effort medium");
    await user.click(screen.getByRole("button", { name: "Copiar prompt para Claude Code" }));
    expect(clipboard).toHaveBeenLastCalledWith(expect.stringContaining("Ambiente: Claude Code"));
    expect(clipboard.mock.calls.at(-1)?.[0]).not.toContain("/model");
    clipboard.mockRestore();
  });

  it("regenerar exige confirmação e só altera a descrição ao obter sucesso", async () => {
    render(<MasterTasks />);
    await userEvent.click(screen.getByText("Trabalho de Gabriel"));
    await userEvent.click(screen.getByRole("button", { name: "Gerar novamente" }));
    expect(mocks.generate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Gerar nova descrição" }));
    await waitFor(() => expect((screen.getByLabelText("Descrição", { exact: true }) as HTMLTextAreaElement).value).toContain("Concluída quando"));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Complexidade do trabalho" })).toHaveTextContent("Baixa");
  });

  it("trocar de conta durante a geração não cria uma tarefa na nova sessão", async () => {
    let finish: (value: { description: string; complexity: string }) => void;
    mocks.generate.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = render(<MasterTasks />);
    await userEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    await userEvent.type(screen.getByLabelText("Título"), "Tarefa da conta anterior");
    await userEvent.click(screen.getByRole("button", { name: "Criar tarefa" }));
    mocks.user = 2; view.rerender(<MasterTasks />);
    await act(async () => { finish!({ description: "Prompt antigo", complexity: "media" }); });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Tarefas de" })).toHaveTextContent("Lucas (você)");
  });

  it("nega acesso direto a um master restrito", () => {
    mocks.full = false; render(<MasterTasks />);
    expect(screen.getByRole("alert")).toHaveTextContent("acesso completo");
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
