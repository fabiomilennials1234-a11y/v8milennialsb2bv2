import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { SupportPanelProvider } from "./SupportPanelProvider";
import { SupportPanel } from "./SupportPanel";
import { useSupportPanel } from "./SupportPanelContext";

const createTicket = vi.fn();
const createComment = vi.fn();
const ticketsData = { current: [] as unknown[] };

const openTicketData = { current: null as Record<string, unknown> | null };
const commentsData = { current: [] as unknown[] };
const reopen = vi.fn();
vi.mock("@/modules/platform/hooks/useSupportTickets", () => ({
  useSupportTickets: () => ({ data: ticketsData.current, isLoading: false }),
  useSupportTicket: () => ({ data: openTicketData.current, isLoading: !openTicketData.current }),
  useSupportTicketComments: () => ({ data: commentsData.current }),
  useCreateSupportTicket: () => ({ mutateAsync: createTicket, isPending: false }),
  useCreateSupportTicketComment: () => ({ mutateAsync: createComment, isPending: false }),
  useReopenSupportTicket: () => ({ mutate: reopen, isPending: false }),
}));

// O thread mostra os anexos de cada mensagem, e isso fala com o Storage.
// `attachmentCapacity` e funcao pura e tem teste proprio; aqui ela so precisa
// existir, porque o mock substitui o modulo inteiro.
vi.mock("@/modules/platform/hooks/useTicketAttachments", () => ({
  useTicketAttachments: () => ({ data: [] }),
  useUploadTicketAttachment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteTicketAttachment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  draftAttachmentCapacity: () => ({ ok: true }),
  groupByComment: () => new Map(),
  uploadAll: async () => [],
  ATTACHMENTS_QUERY_KEY: "support-ticket-attachments",
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) } }));

const articlesData = { current: [] as unknown[] };
vi.mock("@/modules/platform/hooks/useHelpCenter", () => ({
  useHelpArticles: () => ({ data: articlesData.current, isLoading: false }),
}));
vi.mock("@/modules/platform/components/settings/help/HelpArticleDialog", () => ({
  HelpArticleDialog: ({ article }: { article: { title: string } | null }) =>
    article ? <div>artigo aberto: {article.title}</div> : null,
}));

// O contexto real depende de router, sessionStorage e navigator. Ele tem testes
// proprios em src/core/observability — aqui interessa que o painel o anexe.
const captureSupportContext = vi.fn(() => ({ route: "/oportunidades", session_id: "sess-1" }));

const unreadData = { current: {} as Record<string, number> };
const markRead = vi.fn();
vi.mock("@/modules/platform/hooks/useSupportUnread", () => ({
  useSupportUnread: () => ({ byTicket: unreadData.current, total: 0, isLoading: false }),
  useMarkSupportRepliesRead: () => ({ mutate: markRead }),
}));
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

function setup(children?: ReactNode, route = "/oportunidades") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <SupportPanelProvider>
        <OpenNewTicket />
        {children}
        <SupportPanel />
      </SupportPanelProvider>
    </MemoryRouter>,
  );
}

const artigo = (over: Record<string, unknown>) => ({
  id: "a1",
  title: "Por que um lead não aparece no kanban?",
  summary: null,
  tags: [],
  is_published: true,
  category: { slug: "oportunidades", name: "Funil" },
  ...over,
});

