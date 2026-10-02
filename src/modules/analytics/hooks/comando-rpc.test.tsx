import type { ReactNode } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComandoAgenda } from "./useComandoAgenda";
import { useConversasAguardando } from "./useConversasAguardando";
import { addErrorReporter, type ErrorReport } from "@/shared/errors";

const { fetchMock, chips } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  chips: { value: [{ id: "chip-1", instance_name: "Comercial" }] },
}));

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
  useWhatsAppInstancesForUser: () => ({ data: chips.value, isLoading: false }),
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
  chips.value = [{ id: "chip-1", instance_name: "Comercial" }];
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
      if (url.includes("/rpc/get_conversations_awaiting_human_reply_multi")) {
        return json([null, "lead-1"].map((lead_id, i) => ({
          instance_id: "chip-1", lead_id, normalized_phone: `551199999000${i}`, phone_number: `551199999000${i}`,
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
    expect(fetchMock.mock.calls[0][0]).toContain("/rpc/get_conversations_awaiting_human_reply_multi");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      p_org: "org-1", p_instances: ["chip-1"], p_limit: 30,
    });
  });

  it("preserves a real server error instead of reporting an empty agenda", async () => {
    fetchMock.mockImplementation(async () => json({ code: "42501", message: "Forbidden" }, 403));
    const { result } = renderHook(() => useComandoAgenda(inicio, fim), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.isDegraded).toBe(false);
  });

  it("skips lead enrichment when the RPC already supplies every displayed field", async () => {
    fetchMock.mockResolvedValue(json([{
      lead_id: "lead-1", normalized_phone: "5511999990001", phone_number: "5511999990001",
      push_name: "Nome WhatsApp", last_client_message_at: inicio.toISOString(),
      waiting_total: 1, owner_team_member_id: "member-1", owner_name: "Ana",
    }]));
    const { result } = renderHook(() => useConversasAguardando(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items).toEqual([expect.objectContaining({
      displayName: "Nome WhatsApp", ownerTeamMemberId: "member-1", ownerName: "Ana",
    })]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("enriches only incomplete rows, retaining null-owner and legacy-owner fallbacks", async () => {
    const rows = [
      { lead_id: "complete", push_name: "Completo", owner_team_member_id: "member-1" },
      { lead_id: "missing-name", push_name: null, owner_team_member_id: "member-1" },
      { lead_id: "null-owner", push_name: "Sem dono", owner_team_member_id: null },
      { lead_id: "legacy-owner", push_name: "Legado" },
      { lead_id: "empty-name", push_name: "", owner_team_member_id: "member-1" },
    ];
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/rpc/")) return json(rows.map((r, i) => ({
        ...r, normalized_phone: `551199999000${i}`, waiting_total: rows.length,
        last_client_message_at: inicio.toISOString(),
      })));
      if (url.includes("/leads?")) {
        const request = new URL(url);
        expect(request.searchParams.get("id")).toBe('in.(missing-name,null-owner,legacy-owner)');
        expect(request.searchParams.get("organization_id")).toBe("eq.org-1");
        return json(rows.map(r => ({
          id: r.lead_id, name: "Nome CRM", pre_sale_responsible_id: "member-fallback",
        })));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useConversasAguardando(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(false);
    const byLead = new Map(result.current.items.map(row => [row.leadId, row]));
    expect(byLead.get("missing-name")?.displayName).toBe("Nome CRM");
    expect(byLead.get("null-owner")?.ownerTeamMemberId).toBe("member-fallback");
    expect(byLead.get("legacy-owner")?.ownerTeamMemberId).toBe("member-fallback");
    expect(byLead.get("empty-name")?.displayName).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("keeps waiting-queue server errors visible", async () => {
    fetchMock.mockImplementation(async () => json({ code: "42501", message: "Forbidden" }, 403));
    const { result } = renderHook(() => useConversasAguardando(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.semChips).toBe(false);
    expect(result.current.isDegraded).toBe(false);
  });


  // Incidente 2026-10-02: 57 caixas viravam 57 RPCs de 12 s cada.
  it("asks for every box in ONE multi-box RPC and labels each row with its own box", async () => {
    chips.value = Array.from({ length: 57 }, (_, i) => ({
      id: `chip-${i}`, instance_name: `Caixa ${i}`,
    }));
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/rpc/get_conversations_awaiting_human_reply_multi")) {
        return json([
          { instance_id: "chip-7", lead_id: "lead-a", normalized_phone: "5511999990001",
            phone_number: "5511999990001", push_name: "A", waiting_total: 2,
            owner_team_member_id: "member-1", owner_name: "Ana",
            last_client_message_at: "2026-09-08T12:00:00Z" },
          { instance_id: "chip-42", lead_id: "lead-b", normalized_phone: "5511999990001",
            phone_number: "5511999990001", push_name: "B", waiting_total: 2,
            owner_team_member_id: "member-1", owner_name: "Ana",
            last_client_message_at: "2026-09-08T13:00:00Z" },
        ]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useConversasAguardando(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.p_instances).toHaveLength(57);
    expect(body).not.toHaveProperty("p_instance");
    // Mesmo telefone em duas caixas = duas conversas, cada uma na SUA caixa.
    expect(result.current.items.map((r) => [r.key, r.instanceId, r.instanceName])).toEqual([
      ["chip-42:5511999990001", "chip-42", "Caixa 42"],
      ["chip-7:5511999990001", "chip-7", "Caixa 7"],
    ]);
    expect(result.current.chipsComErro).toBe(0);
  });

  it("falls back to the per-box RPC only while the multi-box one is not deployed", async () => {
    chips.value = [
      { id: "chip-1", instance_name: "Comercial" },
      { id: "chip-2", instance_name: "Suporte" },
    ];
    fetchMock.mockImplementation(async (url: string, init: { body: string }) => {
      if (url.includes("/rpc/get_conversations_awaiting_human_reply_multi")) {
        return json({ code: "PGRST202", message: "Could not find the function" }, 404);
      }
      if (url.includes("/rpc/get_conversations_awaiting_human_reply")) {
        const { p_instance } = JSON.parse(init.body);
        if (p_instance === "chip-2") return json({ code: "XX000", message: "boom" }, 500);
        return json([{ lead_id: "lead-1", normalized_phone: "5511999990001",
          phone_number: "5511999990001", push_name: "A", waiting_total: 1,
          owner_team_member_id: "member-1", owner_name: "Ana",
          last_client_message_at: "2026-09-08T12:00:00Z" }]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useConversasAguardando(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(result.current.chipsComErro).toBe(1);
    expect(result.current.items).toEqual([expect.objectContaining({
      key: "chip-1:5511999990001", instanceId: "chip-1", instanceName: "Comercial",
    })]);
  });

  it("does not call the server at all when the user has no box", async () => {
    chips.value = [];
    const { result } = renderHook(() => useConversasAguardando(), { wrapper });
    await waitFor(() => expect(result.current.semChips).toBe(true));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });


  // Revisor, volta 1: o fallback para o fan-out só pode abrir com a função
  // AUSENTE do schema (PGRST202). 42883 também é erro de runtime dentro do
  // corpo, e 42703 é coluna inexistente — defeito da multi, que precisa
  // aparecer como erro em vez de virar N × 12 s de banco em silêncio.
  it.each([
    ["42883", "function public.whatsapp_chip_instance_ids(uuid) does not exist"],
    ["42703", "column m.foo does not exist"],
    ["42P01", "relation \"public.x\" does not exist"],
  ])("multi-box RPC runtime error %s surfaces as error, never fans out per box", async (code, message) => {
    chips.value = [
      { id: "chip-1", instance_name: "Comercial" },
      { id: "chip-2", instance_name: "Suporte" },
    ];
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/rpc/get_conversations_awaiting_human_reply_multi")) {
        return json({ code, message }, 400);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useConversasAguardando(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/rpc/get_conversations_awaiting_human_reply_multi");
    expect(result.current.isDegraded).toBe(false);
  });

  it("PGRST202 (multi not deployed) falls back per box and reports it", async () => {
    const reports: ErrorReport[] = [];
    const remover = addErrorReporter((r) => reports.push(r));
    chips.value = [
      { id: "chip-1", instance_name: "Comercial" },
      { id: "chip-2", instance_name: "Suporte" },
    ];
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/rpc/get_conversations_awaiting_human_reply_multi")) {
        return json({ code: "PGRST202", message: "Could not find the function" }, 404);
      }
      if (url.includes("/rpc/get_conversations_awaiting_human_reply")) return json([]);
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useConversasAguardando(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    remover();
    expect(result.current.isError).toBe(false);
    const porChip = fetchMock.mock.calls.filter(
      ([u]) => /\/rpc\/get_conversations_awaiting_human_reply$/.test(String(u).split("?")[0]),
    );
    expect(porChip).toHaveLength(2);
    expect(reports.map((r) => r.context.fallback)).toEqual(["awaiting-multi-ausente"]);
  });

});
