import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---------------------------------------------------------------------------
// Supabase chain mock — captura argumentos das chamadas e devolve `messages`
// configuráveis por teste.
// ---------------------------------------------------------------------------
type MsgRow = { instance_id: string | null; phone_number: string; timestamp: string };

let messagesData: MsgRow[] = [];
const captured: { in: string[]; like: string[]; eq: Array<[string, unknown]> } = {
  in: [],
  like: [],
  eq: [],
};

function createChainMock() {
  const chain: Record<string, any> = {};
  ["select", "order", "not", "limit"].forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.eq = vi.fn((col: string, val: unknown) => {
    captured.eq.push([col, val]);
    return chain;
  });
  chain.in = vi.fn((_col: string, vals: string[]) => {
    captured.in = vals;
    return chain;
  });
  chain.like = vi.fn((_col: string, pattern: string) => {
    captured.like.push(pattern);
    return chain;
  });
  chain.then = (resolve: any, reject?: any) =>
    Promise.resolve({ data: messagesData, error: null }).then(resolve, reject);
  return chain;
}

const mockFrom = vi.fn().mockImplementation(() => createChainMock());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(...args),
  },
}));

vi.mock("@/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({
    data: { id: "tm1", organization_id: "org-t", role: "admin", user_id: "u1" },
  }),
  isVirtualTeamMember: (id: string) => id?.startsWith("master-virtual-"),
}));

import { useResolveChatDeepLink } from "@/hooks/chat/useResolveChatDeepLink";
import type { WhatsAppInstanceForUser } from "@/hooks/chat/types";

const wrapper =
  (qc: QueryClient) =>
  ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);

const newQc = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });

const allowed = (ids: string[]): WhatsAppInstanceForUser[] =>
  ids.map((id, i) => ({ id, instance_name: `inst-${i}`, status: "connected" }));

beforeEach(() => {
  messagesData = [];
  captured.in = [];
  captured.like = [];
  captured.eq = [];
  mockFrom.mockClear();
});

describe("useResolveChatDeepLink", () => {
  it("retorna null quando phone vazio", async () => {
    const qc = newQc();
    const { result } = renderHook(
      () =>
        useResolveChatDeepLink({
          phone: null,
          allowedInstances: allowed(["i1", "i2"]),
        }),
      { wrapper: wrapper(qc) },
    );
    // Query disabled — fica idle, data undefined.
    expect(result.current.data).toBeUndefined();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("retorna null quando não há instâncias permitidas", async () => {
    const qc = newQc();
    renderHook(
      () =>
        useResolveChatDeepLink({
          phone: "5511987654321",
          allowedInstances: [],
        }),
      { wrapper: wrapper(qc) },
    );
    // Sem allowed, query desabilitada.
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("encontra instância correta quando há mensagens em uma das permitidas", async () => {
    messagesData = [
      {
        instance_id: "i2",
        phone_number: "5511987654321",
        timestamp: "2026-04-28T10:00:00Z",
      },
    ];
    const qc = newQc();
    const { result } = renderHook(
      () =>
        useResolveChatDeepLink({
          phone: "5511987654321",
          allowedInstances: allowed(["i1", "i2"]),
        }),
      { wrapper: wrapper(qc) },
    );

    await waitFor(() => expect(result.current.isFetched).toBe(true));
    expect(result.current.data).toEqual({
      instanceId: "i2",
      phoneNumber: "5511987654321",
    });
    // Filtro server-side: organization_id presente
    expect(captured.eq.some(([c, v]) => c === "organization_id" && v === "org-t")).toBe(true);
    // Restringido às instâncias permitidas
    expect(captured.in).toEqual(["i1", "i2"]);
    // LIKE com últimos 8 dígitos (87654321)
    expect(captured.like[0]).toBe("%87654321%");
  });

  it("compara por phone normalizado (formato com/sem 55 e com/sem 9)", async () => {
    // DB tem phone_number sem 55, mas link veio com 55 e 9.
    messagesData = [
      {
        instance_id: "i1",
        phone_number: "11987654321",
        timestamp: "2026-04-28T10:00:00Z",
      },
    ];
    const qc = newQc();
    const { result } = renderHook(
      () =>
        useResolveChatDeepLink({
          phone: "5511987654321",
          allowedInstances: allowed(["i1"]),
        }),
      { wrapper: wrapper(qc) },
    );
    await waitFor(() => expect(result.current.isFetched).toBe(true));
    expect(result.current.data).toEqual({
      instanceId: "i1",
      phoneNumber: "11987654321",
    });
  });

  it("descarta linha cuja instance_id NÃO está na lista permitida (defesa em profundidade)", async () => {
    // Server por algum motivo retornou linha de instância não permitida.
    messagesData = [
      {
        instance_id: "FORBIDDEN",
        phone_number: "5511987654321",
        timestamp: "2026-04-28T10:00:00Z",
      },
    ];
    const qc = newQc();
    const { result } = renderHook(
      () =>
        useResolveChatDeepLink({
          phone: "5511987654321",
          allowedInstances: allowed(["i1", "i2"]),
        }),
      { wrapper: wrapper(qc) },
    );
    await waitFor(() => expect(result.current.isFetched).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("retorna null quando nenhum match exato após normalização", async () => {
    // Phone diferente, só compartilha últimos 8 dígitos (false positive do LIKE).
    messagesData = [
      {
        instance_id: "i1",
        phone_number: "5521987654321",
        timestamp: "2026-04-28T10:00:00Z",
      },
    ];
    const qc = newQc();
    const { result } = renderHook(
      () =>
        useResolveChatDeepLink({
          phone: "5511987654321",
          allowedInstances: allowed(["i1"]),
        }),
      { wrapper: wrapper(qc) },
    );
    await waitFor(() => expect(result.current.isFetched).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("não dispara quando enabled=false", async () => {
    const qc = newQc();
    renderHook(
      () =>
        useResolveChatDeepLink({
          phone: "5511987654321",
          allowedInstances: allowed(["i1"]),
          enabled: false,
        }),
      { wrapper: wrapper(qc) },
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("escolhe match mais recente por timestamp (resultados ordenados desc)", async () => {
    messagesData = [
      {
        instance_id: "i2",
        phone_number: "5511987654321",
        timestamp: "2026-04-28T11:00:00Z",
      },
      {
        instance_id: "i1",
        phone_number: "5511987654321",
        timestamp: "2026-04-28T08:00:00Z",
      },
    ];
    const qc = newQc();
    const { result } = renderHook(
      () =>
        useResolveChatDeepLink({
          phone: "5511987654321",
          allowedInstances: allowed(["i1", "i2"]),
        }),
      { wrapper: wrapper(qc) },
    );
    await waitFor(() => expect(result.current.isFetched).toBe(true));
    expect(result.current.data?.instanceId).toBe("i2");
  });
});
