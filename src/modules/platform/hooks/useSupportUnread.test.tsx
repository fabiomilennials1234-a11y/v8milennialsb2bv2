import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createMockSupabase } from "../../../../tests/helpers/supabase-mock";
import { useSupportUnread, useMarkSupportRepliesRead } from "./useSupportUnread";

const authMock = vi.fn();
vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({
  useAuth: (...a: unknown[]) => authMock(...a),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

const realtimeMock = vi.fn();
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({
  useRealtimeSubscription: (...a: unknown[]) => realtimeMock(...a),
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
const authed = () => authMock.mockReturnValue({ user: { id: "user-1" } });

const reply = (entityId: string | null, readAt: string | null = null) => ({
  id: crypto.randomUUID(),
  type: "support_ticket_reply",
  entity_id: entityId,
  read_at: readAt,
});

beforeEach(() => {
  authMock.mockReset();
  realtimeMock.mockReset();
  mock = createMockSupabase();
  mock.mockTable("notifications", []);
});

describe("useSupportUnread", () => {
  it("não consulta sem usuário autenticado", () => {
    authMock.mockReturnValue({ user: null });
    const { result } = renderHook(() => useSupportUnread(), { wrapper: wrap(newQc()) });
    expect(result.current.total).toBe(0);
  });

  it("agrega as respostas não lidas por chamado", async () => {
    authed();
    mock.mockTable("notifications", [reply("t1"), reply("t1"), reply("t2")]);

    const { result } = renderHook(() => useSupportUnread(), { wrapper: wrap(newQc()) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.byTicket).toEqual({ t1: 2, t2: 1 });
    expect(result.current.total).toBe(3);
  });

  it("ignora as já lidas", async () => {
    authed();
    mock.mockTable("notifications", [reply("t1"), reply("t2", "2026-07-09T00:00:00Z")]);

    const { result } = renderHook(() => useSupportUnread(), { wrapper: wrap(newQc()) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.byTicket).toEqual({ t1: 1 });
  });

  it("ignora notificações de outros tipos", async () => {
    authed();
    mock.mockTable("notifications", [
      { id: "n1", type: "meeting_today", entity_id: "t1", read_at: null },
      reply("t2"),
    ]);

    const { result } = renderHook(() => useSupportUnread(), { wrapper: wrap(newQc()) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.byTicket).toEqual({ t2: 1 });
  });

  // O badge acende no instante em que a resposta entra, e o polling de 60s do
  // sino vira rede de seguranca em vez de mecanismo.
  it("assina o Realtime de notifications e invalida também o sino do topo", () => {
    authed();
    renderHook(() => useSupportUnread(), { wrapper: wrap(newQc()) });

    expect(realtimeMock).toHaveBeenCalledWith("notifications", [
      "support-unread-replies",
      "user-alerts",
    ]);
  });

  // A RLS de `notifications` e `user_id = auth.uid()`. Um `.eq("user_id", ...)`
  // aqui daria a impressao de que o isolamento e do cliente.
  it("não filtra por usuário — a visibilidade é da RLS", async () => {
    authed();
    mock.mockTable("notifications", [{ ...reply("t1"), user_id: "outro-usuario" }]);

    const { result } = renderHook(() => useSupportUnread(), { wrapper: wrap(newQc()) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.total).toBe(1);
  });
});

describe("useMarkSupportRepliesRead", () => {
  it("marca como lidas as respostas daquele chamado", async () => {
    authed();
    mock.mockTable("notifications", [reply("t1"), reply("t1")]);

    const { result } = renderHook(() => useMarkSupportRepliesRead(), { wrapper: wrap(newQc()) });
    await result.current.mutateAsync("t1");

    const updated = mock.getUpdated("notifications");
    expect(updated.length).toBeGreaterThan(0);
    expect(updated[0].read_at).toBeTruthy();
  });

  it("não toca nas respostas de outro chamado", async () => {
    authed();
    mock.mockTable("notifications", [reply("t1"), reply("t2")]);

    const { result } = renderHook(() => useMarkSupportRepliesRead(), { wrapper: wrap(newQc()) });
    await result.current.mutateAsync("t1");

    expect(mock.getUpdated("notifications").every((r) => r.entity_id === "t1")).toBe(true);
  });
});
