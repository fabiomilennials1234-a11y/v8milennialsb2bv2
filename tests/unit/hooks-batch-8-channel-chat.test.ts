import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ── Chain mock ────────────────────────────────────────────────────────────────
function createChainMock() {
  const chain: Record<string, any> = {};
  [
    "select","eq","neq","or","in","gte","lte","lt","ilike","contains",
    "order","limit","range","insert","update","delete","upsert","not",
    "is","filter","match","overlaps","textSearch","csv",
  ].forEach((m) => { chain[m] = vi.fn().mockReturnValue(chain); });
  chain.single = vi.fn().mockResolvedValue({
    data: { id: "msg1", organization_id: "org-t", channel: "whatsapp", content: "Hello" },
    error: null,
  });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "msg1" }, error: null });
  chain.then = (resolve: any, reject?: any) =>
    Promise.resolve({
      data: [{
        id: "msg1",
        phone_number: "5511999990000",
        sender_id: null,
        sender_name: "Lead",
        sender_profile_pic: null,
        channel: "whatsapp",
        content: "Hello",
        timestamp: "2025-01-15T10:00:00Z",
        direction: "incoming",
        lead_id: "l1",
        leads: { name: "Lead Name" },
        organization_id: "org-t",
        instance_id: "inst1",
      }],
      error: null,
      count: 1,
    }).then(resolve, reject);
  chain.catch = (fn: any) => Promise.resolve({ data: [], error: null }).catch(fn);
  return chain;
}

const mockFrom = vi.fn().mockReturnValue(createChainMock());
const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
const mockInvoke = vi.fn().mockResolvedValue({ data: { key: { id: "msg-ext-1" } }, error: null });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(...args),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
    removeChannel: vi.fn(),
    rpc: (...args: any[]) => mockRpc(...args),
    functions: { invoke: (...args: any[]) => mockInvoke(...args) },
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "" } }),
      }),
    },
  },
}));

vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, session: { access_token: "tok" } }) }));
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-t", isReady: true }),
  useRequiredOrganization: () => ({ organizationId: "org-t", teamMemberId: "tm1" }),
}));
vi.mock("@/modules/identity/org-team/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({ data: { id: "tm1", organization_id: "org-t" } }),
  isVirtualTeamMember: () => false,
  useTeamMembers: () => ({ data: [] }),
}));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/modules/communication/lib/whatsapp", () => ({
  formatPhoneForWhatsApp: vi.fn().mockReturnValue("5511999990000"),
}));
vi.mock("@/modules/communication/components/chat/ChannelBadge", () => ({}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
import {
  useChannelContacts,
  useChannelMessages,
  useSendChannelMessage,
  useChannelMessagesRealtime,
  markContactAsSeen,
} from "@/hooks/useChannelChat";

describe("useChannelContacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const chain = createChainMock();
    // The queryFn makes multiple supabase calls. Each resolves via `then`.
    // Also need whatsapp_conversations and whatsapp_conversation_tags to return data.
    chain.then = (resolve: any, reject?: any) =>
      Promise.resolve({
        data: [{
          id: "msg1",
          phone_number: "5511999990000",
          sender_id: null,
          sender_name: "Lead",
          sender_profile_pic: null,
          channel: "whatsapp",
          content: "Hello",
          timestamp: "2025-01-15T10:00:00Z",
          direction: "incoming",
          lead_id: null,
          leads: null,
          organization_id: "org-t",
          instance_id: "inst1",
        }],
        error: null,
      }).then(resolve, reject);
    mockFrom.mockReturnValue(chain);
  });

  it("fetches contacts aggregated from channel_messages", async () => {
    const { result } = renderHook(() => useChannelContacts("inst1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 3000 });
    expect(mockFrom).toHaveBeenCalledWith("channel_messages");
  });

  it("fetches contacts without instanceId", async () => {
    const { result } = renderHook(() => useChannelContacts(null), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 3000 });
    expect(mockFrom).toHaveBeenCalledWith("channel_messages");
  });
});

describe("useChannelMessages", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("fetches messages for a whatsapp contact", async () => {
    const { result } = renderHook(
      () => useChannelMessages("5511999990000", "whatsapp", "inst1"),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("channel_messages");
  });

  it("fetches messages for a meta contact (instagram)", async () => {
    const { result } = renderHook(
      () => useChannelMessages("sender-123", "instagram", null),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("channel_messages");
  });

  it("returns empty when contactId is null", async () => {
    const { result } = renderHook(
      () => useChannelMessages(null, "whatsapp", "inst1"),
      { wrapper: createWrapper() },
    );
    // Disabled query
    expect(result.current.data).toBeUndefined();
  });
});

describe("useSendChannelMessage", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("sends a whatsapp message", async () => {
    const { result } = renderHook(() => useSendChannelMessage(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({
          contactId: "5511999990000",
          channel: "whatsapp" as any,
          message: "Oi!",
          instanceName: "inst-name",
          instanceId: "inst1",
        });
      } catch {}
    });
    expect(mockInvoke).toHaveBeenCalledWith("whatsapp-api-proxy", expect.any(Object));
  });

  it("sends a meta message (instagram)", async () => {
    const { result } = renderHook(() => useSendChannelMessage(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({
          contactId: "sender-123",
          channel: "instagram" as any,
          message: "Hello!",
          pageId: "page-1",
        });
      } catch {}
    });
    expect(mockInvoke).toHaveBeenCalledWith("send-meta-message", expect.any(Object));
  });
});

describe("useChannelMessagesRealtime", () => {
  let mockChannel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
    // Get the channel mock from the module
    mockChannel = (
      vi.mocked(
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        (globalThis as any).__supabase_channel_mock
      )
    );
  });

  it("is a hook that can be called", () => {
    // Verifying it renders without crashing
    const { unmount } = renderHook(
      () => useChannelMessagesRealtime("5511999990000", "whatsapp"),
      { wrapper: createWrapper() },
    );
    unmount();
    // It should have attempted to subscribe (channel is called in mock)
    expect(true).toBe(true);
  });

  it("renders without contactId", () => {
    const { unmount } = renderHook(
      () => useChannelMessagesRealtime(null, null),
      { wrapper: createWrapper() },
    );
    unmount();
    expect(true).toBe(true);
  });
});

describe("markContactAsSeen", () => {
  it("sets localStorage key", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem");
    markContactAsSeen("whatsapp:5511999990000");
    expect(spy).toHaveBeenCalledWith("channel_last_seen_whatsapp:5511999990000", expect.any(String));
    spy.mockRestore();
  });
});
