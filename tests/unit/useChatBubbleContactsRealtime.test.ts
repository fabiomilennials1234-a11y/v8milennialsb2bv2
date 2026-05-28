import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockSetQueryData = vi.fn();
const mockInvalidateQueries = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    setQueryData: mockSetQueryData,
    invalidateQueries: mockInvalidateQueries,
  }),
}));

const mockUseCurrentTeamMember = vi.fn();
vi.mock("@/modules/identity/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => mockUseCurrentTeamMember(),
}));

// Capture onEvent from useRealtimeChannel calls
let capturedOptions: any = null;
const mockUseRealtimeChannel = vi.fn();

vi.mock("@/shared/realtime/useRealtimeChannel", () => ({
  useRealtimeChannel: (opts: any) => mockUseRealtimeChannel(opts),
}));

vi.mock("@/lib/normalizePhone", () => ({
  normalizePhone: (p: string) => p?.replace(/\D/g, "") || null,
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

import { useChatBubbleContactsRealtime } from "@/modules/communication/hooks/chat/useChatBubbleContactsRealtime";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ORG_ID = "org-123";
const INSTANCE_A = "inst-aaa";
const INSTANCE_B = "inst-bbb";

function setupTeamMember(orgId: string | null = ORG_ID) {
  mockUseCurrentTeamMember.mockReturnValue({
    data: orgId ? { organization_id: orgId } : null,
  });
}

function makeContact(phone: string, lastTime: string, unread = 0) {
  return {
    phone_number: phone,
    push_name: "Test",
    last_message: "old",
    last_message_time: lastTime,
    last_message_direction: "outgoing" as const,
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

function makeMessagePayload(
  phone: string,
  instanceId: string,
  direction: "incoming" | "outgoing" = "incoming",
  timestamp = "2026-05-17T12:00:00Z",
  content = "hello",
) {
  return {
    eventType: "INSERT" as const,
    new: {
      id: "msg-1",
      organization_id: ORG_ID,
      instance_id: instanceId,
      message_id: "mid-1",
      remote_jid: `${phone}@s.whatsapp.net`,
      phone_number: phone,
      direction,
      message_type: "text",
      content,
      media_url: null,
      push_name: null,
      status: "received",
      lead_id: null,
      timestamp,
      created_at: timestamp,
      sent_by_ai: null,
      sent_source: null,
    },
    old: {},
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useChatBubbleContactsRealtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOptions = null;
    mockUseRealtimeChannel.mockImplementation((opts: any) => {
      capturedOptions = opts;
      return { state: "joined" as const, diagnostics: [] };
    });
    setupTeamMember();
  });

  // 1. Hook calls useRealtimeChannel with correct config
  describe("useRealtimeChannel delegation", () => {
    it("passes correct table and org filter to useRealtimeChannel", () => {
      renderHook(() =>
        useChatBubbleContactsRealtime([INSTANCE_A, INSTANCE_B], null),
      );

      expect(mockUseRealtimeChannel).toHaveBeenCalledTimes(1);
      const opts = mockUseRealtimeChannel.mock.calls[0][0];
      expect(opts.table).toBe("whatsapp_messages");
      expect(opts.filter).toBe(`organization_id=eq.${ORG_ID}`);
      expect(opts.enabled).toBe(true);
      expect(typeof opts.onEvent).toBe("function");
    });

    it("maps useRealtimeChannel state to isReconnecting correctly", () => {
      // "joined" → not reconnecting
      mockUseRealtimeChannel.mockImplementation((opts: any) => {
        capturedOptions = opts;
        return { state: "joined", diagnostics: [] };
      });
      const { result: r1 } = renderHook(() =>
        useChatBubbleContactsRealtime([INSTANCE_A], null),
      );
      expect(r1.current.isReconnecting).toBe(false);

      // "errored" → reconnecting
      mockUseRealtimeChannel.mockImplementation((opts: any) => {
        capturedOptions = opts;
        return { state: "errored", diagnostics: [] };
      });
      const { result: r2 } = renderHook(() =>
        useChatBubbleContactsRealtime([INSTANCE_A], null),
      );
      expect(r2.current.isReconnecting).toBe(true);

      // "polling" → reconnecting
      mockUseRealtimeChannel.mockImplementation((opts: any) => {
        capturedOptions = opts;
        return { state: "polling", diagnostics: [] };
      });
      const { result: r3 } = renderHook(() =>
        useChatBubbleContactsRealtime([INSTANCE_A], null),
      );
      expect(r3.current.isReconnecting).toBe(true);
    });
  });

  // 2. On new message event, bubble contact list updates
  describe("contact patching on message event", () => {
    it("updates last_message and increments unread for incoming message", () => {
      renderHook(() =>
        useChatBubbleContactsRealtime([INSTANCE_A], null),
      );

      const existingContact = makeContact("5511999990000", "2026-05-17T11:00:00Z", 2);
      mockSetQueryData.mockImplementation((_key: any, updater: any) => {
        if (typeof updater === "function") {
          return updater([existingContact]);
        }
        return updater;
      });

      const payload = makeMessagePayload(
        "5511999990000",
        INSTANCE_A,
        "incoming",
        "2026-05-17T12:00:00Z",
        "new msg",
      );

      // Fire event through captured onEvent
      capturedOptions.onEvent(payload);

      expect(mockSetQueryData).toHaveBeenCalled();
      const [key, updater] = mockSetQueryData.mock.calls[0];
      expect(key).toEqual(["whatsapp_contacts", ORG_ID, INSTANCE_A]);

      const result = updater([existingContact]);
      expect(result[0].last_message).toBe("new msg");
      expect(result[0].last_message_time).toBe("2026-05-17T12:00:00Z");
      expect(result[0].last_message_direction).toBe("incoming");
      expect(result[0].unread_count).toBe(3);
    });

    it("does NOT increment unread for outgoing message", () => {
      renderHook(() =>
        useChatBubbleContactsRealtime([INSTANCE_A], null),
      );

      const existingContact = makeContact("5511999990000", "2026-05-17T11:00:00Z", 2);

      const payload = makeMessagePayload(
        "5511999990000",
        INSTANCE_A,
        "outgoing",
        "2026-05-17T12:00:00Z",
        "sent msg",
      );

      capturedOptions.onEvent(payload);

      const [, updater] = mockSetQueryData.mock.calls[0];
      const result = updater([existingContact]);
      expect(result[0].unread_count).toBe(2); // unchanged
    });

    it("does NOT increment unread when message phone matches activePhone", () => {
      renderHook(() =>
        useChatBubbleContactsRealtime([INSTANCE_A], "5511999990000"),
      );

      const existingContact = makeContact("5511999990000", "2026-05-17T11:00:00Z", 0);

      const payload = makeMessagePayload(
        "5511999990000",
        INSTANCE_A,
        "incoming",
        "2026-05-17T12:00:00Z",
      );

      capturedOptions.onEvent(payload);

      const [, updater] = mockSetQueryData.mock.calls[0];
      const result = updater([existingContact]);
      expect(result[0].unread_count).toBe(0); // no increment — conv is active
    });
  });

  // 3. On message from unknown contact, invalidate to refetch
  describe("new contact handling", () => {
    it("invalidates query when phone not found in contacts cache", () => {
      renderHook(() =>
        useChatBubbleContactsRealtime([INSTANCE_A], null),
      );

      const existingContact = makeContact("5511888880000", "2026-05-17T11:00:00Z");

      mockSetQueryData.mockImplementation((_key: any, updater: any) => {
        if (typeof updater === "function") {
          return updater([existingContact]);
        }
        return updater;
      });

      // Message from a different phone not in cache
      const payload = makeMessagePayload("5511777770000", INSTANCE_A, "incoming");
      capturedOptions.onEvent(payload);

      // setQueryData was called — updater returns prev (no patch)
      const [, updater] = mockSetQueryData.mock.calls[0];
      const result = updater([existingContact]);
      expect(result).toEqual([existingContact]); // unchanged

      // invalidateQueries called for contacts refetch
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ["whatsapp_contacts", ORG_ID, INSTANCE_A],
      });
    });
  });

  // 4. Return interface matches original (no breaking changes)
  describe("public interface", () => {
    it("returns { isReconnecting: boolean }", () => {
      const { result } = renderHook(() =>
        useChatBubbleContactsRealtime([INSTANCE_A], null),
      );

      expect(result.current).toHaveProperty("isReconnecting");
      expect(typeof result.current.isReconnecting).toBe("boolean");
      // No extra keys leaked
      expect(Object.keys(result.current)).toEqual(["isReconnecting"]);
    });
  });

  // 5. Disabled when no instance IDs or no org
  describe("disabled states", () => {
    it("disables subscription when instanceIds is empty", () => {
      renderHook(() => useChatBubbleContactsRealtime([], null));

      expect(mockUseRealtimeChannel).toHaveBeenCalledTimes(1);
      const opts = mockUseRealtimeChannel.mock.calls[0][0];
      expect(opts.enabled).toBe(false);
    });

    it("disables subscription when organizationId is null", () => {
      setupTeamMember(null);
      renderHook(() => useChatBubbleContactsRealtime([INSTANCE_A], null));

      expect(mockUseRealtimeChannel).toHaveBeenCalledTimes(1);
      const opts = mockUseRealtimeChannel.mock.calls[0][0];
      expect(opts.enabled).toBe(false);
    });
  });

  // Extra: ignores messages from instance not in allowed list
  describe("instance filtering", () => {
    it("ignores messages from instance_id not in instanceIds", () => {
      renderHook(() =>
        useChatBubbleContactsRealtime([INSTANCE_A], null),
      );

      const payload = makeMessagePayload("5511999990000", "inst-unknown", "incoming");
      capturedOptions.onEvent(payload);

      expect(mockSetQueryData).not.toHaveBeenCalled();
    });

    it("ignores DELETE events", () => {
      renderHook(() =>
        useChatBubbleContactsRealtime([INSTANCE_A], null),
      );

      const payload = { eventType: "DELETE", new: {}, old: { id: "x" } };
      capturedOptions.onEvent(payload);

      expect(mockSetQueryData).not.toHaveBeenCalled();
    });
  });
});
