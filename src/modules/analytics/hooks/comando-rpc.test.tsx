import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createClient } from "@supabase/supabase-js";

const transport = vi.fn();
// Cliente real: um mock de rpc que não usa `this` esconderia a regressão.
const client = createClient("https://comando.example.test", "test-anon-key", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (...args) => transport(...args) },
});
vi.mock("@/integrations/supabase/client", () => ({ get supabase() { return client; } }));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-a", isReady: true }),
  useCurrentTeamMember: () => ({ data: { organization_id: "org-a" } }),
  useTeamMembers: () => ({ data: [] }),
}));
vi.mock("@/modules/communication", () => ({
  useWhatsAppInstancesForUser: () => ({ data: [{ id: "chip-a", instance_name: "Vendas" }], isLoading: false }),
}));
vi.mock("./useComandoScope", () => ({
  useComandoScope: () => ({ escopo: "meu", isAdmin: false, meuTeamMemberId: "membro-a", meuUserId: "user-a", isReady: true }),
}));
import { useComandoAgenda } from "./useComandoAgenda";
import { useConversasAguardando } from "./useConversasAguardando";

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("Comando — RPC preserva o receptor do cliente Supabase", () => {
  beforeEach(() => transport.mockReset().mockImplementation(async () => new Response("[]", {
    status: 200, headers: { "Content-Type": "application/json" },
  })));

  it("agenda chega ao transporte e conclui sem erro", async () => {
    const { result } = renderHook(() => useComandoAgenda(new Date("2026-09-04T12:00:00Z"), new Date("2026-09-18T12:00:00Z")), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(String(transport.mock.calls[0]?.[0])).toContain("/rpc/get_comando_agenda_events");
  });

  it("fila de respostas chega ao transporte e conclui sem erro", async () => {
    const { result } = renderHook(() => useConversasAguardando(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(String(transport.mock.calls[0]?.[0])).toContain("/rpc/get_conversations_awaiting_human_reply");
  });

  it("uma falha real do servidor continua visível, não vira fila vazia", async () => {
    transport.mockImplementation(async () => new Response(JSON.stringify({ message: "permission denied", code: "42501" }), { status: 403 }));
    const { result } = renderHook(() => useConversasAguardando(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.semChips).toBe(false);
  });
});
