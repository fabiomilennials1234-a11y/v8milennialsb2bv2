/**
 * useChatBubbleContactsRealtime — patch realtime cross-instâncias do Bubble.
 *
 * Cobre: guards (sem org / sem instances), filtro de instance_id,
 * incremento de unread_count condicional ao activePhone, channel name,
 * cleanup, ignore de DELETE.
 */

// ⚠️ A chave é a da BOLHA (`bubbleContacts`), e não a da lista do `/chat`.
// Até a W4 as duas telas dividiam a mesma entrada de cache com dados de origens
// diferentes — a bolha filtra arquivadas fora e contava não-lidas pelo
// `localStorage`. Este patcher escreve só no cache da bolha.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

// vi.hoisted garante que mocks rodem ANTES do top-level import dos módulos sob teste
const mocks = vi.hoisted(() => {
  type Handler = (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;
  const channelMock = {
    _handlers: [] as Handler[],
    _name: "" as string,
    _removed: false,
    on: vi.fn(),
    subscribe: vi.fn(),
    trigger(payload: RealtimePostgresChangesPayload<Record<string, unknown>>) {
      this._handlers.forEach((h) => h(payload));
    },
  };
  channelMock.on.mockImplementation(function (
    this: typeof channelMock,
    _event: string,
    _filter: unknown,
    handler: Handler,
  ) {
    this._handlers.push(handler);
    return this;
  });
  channelMock.subscribe.mockImplementation(function (this: typeof channelMock) {
    return this;
  });

  const supabaseMock = {
    channel: vi.fn((name: string) => {
      channelMock._handlers = [];
      channelMock._name = name;
      channelMock._removed = false;
      // Re-bind chain methods porque vi.fn limpa entre calls
      channelMock.on.mockClear();
      channelMock.subscribe.mockClear();
      channelMock.on.mockImplementation(function (
        this: typeof channelMock,
        _event: string,
        _filter: unknown,
        handler: Handler,
      ) {
        this._handlers.push(handler);
        return this;
      });
      channelMock.subscribe.mockImplementation(function (this: typeof channelMock) {
        return this;
      });
      return channelMock;
    }),
    removeChannel: vi.fn((_ch: typeof channelMock) => {
      channelMock._removed = true;
    }),
  };

  const teamMemberRef: { value: { id: string; organization_id: string } | null } = {
    value: { id: "tm1", organization_id: "org-A" },
  };

  return { channelMock, supabaseMock, teamMemberRef };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: mocks.supabaseMock,
}));

vi.mock("@/modules/identity/org-team/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({ data: mocks.teamMemberRef.value }),
}));

import { useChatBubbleContactsRealtime } from "@/modules/communication/hooks/chat/useChatBubbleContactsRealtime";
import { chatQueryKeys } from "@/modules/communication/hooks/chat/shared/queryKeys";
import type { ChatContact } from "@/modules/communication/hooks/chat/types";

// ── Wrapper ─────────────────────────────────────────────────────────────────
function newQc() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
}

const wrapper =
  (qc: QueryClient) =>
  ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);

// ── Helpers ─────────────────────────────────────────────────────────────────
function makeContact(phone: string, unread = 0): ChatContact {
  return {
    phone_number: phone,
    push_name: null,
    last_message: "old",
    last_message_time: "2026-04-01T00:00:00Z",
    last_message_direction: "incoming",
    last_message_sent_source: null,
    unread_count: unread,
    lead_id: null,
    lead_name: null,
    conversation_id: null,
    archived_at: null,
    tags: [],
    is_group: false,
  };
}

function payloadInsert(
  instance_id: string | null,
  phone_number: string,
  direction: "incoming" | "outgoing" = "incoming",
  timestamp = "2026-05-01T12:00:00Z",
  content = "new msg",
): RealtimePostgresChangesPayload<Record<string, unknown>> {
  return {
    schema: "public",
    table: "whatsapp_messages",
    commit_timestamp: timestamp,
    eventType: "INSERT",
    new: {
      id: "msg-1",
      instance_id,
      phone_number,
      direction,
      content,
      timestamp,
    } as unknown as Record<string, unknown>,
    old: {},
    errors: [],
  };
}

