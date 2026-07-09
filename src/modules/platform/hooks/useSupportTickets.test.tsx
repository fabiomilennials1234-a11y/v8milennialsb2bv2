import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createMockSupabase } from "../../../../tests/helpers/supabase-mock";
import {
  useSupportTickets,
  useCreateSupportTicket,
  useSupportTicketComments,
  useCreateSupportTicketComment,
} from "./useSupportTickets";

const orgMock = vi.fn();
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: (...a: unknown[]) => orgMock(...a),
}));

const authMock = vi.fn();
vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({
  useAuth: (...a: unknown[]) => authMock(...a),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

let mock: ReturnType<typeof createMockSupabase>;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...a: unknown[]) => (mock.sb as never as { from: (...x: unknown[]) => unknown }).from(...a),
  },
}));

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const newQc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const ready = () => orgMock.mockReturnValue({ organizationId: "org-1", isLoading: false, isReady: true });
const authed = () => authMock.mockReturnValue({ user: { id: "user-1" } });

const draft = {
  title: "Kanban trava ao arrastar card",
  description: "Congela ao sair de abordado.",
  tipo: "bug" as const,
  impacto: "parado" as const,
};

beforeEach(() => {
  orgMock.mockReset();
  authMock.mockReset();
  mock = createMockSupabase();
  mock.mockTable("support_tickets", []);
  mock.mockTable("support_ticket_comments", []);
});

