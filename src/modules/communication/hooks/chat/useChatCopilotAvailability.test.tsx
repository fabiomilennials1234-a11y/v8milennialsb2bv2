import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockSupabase } from "../../../../../tests/helpers/supabase-mock";
import { useChatCopilotAvailability } from "./useChatCopilotAvailability";

const client = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

let db: ReturnType<typeof createMockSupabase>;
const activeAgent = {
  id: "agent-a",
  organization_id: "org-a",
  is_active: true,
  finalized_at: "2026-10-20T12:00:00Z",
};

function setup(organizationId: string | null = "org-a") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return {
    queryClient,
    ...renderHook(({ orgId }) => useChatCopilotAvailability(orgId), {
      wrapper,
      initialProps: { orgId: organizationId },
    }),
  };
}

beforeEach(() => {
  db = createMockSupabase();
  client.from.mockReset().mockImplementation(db.sb.from);
});

describe("useChatCopilotAvailability", () => {
  it("não confirma IA enquanto consulta a organização", async () => {
    db.mockTable("copilot_agents", [activeAgent]);
    const { result } = setup();
    expect(result.current).toBe("loading");
    await waitFor(() => expect(result.current).toBe("available"));
  });

  it.each([
    ["nenhum agente", []],
    ["agente inativo", [{ ...activeAgent, is_active: false }]],
    ["rascunho ainda não finalizado", [{ ...activeAgent, finalized_at: null }]],
    ["agente de outra organização", [{ ...activeAgent, organization_id: "org-b" }]],
  ])("fica indisponível com %s", async (_name, rows) => {
    db.mockTable("copilot_agents", rows);
    const { result } = setup();
    await waitFor(() => expect(result.current).toBe("unavailable"));
  });

  it("não consulta sem organização e não reutiliza o agente da organização anterior", async () => {
    db.mockTable("copilot_agents", [activeAgent]);
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current).toBe("available"));
    rerender({ orgId: "org-b" });
    expect(result.current).toBe("loading");
    await waitFor(() => expect(result.current).toBe("unavailable"));
    client.from.mockClear();
    rerender({ orgId: null });
    expect(result.current).toBe("unavailable");
    expect(client.from).not.toHaveBeenCalled();
  });

  it("reflete ativação e desativação pelas invalidações existentes do Copilot", async () => {
    const { result, queryClient } = setup();
    await waitFor(() => expect(result.current).toBe("unavailable"));
    db.mockTable("copilot_agents", [activeAgent]);
    await act(() => queryClient.invalidateQueries({ queryKey: ["copilot_agents"] }));
    await waitFor(() => expect(result.current).toBe("available"));
    db.mockTable("copilot_agents", [{ ...activeAgent, is_active: false }]);
    await act(() => queryClient.invalidateQueries({ queryKey: ["copilot_agents"] }));
    await waitFor(() => expect(result.current).toBe("unavailable"));
  });

  it("falha de consulta não confirma IA ativa, mesmo com agente antigo em cache", async () => {
    db.mockTable("copilot_agents", [activeAgent]);
    const { result, queryClient } = setup();
    await waitFor(() => expect(result.current).toBe("available"));
    db.mockSelectError("copilot_agents", { code: "503", message: "Unavailable" });
    await act(() => queryClient.invalidateQueries({ queryKey: ["copilot_agents"] }));
    await waitFor(() => expect(result.current).toBe("error"));
  });
});