beforeEach(() => {
  mocks.teamMemberRef.value = { id: "tm1", organization_id: "org-A" };
  mocks.channelMock._handlers = [];
  mocks.channelMock._removed = false;
  mocks.supabaseMock.channel.mockClear();
  mocks.supabaseMock.removeChannel.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────────────
describe("useChatBubbleContactsRealtime", () => {
  it("não cria channel sem organizationId", () => {
    mocks.teamMemberRef.value = null;
    const qc = newQc();
    renderHook(() => useChatBubbleContactsRealtime(["i1"], null), {
      wrapper: wrapper(qc),
    });
    expect(mocks.supabaseMock.channel).not.toHaveBeenCalled();
  });

  it("não cria channel quando instanceIds está vazio", () => {
    const qc = newQc();
    renderHook(() => useChatBubbleContactsRealtime([], null), {
      wrapper: wrapper(qc),
    });
    expect(mocks.supabaseMock.channel).not.toHaveBeenCalled();
  });

  it("creates a channel when org + instances are available", () => {
    const qc = newQc();
    renderHook(() => useChatBubbleContactsRealtime(["i1"], null), {
      wrapper: wrapper(qc),
    });
    // Channel name is now managed by useRealtimeChannel (includes table + filter)
    expect(mocks.supabaseMock.channel).toHaveBeenCalledTimes(1);
    const channelName = mocks.supabaseMock.channel.mock.calls[0][0] as string;
    expect(channelName).toContain("whatsapp_messages");
    expect(channelName).toContain("org-A");
  });

  it("INSERT em msg cuja instance_id ∈ instanceIds patcheia queryKey correta", () => {
    const qc = newQc();
    const queryKey = chatQueryKeys.bubbleContacts("org-A", "i1");
    qc.setQueryData<ChatContact[]>(queryKey, [makeContact("11999")]);

    renderHook(() => useChatBubbleContactsRealtime(["i1", "i2"], null), {
      wrapper: wrapper(qc),
    });
    mocks.channelMock.trigger(payloadInsert("i1", "11999", "incoming"));

    const updated = qc.getQueryData<ChatContact[]>(queryKey);
    expect(updated?.[0].unread_count).toBe(1);
    expect(updated?.[0].last_message).toBe("new msg");
  });

  it("INSERT em msg cuja instance_id ∉ instanceIds é IGNORADO (defesa segurança)", () => {
    const qc = newQc();
    const allowedKey = chatQueryKeys.bubbleContacts("org-A", "i1");
    const forbiddenKey = chatQueryKeys.bubbleContacts("org-A", "FORBIDDEN");
    qc.setQueryData<ChatContact[]>(allowedKey, [makeContact("11999")]);
    qc.setQueryData<ChatContact[]>(forbiddenKey, [makeContact("11999")]);

    renderHook(() => useChatBubbleContactsRealtime(["i1"], null), {
      wrapper: wrapper(qc),
    });
    mocks.channelMock.trigger(payloadInsert("FORBIDDEN", "11999", "incoming"));

    expect(qc.getQueryData<ChatContact[]>(allowedKey)?.[0].unread_count).toBe(0);
    expect(qc.getQueryData<ChatContact[]>(forbiddenKey)?.[0].unread_count).toBe(0);
  });

  it("DELETE é ignorado (out of scope)", () => {
    const qc = newQc();
    const queryKey = chatQueryKeys.bubbleContacts("org-A", "i1");
    qc.setQueryData<ChatContact[]>(queryKey, [makeContact("11999", 5)]);

    renderHook(() => useChatBubbleContactsRealtime(["i1"], null), {
      wrapper: wrapper(qc),
    });

    mocks.channelMock.trigger({
      schema: "public",
      table: "whatsapp_messages",
      commit_timestamp: "2026-05-01T12:00:00Z",
      eventType: "DELETE",
      new: {},
      old: {
        id: "msg-1",
        instance_id: "i1",
        phone_number: "11999",
      } as Record<string, unknown>,
      errors: [],
    });

    expect(qc.getQueryData<ChatContact[]>(queryKey)?.[0].unread_count).toBe(5);
  });

  it("incoming msg em conv NÃO ativa → unread_count++", () => {
    const qc = newQc();
    const queryKey = chatQueryKeys.bubbleContacts("org-A", "i1");
    qc.setQueryData<ChatContact[]>(queryKey, [makeContact("11999", 2)]);

    renderHook(
      () => useChatBubbleContactsRealtime(["i1"], "5511888888888"),
      { wrapper: wrapper(qc) },
    );
    mocks.channelMock.trigger(payloadInsert("i1", "11999", "incoming"));

    expect(qc.getQueryData<ChatContact[]>(queryKey)?.[0].unread_count).toBe(3);
  });

  it("incoming msg em conv ATIVA (= activePhone normalizado) → unread NÃO incrementa", () => {
    const qc = newQc();
    const queryKey = chatQueryKeys.bubbleContacts("org-A", "i1");
    qc.setQueryData<ChatContact[]>(queryKey, [makeContact("11999999999", 0)]);

    renderHook(
      () => useChatBubbleContactsRealtime(["i1"], "5511999999999"),
      { wrapper: wrapper(qc) },
    );
    mocks.channelMock.trigger(payloadInsert("i1", "11999999999", "incoming"));

    expect(qc.getQueryData<ChatContact[]>(queryKey)?.[0].unread_count).toBe(0);
  });

  it("outgoing NÃO incrementa unread mesmo em conv não-ativa", () => {
    const qc = newQc();
    const queryKey = chatQueryKeys.bubbleContacts("org-A", "i1");
    qc.setQueryData<ChatContact[]>(queryKey, [makeContact("11999", 0)]);

    renderHook(() => useChatBubbleContactsRealtime(["i1"], null), {
      wrapper: wrapper(qc),
    });
    mocks.channelMock.trigger(payloadInsert("i1", "11999", "outgoing"));

    expect(qc.getQueryData<ChatContact[]>(queryKey)?.[0].unread_count).toBe(0);
  });

  it("cleanup desconecta channel ao unmount", () => {
    const qc = newQc();
    const { unmount } = renderHook(
      () => useChatBubbleContactsRealtime(["i1"], null),
      { wrapper: wrapper(qc) },
    );
    expect(mocks.supabaseMock.removeChannel).not.toHaveBeenCalled();
    unmount();
    expect(mocks.supabaseMock.removeChannel).toHaveBeenCalledTimes(1);
  });
});