describe("useSupportTickets", () => {
  it("não consulta enquanto a organização não está pronta", () => {
    orgMock.mockReturnValue({ organizationId: null, isLoading: true, isReady: false });
    authed();
    const { result } = renderHook(() => useSupportTickets(), { wrapper: wrap(newQc()) });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("devolve os chamados que a RLS entregou", async () => {
    ready();
    authed();
    mock.mockTable("support_tickets", [
      { id: "t1", title: "Primeiro", created_at: "2026-07-01T00:00:00Z" },
      { id: "t2", title: "Segundo", created_at: "2026-07-02T00:00:00Z" },
    ]);

    const { result } = renderHook(() => useSupportTickets(), { wrapper: wrap(newQc()) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toHaveLength(2);
  });

  // Quem decide o que este usuário vê é a policy. Um `.eq("author_user_id", …)`
  // aqui daria a impressão de que o isolamento é do cliente.
  it("não filtra por autor — a visibilidade é da RLS", async () => {
    ready();
    authed();
    mock.mockTable("support_tickets", [{ id: "t1", author_user_id: "outro-usuario" }]);

    const { result } = renderHook(() => useSupportTickets(), { wrapper: wrap(newQc()) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.[0]?.id).toBe("t1");
  });
});

describe("useCreateSupportTicket", () => {
  it("insere o chamado com dono, autor e contexto", async () => {
    ready();
    authed();
    const { result } = renderHook(() => useCreateSupportTicket(), { wrapper: wrap(newQc()) });

    await result.current.mutateAsync({ draft, supportContext: { route: "/oportunidades" } });

    const [row] = mock.getInserted("support_tickets");
    expect(row.organization_id).toBe("org-1");
    expect(row.author_user_id).toBe("user-1");
    expect(row.support_context).toEqual({ route: "/oportunidades" });
    expect(row.tipo).toBe("bug");
    expect(row.impacto).toBe("parado");
  });

  // O trigger no banco recusa severidade vinda do cliente. O payload não deve
  // nem tentar — um campo que viaja é um campo que um dia é aceito.
  it("nunca envia severidade nem defect_url", async () => {
    ready();
    authed();
    const { result } = renderHook(() => useCreateSupportTicket(), { wrapper: wrap(newQc()) });

    await result.current.mutateAsync({ draft });

    const [row] = mock.getInserted("support_tickets");
    expect(row).not.toHaveProperty("severidade");
    expect(row).not.toHaveProperty("defect_url");
    expect(row).not.toHaveProperty("status");
  });

  it("recusa um rascunho inválido antes de tocar a rede", async () => {
    ready();
    authed();
    const { result } = renderHook(() => useCreateSupportTicket(), { wrapper: wrap(newQc()) });

    await expect(
      result.current.mutateAsync({ draft: { ...draft, title: "ab" } }),
    ).rejects.toThrow(/invalido/);
    expect(mock.getInserted("support_tickets")).toHaveLength(0);
  });

  it("recusa quando não há usuário autenticado", async () => {
    ready();
    authMock.mockReturnValue({ user: null });
    const { result } = renderHook(() => useCreateSupportTicket(), { wrapper: wrap(newQc()) });

    await expect(result.current.mutateAsync({ draft })).rejects.toThrow(/autenticado/);
    expect(mock.getInserted("support_tickets")).toHaveLength(0);
  });

  it("recusa quando a organização ainda não carregou", async () => {
    orgMock.mockReturnValue({ organizationId: null, isLoading: false, isReady: false });
    authed();
    const { result } = renderHook(() => useCreateSupportTicket(), { wrapper: wrap(newQc()) });

    await expect(result.current.mutateAsync({ draft })).rejects.toThrow(/organizacao/);
  });

  it("usa contexto vazio quando nenhum é passado", async () => {
    ready();
    authed();
    const { result } = renderHook(() => useCreateSupportTicket(), { wrapper: wrap(newQc()) });

    await result.current.mutateAsync({ draft });
    expect(mock.getInserted("support_tickets")[0].support_context).toEqual({});
  });
});

describe("useSupportTicketComments", () => {
  it("não consulta sem um chamado selecionado", () => {
    ready();
    authed();
    const { result } = renderHook(() => useSupportTicketComments(null), { wrapper: wrap(newQc()) });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("devolve os comentários que a RLS entregou", async () => {
    ready();
    authed();
    mock.mockTable("support_ticket_comments", [
      { id: "c1", ticket_id: "t1", body: "Acontece toda vez", is_internal: false },
    ]);

    const { result } = renderHook(() => useSupportTicketComments("t1"), { wrapper: wrap(newQc()) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toHaveLength(1);
  });
});

describe("useCreateSupportTicketComment", () => {
  it("insere o comentário aparado", async () => {
    ready();
    authed();
    const { result } = renderHook(() => useCreateSupportTicketComment(), { wrapper: wrap(newQc()) });

    await result.current.mutateAsync({ ticketId: "t1", body: "  alguma novidade?  " });

    const [row] = mock.getInserted("support_ticket_comments");
    expect(row.body).toBe("alguma novidade?");
    expect(row.ticket_id).toBe("t1");
    expect(row.author_user_id).toBe("user-1");
  });

  // Omitido, não `false`: mandar o campo sugeriria que o cliente escolhe.
  it("nunca envia is_internal", async () => {
    ready();
    authed();
    const { result } = renderHook(() => useCreateSupportTicketComment(), { wrapper: wrap(newQc()) });

    await result.current.mutateAsync({ ticketId: "t1", body: "oi" });
    expect(mock.getInserted("support_ticket_comments")[0]).not.toHaveProperty("is_internal");
  });

  it("recusa comentário vazio ou só de espaço", async () => {
    ready();
    authed();
    const { result } = renderHook(() => useCreateSupportTicketComment(), { wrapper: wrap(newQc()) });

    await expect(result.current.mutateAsync({ ticketId: "t1", body: "   " })).rejects.toThrow(/vazio/);
    expect(mock.getInserted("support_ticket_comments")).toHaveLength(0);
  });

  it("recusa quando não há usuário autenticado", async () => {
    ready();
    authMock.mockReturnValue({ user: null });
    const { result } = renderHook(() => useCreateSupportTicketComment(), { wrapper: wrap(newQc()) });

    await expect(result.current.mutateAsync({ ticketId: "t1", body: "oi" })).rejects.toThrow(/autenticado/);
  });
});
