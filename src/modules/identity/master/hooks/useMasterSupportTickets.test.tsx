import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createMockSupabase } from "../../../../../tests/helpers/supabase-mock";
import {
  useMasterSupportTickets,
  useTriageSupportTicket,
  useClaimSupportTicket,
  useCreateStaffComment,
} from "./useMasterSupportTickets";

const masterAuthMock = vi.fn();
vi.mock("./useMasterAuth", () => ({
  useMasterAuth: (...a: unknown[]) => masterAuthMock(...a),
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

const asMaster = () =>
  masterAuthMock.mockReturnValue({ isMaster: true, masterUser: { id: "mu-1" }, isLoading: false });

beforeEach(() => {
  masterAuthMock.mockReset();
  mock = createMockSupabase();
  mock.mockTable("support_tickets", []);
  mock.mockTable("support_ticket_comments", []);
});

describe("useMasterSupportTickets", () => {
  it("não consulta quando o usuário não é master", () => {
    masterAuthMock.mockReturnValue({ isMaster: false, masterUser: null, isLoading: false });
    const { result } = renderHook(() => useMasterSupportTickets(), { wrapper: wrap(newQc()) });
    expect(result.current.fetchStatus).toBe("idle");
  });

  // A fila é cross-org por desenho. Filtrar por organization_id aqui daria a
  // impressão de que o isolamento é do cliente — quem abre a fila é a RLS.
  it("traz chamados de organizações diferentes", async () => {
    asMaster();
    mock.mockTable("support_tickets", [
      { id: "t1", organization_id: "org-a", status: "aberto" },
      { id: "t2", organization_id: "org-b", status: "aberto" },
    ]);

    const { result } = renderHook(() => useMasterSupportTickets(), { wrapper: wrap(newQc()) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toHaveLength(2);
  });

  it("filtra por status", async () => {
    asMaster();
    mock.mockTable("support_tickets", [
      { id: "t1", status: "aberto" },
      { id: "t2", status: "resolvido" },
    ]);

    const { result } = renderHook(() => useMasterSupportTickets({ status: "aberto" }), {
      wrapper: wrap(newQc()),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.map((t) => t.id)).toEqual(["t1"]);
  });

  it("filtra os que ninguém pegou", async () => {
    asMaster();
    mock.mockTable("support_tickets", [
      { id: "t1", assigned_master_user_id: null },
      { id: "t2", assigned_master_user_id: "mu-9" },
    ]);

    const { result } = renderHook(() => useMasterSupportTickets({ unassigned: true }), {
      wrapper: wrap(newQc()),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.map((t) => t.id)).toEqual(["t1"]);
  });

  // Filtrar por defeito e' como o staff responde os N clientes de uma vez
  // quando o dev fecha a issue.
  it("filtra todos os chamados de um mesmo defeito", async () => {
    asMaster();
    // `created_at` importa: a fila vem mais recente primeiro.
    mock.mockTable("support_tickets", [
      { id: "t1", created_at: "2026-07-03T00:00:00Z", defect_url: "https://github.com/o/r/issues/1" },
      { id: "t2", created_at: "2026-07-02T00:00:00Z", defect_url: "https://github.com/o/r/issues/2" },
      { id: "t3", created_at: "2026-07-01T00:00:00Z", defect_url: "https://github.com/o/r/issues/1" },
    ]);

    const { result } = renderHook(
      () => useMasterSupportTickets({ defectUrl: "https://github.com/o/r/issues/1" }),
      { wrapper: wrap(newQc()) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.map((t) => t.id)).toEqual(["t1", "t3"]);
  });

  it("filtros diferentes não compartilham cache", async () => {
    asMaster();
    const qc = newQc();
    renderHook(() => useMasterSupportTickets({ status: "aberto" }), { wrapper: wrap(qc) });
    renderHook(() => useMasterSupportTickets({ status: "resolvido" }), { wrapper: wrap(qc) });
    await waitFor(() => expect(qc.getQueryCache().getAll().length).toBe(2));
  });
});

describe("useTriageSupportTicket", () => {
  it("escreve tipo, severidade e status", async () => {
    asMaster();
    mock.mockTable("support_tickets", [{ id: "t1", status: "aberto" }]);
    const { result } = renderHook(() => useTriageSupportTicket(), { wrapper: wrap(newQc()) });

    await result.current.mutateAsync({
      ticketId: "t1",
      tipo: "duvida",
      severidade: "alta",
      status: "em_andamento",
    });

    const [row] = mock.getUpdated("support_tickets");
    expect(row.tipo).toBe("duvida");
    expect(row.severidade).toBe("alta");
    expect(row.status).toBe("em_andamento");
  });

  it("vincula o defeito", async () => {
    asMaster();
    mock.mockTable("support_tickets", [{ id: "t1" }]);
    const { result } = renderHook(() => useTriageSupportTicket(), { wrapper: wrap(newQc()) });

    await result.current.mutateAsync({
      ticketId: "t1",
      defect_url: "https://github.com/o/r/issues/1005",
    });
    expect(mock.getUpdated("support_tickets")[0].defect_url).toBe(
      "https://github.com/o/r/issues/1005",
    );
  });

  it("desvincula o defeito com null", async () => {
    asMaster();
    mock.mockTable("support_tickets", [{ id: "t1", defect_url: "x" }]);
    const { result } = renderHook(() => useTriageSupportTicket(), { wrapper: wrap(newQc()) });

    await result.current.mutateAsync({ ticketId: "t1", defect_url: null });
    expect(mock.getUpdated("support_tickets")[0].defect_url).toBeNull();
  });

  // Os carimbos são do banco. O trigger levanta exceção se o cliente os tocar —
  // e o console não deve nem tentar.
  it("nunca escreve os campos do relógio", async () => {
    asMaster();
    mock.mockTable("support_tickets", [{ id: "t1" }]);
    const { result } = renderHook(() => useTriageSupportTicket(), { wrapper: wrap(newQc()) });

    await result.current.mutateAsync({ ticketId: "t1", status: "resolvido" });

    const [row] = mock.getUpdated("support_tickets");
    expect(row).not.toHaveProperty("first_response_at");
    expect(row).not.toHaveProperty("resolved_at");
    expect(row).not.toHaveProperty("awaiting_customer_ms");
    expect(row).not.toHaveProperty("reopen_count");
  });
});

describe("useClaimSupportTicket", () => {
  it("assume o chamado em nome do master logado", async () => {
    asMaster();
    mock.mockTable("support_tickets", [{ id: "t1", assigned_master_user_id: null }]);
    const { result } = renderHook(() => useClaimSupportTicket(), { wrapper: wrap(newQc()) });

    await result.current.mutateAsync({ ticketId: "t1" });
    expect(mock.getUpdated("support_tickets")[0].assigned_master_user_id).toBe("mu-1");
  });

  it("passa o chamado para outro master", async () => {
    asMaster();
    mock.mockTable("support_tickets", [{ id: "t1" }]);
    const { result } = renderHook(() => useClaimSupportTicket(), { wrapper: wrap(newQc()) });

    await result.current.mutateAsync({ ticketId: "t1", masterUserId: "mu-2" });
    expect(mock.getUpdated("support_tickets")[0].assigned_master_user_id).toBe("mu-2");
  });

  it("devolve o chamado para a fila", async () => {
    asMaster();
    mock.mockTable("support_tickets", [{ id: "t1" }]);
    const { result } = renderHook(() => useClaimSupportTicket(), { wrapper: wrap(newQc()) });

    await result.current.mutateAsync({ ticketId: "t1", masterUserId: null });
    expect(mock.getUpdated("support_tickets")[0].assigned_master_user_id).toBeNull();
  });

  it("recusa quando o master ainda não carregou", async () => {
    masterAuthMock.mockReturnValue({ isMaster: true, masterUser: null, isLoading: true });
    const { result } = renderHook(() => useClaimSupportTicket(), { wrapper: wrap(newQc()) });
    await expect(result.current.mutateAsync({ ticketId: "t1" })).rejects.toThrow(/master/);
  });
});

describe("useCreateStaffComment", () => {
  it("escreve uma resposta pública", async () => {
    asMaster();
    const { result } = renderHook(() => useCreateStaffComment(), { wrapper: wrap(newQc()) });

    await result.current.mutateAsync({
      ticketId: "t1",
      body: "  Já estamos olhando.  ",
      isInternal: false,
      authorUserId: "u-master",
    });

    const [row] = mock.getInserted("support_ticket_comments");
    expect(row.body).toBe("Já estamos olhando.");
    expect(row.is_internal).toBe(false);
  });

  it("escreve uma nota interna", async () => {
    asMaster();
    const { result } = renderHook(() => useCreateStaffComment(), { wrapper: wrap(newQc()) });

    await result.current.mutateAsync({
      ticketId: "t1",
      body: "provavelmente o stage_cap",
      isInternal: true,
      authorUserId: "u-master",
    });

    expect(mock.getInserted("support_ticket_comments")[0].is_internal).toBe(true);
  });

  // Quem carimba é o trigger, no primeiro comentário público de um master.
  // Carimbar daqui seria uma promessa que o console pode esquecer de cumprir.
  it("nunca carimba first_response_at", async () => {
    asMaster();
    const { result } = renderHook(() => useCreateStaffComment(), { wrapper: wrap(newQc()) });

    await result.current.mutateAsync({
      ticketId: "t1",
      body: "primeira resposta",
      isInternal: false,
      authorUserId: "u-master",
    });

    expect(mock.getUpdated("support_tickets")).toHaveLength(0);
  });

  it("recusa comentário vazio", async () => {
    asMaster();
    const { result } = renderHook(() => useCreateStaffComment(), { wrapper: wrap(newQc()) });
    await expect(
      result.current.mutateAsync({ ticketId: "t1", body: "  ", isInternal: false, authorUserId: "u" }),
    ).rejects.toThrow(/vazio/);
  });
});
