import type { ReactNode } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComandoAgenda } from "./useComandoAgenda";
import { useConversasAguardando } from "./useConversasAguardando";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

// Keep the real SDK: replacing rpc with a mock hides loss of its `this` receiver.
vi.mock("@/integrations/supabase/client", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return {
    supabase: createClient("https://comando.example.com", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchMock },
    }),
  };
});
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
  useTeamMembers: () => ({ data: [{ id: "member-1", name: "Ana" }] }),
  useCurrentTeamMember: () => ({ data: { organization_id: "org-1" } }),
}));
vi.mock("@/modules/communication", () => ({
  useWhatsAppInstancesForUser: () => ({
    data: [{ id: "chip-1", instance_name: "Comercial" }], isLoading: false,
  }),
}));
vi.mock("./useComandoScope", () => ({
  useComandoScope: () => ({
    escopo: "tudo", isAdmin: true, meuTeamMemberId: "member-1",
    meuUserId: "user-1", isReady: true,
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
let client: QueryClient;
const inicio = new Date("2026-09-08T12:00:00Z");
const fim = new Date("2026-09-22T12:00:00Z");
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
});

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  fetchMock.mockReset();
});
afterEach(() => { cleanup(); client.clear(); });

describe("Comando RPC transport", () => {
  it("loads every internal agenda source, including events without a lead", async () => {
    const sources = ["meeting", "follow_up", "scheduled_message", "pipe_confirmacao", "meeting_event"];
    fetchMock.mockResolvedValue(json(sources.map((source, i) => ({
      id: `event-${i}`, source, title: `Compromisso ${i}`, start_at: inicio.toISOString(),
      lead_id: null, owner_team_member_id: "member-1", creator_name: null,
    }))));
    const { result } = renderHook(() => useComandoAgenda(inicio, fim), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(result.current.data.map(e => e.source)).toEqual(sources);
    expect(result.current.data.every(e => e.owner_name === "Ana")).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain("/rpc/get_comando_agenda_events");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      p_organization_id: "org-1", p_start: inicio.toISOString(), p_end: fim.toISOString(),
    });
  });

  it("loads waiting conversations and only displays those linked to leads", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/rpc/get_conversations_awaiting_human_reply")) {
        return json([null, "lead-1"].map((lead_id, i) => ({
          lead_id, normalized_phone: `551199999000${i}`, phone_number: `551199999000${i}`,
          push_name: null, last_client_message: "Preciso de ajuda",
          last_client_message_at: inicio.toISOString(), ai_replied: i === 1,
          ai_replied_at: null, waiting_total: 2, owner_team_member_id: "member-1",
        })));
      }
      if (url.includes("/leads?")) return json([{ id: "lead-1", name: "Lead cadastrado" }]);
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useConversasAguardando(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(result.current.total).toBe(1);
    expect(result.current.items).toEqual([expect.objectContaining({
      leadId: "lead-1", displayName: "Lead cadastrado", aiReplied: true,
      lastClientMessage: "Preciso de ajuda",
    })]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      p_org: "org-1", p_instance: "chip-1", p_limit: 30,
    });
  });

  it("preserves a real server error instead of reporting an empty agenda", async () => {
    fetchMock.mockImplementation(async () => json({ code: "42501", message: "Forbidden" }, 403));
    const { result } = renderHook(() => useComandoAgenda(inicio, fim), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.isDegraded).toBe(false);
  });
  it("keeps waiting-queue server errors visible", async () => {
    fetchMock.mockImplementation(async () => json({ code: "42501", message: "Forbidden" }, 403));
    const { result } = renderHook(() => useConversasAguardando(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.semChips).toBe(false);
    expect(result.current.isDegraded).toBe(false);
  });

});