beforeEach(() => {
  toastError.mockClear();
  articlesData.current = [];
  openTicketData.current = null;
  commentsData.current = [];
  reopen.mockClear();
  unreadData.current = {};
  markRead.mockClear();
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
    expect(screen.getByRole("button", { name: /enviar mensagem/i })).toBeInTheDocument();
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

  // Um bloco "Artigos" vazio e pior que sua ausencia: sinaliza que ali nao
  // existe ajuda. Em producao o corpus esta vazio hoje.
  it("esconde a central de ajuda quando não há artigo publicado", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("abrir painel"));

    expect(await screen.findByText("Nenhum chamado por aqui")).toBeInTheDocument();
    expect(screen.queryByLabelText("Buscar na central de ajuda")).not.toBeInTheDocument();
  });

  it("esconde a central quando os artigos existem mas nenhum foi publicado", async () => {
    const user = userEvent.setup();
    articlesData.current = [artigo({ is_published: false })];
    setup();
    await user.click(screen.getByText("abrir painel"));

    await screen.findByText("Nenhum chamado por aqui");
    expect(screen.queryByLabelText("Buscar na central de ajuda")).not.toBeInTheDocument();
  });

  it("mostra a busca e o artigo sugerido pela rota", async () => {
    const user = userEvent.setup();
    articlesData.current = [artigo({})];
    setup(undefined, "/oportunidades");
    await user.click(screen.getByText("abrir painel"));

    expect(await screen.findByLabelText("Buscar na central de ajuda")).toBeInTheDocument();
    expect(screen.getByText("Por que um lead não aparece no kanban?")).toBeInTheDocument();
    expect(screen.getByText("/oportunidades")).toBeInTheDocument();
  });

  // Fatia A3: o selo "vídeo" na linha do artigo, derivado de video_url.
  it("mostra o selo de vídeo quando o artigo tem video_url", async () => {
    const user = userEvent.setup();
    articlesData.current = [artigo({ video_url: "https://youtu.be/dQw4w9WgXcQ" })];
    setup(undefined, "/oportunidades");
    await user.click(screen.getByText("abrir painel"));

    await screen.findByText("Por que um lead não aparece no kanban?");
    expect(screen.getByText("vídeo")).toBeInTheDocument();
  });

  it("não mostra o selo de vídeo quando video_url é nulo", async () => {
    const user = userEvent.setup();
    articlesData.current = [artigo({ video_url: null })];
    setup(undefined, "/oportunidades");
    await user.click(screen.getByText("abrir painel"));

    await screen.findByText("Por que um lead não aparece no kanban?");
    expect(screen.queryByText("vídeo")).not.toBeInTheDocument();
  });

  it("a busca filtra, e um termo sem resultado não devolve fallback", async () => {
    const user = userEvent.setup();
    articlesData.current = [artigo({})];
    setup();
    await user.click(screen.getByText("abrir painel"));

    await user.type(await screen.findByLabelText("Buscar na central de ajuda"), "zzzzz");
    expect(screen.queryByText("Por que um lead não aparece no kanban?")).not.toBeInTheDocument();
    expect(screen.getByText(/Nenhum artigo para/)).toBeInTheDocument();
  });

  // Ajuda antes de humano: o CTA humano fica depois dos artigos, no rodape.
  it("o botão de abrir chamado vem depois dos artigos", async () => {
    const user = userEvent.setup();
    articlesData.current = [artigo({})];
    setup();
    await user.click(screen.getByText("abrir painel"));

    const artigoEl = await screen.findByText("Por que um lead não aparece no kanban?");
    const cta = screen.getByRole("button", { name: /^enviar mensagem$/i });
    expect(artigoEl.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // O loop de volta: o cliente precisa saber que o suporte respondeu.
  it("mostra o número de respostas não lidas no chamado", async () => {
    const user = userEvent.setup();
    ticketsData.current = [
      { id: "t1", title: "Kanban trava", status: "aberto", created_at: new Date().toISOString() },
    ];
    unreadData.current = { t1: 2 };
    setup();
    await user.click(screen.getByText("abrir painel"));

    expect(await screen.findByLabelText("2 respostas não lidas")).toHaveTextContent("2");
  });

  it("não mostra badge quando não há resposta nova", async () => {
    const user = userEvent.setup();
    ticketsData.current = [
      { id: "t1", title: "Kanban trava", status: "aberto", created_at: new Date().toISOString() },
    ];
    setup();
    await user.click(screen.getByText("abrir painel"));

    await screen.findByText("Kanban trava");
    expect(screen.queryByLabelText(/não lida/)).not.toBeInTheDocument();
  });

  // Abrir o thread e o ato de ler. Um botao "marcar como lido" pediria ao
  // usuario que confirmasse que leu o que ja esta na tela dele.
  it("abrir o chamado marca as respostas como lidas", async () => {
    const user = userEvent.setup();
    ticketsData.current = [
      { id: "t1", title: "Kanban trava", status: "aberto", created_at: new Date().toISOString() },
    ];
    unreadData.current = { t1: 1 };
    setup();
    await user.click(screen.getByText("abrir painel"));
    await user.click(await screen.findByText("Kanban trava"));

    await waitFor(() => expect(markRead).toHaveBeenCalledWith("t1"));
  });

  const abrirThread = async (
    user: ReturnType<typeof userEvent.setup>,
    ticket: Record<string, unknown>,
  ) => {
    openTicketData.current = {
      id: "t1",
      title: "Kanban trava",
      description: null,
      status: "aberto",
      author_user_id: "user-1",
      created_at: new Date().toISOString(),
      ...ticket,
    };
    ticketsData.current = [openTicketData.current];
    setup();
    await user.click(screen.getByText("abrir painel"));
    await user.click(await screen.findByText("Kanban trava"));
  };

  // Sete dias de silencio confirmam o conserto. Ate la, reabrir e a unica
  // transicao que o cliente pode fazer.
  it("oferece reabrir quando o chamado está resolvido", async () => {
    const user = userEvent.setup();
    await abrirThread(user, { status: "resolvido" });

    const botao = await screen.findByRole("button", { name: /reabrir/i });
    await user.click(botao);
    expect(reopen).toHaveBeenCalledWith("t1", expect.anything());
  });

  it("não oferece reabrir num chamado aberto", async () => {
    const user = userEvent.setup();
    await abrirThread(user, { status: "aberto" });

    await screen.findByPlaceholderText("Responder…");
    expect(screen.queryByRole("button", { name: /reabrir/i })).not.toBeInTheDocument();
  });

  // Regressão: a nota interna do staff jamais aparece no painel do cliente,
  // mesmo que a RLS a entregue a um master que usa este mesmo painel (chamado
  // próprio / shadow). O filtro mora no componente, não só na policy.
  it("nunca renderiza nota interna no painel do cliente", async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    commentsData.current = [
      { id: "c1", body: "resposta publica do suporte", is_internal: false, from_staff: true, author_user_id: "staff-1", created_at: now },
      { id: "c2", body: "NOTA INTERNA SECRETA", is_internal: true, from_staff: true, author_user_id: "staff-1", created_at: now },
    ];
    await abrirThread(user, { status: "aberto" });

    expect(await screen.findByText("resposta publica do suporte")).toBeInTheDocument();
    expect(screen.queryByText("NOTA INTERNA SECRETA")).not.toBeInTheDocument();
  });

  // Regressão: a resposta do staff (from_staff) é etiquetada "Suporte Torque",
  // por origem — não por identidade.
  it("etiqueta a resposta do staff como Suporte Torque", async () => {
    const user = userEvent.setup();
    commentsData.current = [
      { id: "c1", body: "aqui e o suporte", is_internal: false, from_staff: true, author_user_id: "staff-1", created_at: new Date().toISOString() },
    ];
    await abrirThread(user, { status: "aberto" });

    expect(await screen.findByText("aqui e o suporte")).toBeInTheDocument();
    expect(screen.getByText(/Suporte Torque/)).toBeInTheDocument();
  });

  // `fechado` e terminal: nem reabrir, nem responder.
  it("um chamado fechado não oferece reabrir nem responder", async () => {
    const user = userEvent.setup();
    await abrirThread(user, { status: "fechado" });

    expect(await screen.findByText(/foi fechado/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reabrir/i })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Responder…")).not.toBeInTheDocument();
  });

  // Cinco chamados por hora. O usuario nao e spammer: e gente com problema, e a
  // mensagem oferece a saida em vez de acusar.
  it("traduz o erro de rate limit do banco numa mensagem que ajuda", async () => {
    const user = userEvent.setup();
    createTicket.mockRejectedValueOnce(new Error("rate_limit_chamados:15:04"));
    setup();
    await user.click(screen.getByText("cmd-k abrir chamado"));

    await user.click(await screen.findByText("Algo está quebrado"));
    await user.type(screen.getByLabelText("Assunto"), "Sexto chamado da hora");
    await user.click(screen.getByText("Sim, estou parado"));
    await user.click(screen.getByRole("button", { name: /^abrir chamado$/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const [mensagem] = toastError.mock.calls[0];
    expect(mensagem).toContain("15:04");
    expect(mensagem).toContain("5 chamados");
    expect(mensagem).not.toContain("rate_limit_chamados");
  });

  it("um erro qualquer não vira mensagem de rate limit", async () => {
    const user = userEvent.setup();
    createTicket.mockRejectedValueOnce(new Error("permission denied"));
    setup();
    await user.click(screen.getByText("cmd-k abrir chamado"));

    await user.click(await screen.findByText("Algo está quebrado"));
    await user.type(screen.getByLabelText("Assunto"), "Chamado normal");
    await user.click(screen.getByText("Sim, estou parado"));
    await user.click(screen.getByRole("button", { name: /^abrir chamado$/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("permission denied"));
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
