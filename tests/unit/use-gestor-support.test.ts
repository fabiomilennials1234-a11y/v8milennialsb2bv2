/**
 * Chamados da Área do Gestor (ADR-0021 §9).
 *
 * Foco: ancoragem numa org vinculada + marcador de autor-gestor. O frontend
 * nunca inventa org fora dos vínculos; o rascunho inválido morre antes da rede;
 * a linha reusa `buildTicketInsert` (nunca emite severidade/defect_url) e só
 * acrescenta `author_gestor_id`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";
import { createMockSupabase } from "../helpers/supabase-mock";
import {
  useCreateGestorSupportTicket,
  useGestorSupportTickets,
} from "@/modules/identity/gestor/hooks/useGestorSupport";

const gestorMock = vi.fn();
vi.mock("@/modules/identity/gestor/hooks/useGestor", () => ({
  useGestor: (...a: unknown[]) => gestorMock(...a),
}));

const authMock = vi.fn();
vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({
  useAuth: (...a: unknown[]) => authMock(...a),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

let mock: ReturnType<typeof createMockSupabase>;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...a: unknown[]) =>
      (mock.sb as never as { from: (...x: unknown[]) => unknown }).from(...a),
  },
}));

// Só a lib pura (buildTicketInsert + labels) — sem puxar o barrel inteiro.
vi.mock("@/modules/platform", async () => await import("@/modules/platform/lib/support-ticket-draft"));

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

const newQc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const draft = {
  title: "Kanban trava ao arrastar card",
  description: "Congela ao sair de abordado.",
  tipo: "bug" as const,
  impacto: "parado" as const,
};

const gestorReady = () => gestorMock.mockReturnValue({ isGestor: true, gestorId: "g-1" });
const authed = () => authMock.mockReturnValue({ user: { id: "user-1" } });

beforeEach(() => {
  gestorMock.mockReset();
  authMock.mockReset();
  mock = createMockSupabase();
  mock.mockTable("support_tickets", []);
});

describe("useCreateGestorSupportTicket", () => {
  it("ancora na org escolhida e grava o marcador de autor-gestor", async () => {
    gestorReady();
    authed();
    const { result } = renderHook(() => useCreateGestorSupportTicket(), { wrapper: wrap(newQc()) });

    await result.current.mutateAsync({
      draft,
      organizationId: "o1",
      boundOrgIds: ["o1", "o2"],
      supportContext: { route: "/gestor" },
    });

    const [row] = mock.getInserted("support_tickets");
    expect(row.organization_id).toBe("o1");
    expect(row.author_user_id).toBe("user-1");
    expect(row.author_gestor_id).toBe("g-1");
    expect(row.support_context).toEqual({ route: "/gestor" });
    expect(row.tipo).toBe("bug");
  });

  // O trigger do banco recusa esses campos; o payload nem tenta.
  it("nunca envia severidade nem defect_url nem status", async () => {
    gestorReady();
    authed();
    const { result } = renderHook(() => useCreateGestorSupportTicket(), { wrapper: wrap(newQc()) });

    await result.current.mutateAsync({ draft, organizationId: "o1", boundOrgIds: ["o1"] });

    const [row] = mock.getInserted("support_tickets");
    expect(row).not.toHaveProperty("severidade");
    expect(row).not.toHaveProperty("defect_url");
    expect(row).not.toHaveProperty("status");
  });

  it("recusa org fora dos vínculos do gestor (nunca org-less nem inventada)", async () => {
    gestorReady();
    authed();
    const { result } = renderHook(() => useCreateGestorSupportTicket(), { wrapper: wrap(newQc()) });

    await expect(
      result.current.mutateAsync({ draft, organizationId: "o9", boundOrgIds: ["o1", "o2"] }),
    ).rejects.toThrow(/fora dos vinculos/);
    expect(mock.getInserted("support_tickets")).toHaveLength(0);
  });

  it("recusa organização vazia (sem chamado org-less)", async () => {
    gestorReady();
    authed();
    const { result } = renderHook(() => useCreateGestorSupportTicket(), { wrapper: wrap(newQc()) });

    await expect(
      result.current.mutateAsync({ draft, organizationId: "", boundOrgIds: ["o1"] }),
    ).rejects.toThrow(/selecione a organizacao/);
    expect(mock.getInserted("support_tickets")).toHaveLength(0);
  });

  it("recusa um rascunho inválido antes de tocar a rede", async () => {
    gestorReady();
    authed();
    const { result } = renderHook(() => useCreateGestorSupportTicket(), { wrapper: wrap(newQc()) });

    await expect(
      result.current.mutateAsync({ draft: { ...draft, title: "ab" }, organizationId: "o1", boundOrgIds: ["o1"] }),
    ).rejects.toThrow(/invalido/);
    expect(mock.getInserted("support_tickets")).toHaveLength(0);
  });

  it("recusa quando o gestor não carregou", async () => {
    gestorMock.mockReturnValue({ isGestor: true, gestorId: null });
    authed();
    const { result } = renderHook(() => useCreateGestorSupportTicket(), { wrapper: wrap(newQc()) });

    await expect(
      result.current.mutateAsync({ draft, organizationId: "o1", boundOrgIds: ["o1"] }),
    ).rejects.toThrow(/gestor nao carregado/);
  });

  it("recusa quando não há usuário autenticado", async () => {
    gestorReady();
    authMock.mockReturnValue({ user: null });
    const { result } = renderHook(() => useCreateGestorSupportTicket(), { wrapper: wrap(newQc()) });

    await expect(
      result.current.mutateAsync({ draft, organizationId: "o1", boundOrgIds: ["o1"] }),
    ).rejects.toThrow(/autenticado/);
  });
});

describe("useGestorSupportTickets", () => {
  it("não consulta quando o usuário não é gestor", () => {
    gestorMock.mockReturnValue({ isGestor: false, gestorId: null });
    const { result } = renderHook(() => useGestorSupportTickets(), { wrapper: wrap(newQc()) });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("devolve os chamados que a RLS entregou ao gestor", async () => {
    gestorReady();
    mock.mockTable("support_tickets", [
      { id: "t1", title: "Primeiro", status: "aberto", created_at: "2026-07-01T00:00:00Z" },
      { id: "t2", title: "Segundo", status: "resolvido", created_at: "2026-07-02T00:00:00Z" },
    ]);

    const { result } = renderHook(() => useGestorSupportTickets(), { wrapper: wrap(newQc()) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toHaveLength(2);
  });
});
