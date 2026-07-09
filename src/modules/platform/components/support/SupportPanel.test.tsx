import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { SupportPanelProvider } from "./SupportPanelProvider";
import { SupportPanel } from "./SupportPanel";
import { useSupportPanel } from "./SupportPanelContext";

const createTicket = vi.fn();
const createComment = vi.fn();
const ticketsData = { current: [] as unknown[] };

vi.mock("@/modules/platform/hooks/useSupportTickets", () => ({
  useSupportTickets: () => ({ data: ticketsData.current, isLoading: false }),
  useSupportTicket: () => ({ data: null, isLoading: true }),
  useSupportTicketComments: () => ({ data: [] }),
  useCreateSupportTicket: () => ({ mutateAsync: createTicket, isPending: false }),
  useCreateSupportTicketComment: () => ({ mutateAsync: createComment, isPending: false }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// O contexto real depende de router, sessionStorage e navigator. Ele tem testes
// proprios em src/core/observability — aqui interessa que o painel o anexe.
const captureSupportContext = vi.fn(() => ({ route: "/oportunidades", session_id: "sess-1" }));
vi.mock("@/modules/platform/hooks/useSupportContext", () => ({
  useCaptureSupportContext: () => captureSupportContext,
}));

// O thread lê o usuário para saber de quem é cada mensagem.
vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

/** Abre o painel como o Cmd+K faz. */
function OpenNewTicket() {
  const { openNewTicket, open } = useSupportPanel();
  return (
    <>
      <button onClick={open}>abrir painel</button>
      <button onClick={openNewTicket}>cmd-k abrir chamado</button>
    </>
  );
}

function setup(children?: ReactNode) {
  return render(
    <SupportPanelProvider>
      <OpenNewTicket />
      {children}
      <SupportPanel />
    </SupportPanelProvider>,
  );
}

beforeEach(() => {
  captureSupportContext.mockClear();
  createTicket.mockReset().mockResolvedValue({ id: "t-novo" });
  createComment.mockReset();
  ticketsData.current = [];
});

describe("SupportPanel", () => {
  it("fica fechado até alguém abrir", () => {
    setup();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("mostra o estado vazio quando não há chamados", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("abrir painel"));

    expect(await screen.findByText("Nenhum chamado por aqui")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /abrir chamado/i })).toBeInTheDocument();
  });

  it("lista os chamados que o hook devolveu", async () => {
    const user = userEvent.setup();
    ticketsData.current = [
      {
        id: "t1",
        title: "Kanban trava ao arrastar card",
        status: "aberto",
        created_at: new Date().toISOString(),
      },
    ];
    setup();
    await user.click(screen.getByText("abrir painel"));

    expect(await screen.findByText("Kanban trava ao arrastar card")).toBeInTheDocument();
  });

  // O Cmd+K abre direto no formulário — não na lista.
  it("o atalho abre direto no formulário de abertura", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("cmd-k abrir chamado"));

    expect(await screen.findByLabelText("Assunto")).toBeInTheDocument();
  });

  // A pergunta é factual. O usuário sabe se está parado; não sabe se é crítico.
  it("pergunta o impacto e NUNCA oferece severidade", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("cmd-k abrir chamado"));

    expect(await screen.findByText(/impede de trabalhar/i)).toBeInTheDocument();
    expect(screen.getByText("Sim, estou parado")).toBeInTheDocument();
    expect(screen.queryByText(/severidade/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/crítica/i)).not.toBeInTheDocument();
  });

  it("não envia um rascunho incompleto e mostra os erros de uma vez", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("cmd-k abrir chamado"));
    await user.click(await screen.findByRole("button", { name: /^abrir chamado$/i }));

    expect(createTicket).not.toHaveBeenCalled();
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.length).toBeGreaterThanOrEqual(3);
  });

  it("abre o chamado com tipo, impacto e a rota atual", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("cmd-k abrir chamado"));

    await user.click(await screen.findByText("Algo está quebrado"));
    await user.type(screen.getByLabelText("Assunto"), "Kanban trava ao arrastar card");
    await user.click(screen.getByText("Sim, estou parado"));
    await user.click(screen.getByRole("button", { name: /^abrir chamado$/i }));

    await waitFor(() => expect(createTicket).toHaveBeenCalledTimes(1));
    const arg = createTicket.mock.calls[0][0];
    expect(arg.draft.tipo).toBe("bug");
    expect(arg.draft.impacto).toBe("parado");
    expect(arg.draft.title).toBe("Kanban trava ao arrastar card");
  });

  // O snapshot descreve o mundo quando quebrou. Capturar no submit, e nao no
  // render, e o que faz dele uma fotografia e nao uma lembranca.
  it("captura o Support Context no envio e o anexa ao chamado", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("cmd-k abrir chamado"));

    await user.click(await screen.findByText("Algo está quebrado"));
    await user.type(screen.getByLabelText("Assunto"), "Kanban trava ao arrastar card");
    await user.click(screen.getByText("Sim, estou parado"));
    expect(captureSupportContext).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^abrir chamado$/i }));

    await waitFor(() => expect(createTicket).toHaveBeenCalledTimes(1));
    expect(captureSupportContext).toHaveBeenCalledTimes(1);
    expect(createTicket.mock.calls[0][0].supportContext).toEqual({
      route: "/oportunidades",
      session_id: "sess-1",
    });
  });

  it("cai no thread do chamado recém-aberto", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("cmd-k abrir chamado"));

    await user.click(await screen.findByText("Tenho uma dúvida"));
    await user.type(screen.getByLabelText("Assunto"), "Como configuro o funil?");
    await user.click(screen.getByText("Consigo contornar"));
    await user.click(screen.getByRole("button", { name: /^abrir chamado$/i }));

    // TicketThread entra em loading (o mock devolve isLoading: true) — o
    // formulário some, que é o sinal de que a navegação aconteceu.
    await waitFor(() => expect(screen.queryByLabelText("Assunto")).not.toBeInTheDocument());
  });
});
