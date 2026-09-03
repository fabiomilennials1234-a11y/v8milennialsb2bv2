// @vitest-environment node
/**
 * Unit tests for triggerReactions — the reaction pipeline extracted from
 * handleMessagesEvent in whatsapp-webhook/index.ts.
 *
 * Verifies:
 * 1. Copilot dispatch is called for valid incoming messages
 * 2. Copilot skipped when shouldTriggerCopilot is false (no content)
 * 3. Copilot skipped for outgoing messages
 * 4. Workflow resolve_wait_response RPC fires for incoming messages
 * 5. Group messages skip all reactions entirely
 * 6. Cancellation gate aborts mid-delivery
 * 7. Errors swallowed gracefully (fire-and-forget)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Stubs ───────────────────────────────────────────────────────────────────

const envStub: Record<string, string> = {
  SUPABASE_URL: "https://local.supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  UAZAPI_WEBHOOK_SECRET: "test-secret",
  UAZAPI_BASE_URL: "https://uazapi.test",
};

vi.stubGlobal("Deno", {
  env: {
    get: (k: string) => envStub[k] ?? undefined,
    toObject: () => ({ ...envStub }),
  },
  serve: (_handler: unknown) => {},
});

const mockLogRuntime = vi.fn(async () => {});
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: (...args: unknown[]) => mockLogRuntime(...args),
  redactSecrets: (v: unknown) => v,
}));

vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_name: string, fn: unknown) => fn,
}));

vi.mock("../../supabase/functions/_shared/security-headers.ts", () => ({
  withSecurityHeaders: (h: Record<string, string>) => h,
}));

vi.mock("../../supabase/functions/_shared/pipeline-adapter.ts", () => ({
  upsertPipeEntry: vi.fn(async () => ({})),
}));

const mockIsCopilotCanceled = vi.fn(async () => ({
  canceled: false,
  source: "default" as const,
  ai_disabled: false,
}));
const mockLogCopilotCancellation = vi.fn();

vi.mock("../../supabase/functions/_shared/copilot/cancellation.ts", () => ({
  isCopilotCanceled: (...args: unknown[]) => mockIsCopilotCanceled(...args),
  logCopilotCancellation: (...args: unknown[]) => mockLogCopilotCancellation(...args),
}));

vi.mock("../../supabase/functions/_shared/whatsapp-media.ts", () => ({
  downloadAndPersistMedia: vi.fn(async () => ({ ok: true })),
  enqueueMediaJob: vi.fn(async () => {}),
  isWhatsAppCdnUrl: () => false,
  stampMediaJob: vi.fn(async () => {}),
}));

vi.mock("../../supabase/functions/_shared/auth.ts", () => ({
  timingSafeCompare: (a: string, b: string) => a === b,
  checkRateLimitPersistent: vi.fn(async () => ({ allowed: true, remaining: 100, resetAt: "" })),
}));

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock sendTextViaInstance
const mockSendTextViaInstance = vi.fn(async () => ({ success: true, messageId: "msg-ai-1" }));
vi.mock("../../supabase/functions/_shared/whatsapp-dispatch.ts", () => ({
  sendTextViaInstance: (...args: unknown[]) => mockSendTextViaInstance(...args),
}));

// Mock supabase client
const mockRpc = vi.fn(async () => ({ error: null }));
const mockUpsert = vi.fn(async () => ({ error: null }));
const mockInsert = vi.fn(async () => ({ error: null }));
const mockQueueInsert = vi.fn(async () => ({ error: null }));

const mockSupabase = {
  rpc: mockRpc,
  from: vi.fn((table: string) => {
    if (table === "copilot_message_queue") {
      return { insert: mockQueueInsert };
    }
    if (table === "whatsapp_messages") {
      return { upsert: mockUpsert };
    }
    if (table === "whatsapp_instances") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: { id: "inst-1", organization_id: "org-1", instance_name: "Test" },
            })),
          })),
        })),
      };
    }
    if (table === "organizations") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: { capture_groups: true } })),
          })),
        })),
      };
    }
    return { upsert: mockUpsert, insert: mockInsert };
  }),
};

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: vi.fn(() => mockSupabase),
}));

// ─── Import module under test ────────────────────────────────────────────────

const mod = await import("../../supabase/functions/whatsapp-webhook/index.ts");
const { triggerReactions } = mod as unknown as {
  triggerReactions: (
    supabase: typeof mockSupabase,
    persisted: {
      organization_id: string;
      instance_id: string;
      message_id: string;
      phone_number: string;
      content: string | null;
      direction: string;
      message_type: string;
      push_name: string | null;
    },
    context: {
      shouldTriggerCopilot: boolean;
      shouldResolveWaitResponse: boolean;
      isGroup: boolean;
      replaySource: string | null;
      conversationId?: string | null;
    },
  ) => Promise<void>;
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("triggerReactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueueInsert.mockResolvedValue({ error: null });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ messages: ["Oi! Como posso ajudar?"] }),
    });
    mockIsCopilotCanceled.mockResolvedValue({
      canceled: false,
      source: "default" as const,
      ai_disabled: false,
    });
    mockSendTextViaInstance.mockResolvedValue({ success: true, messageId: "msg-ai-1" });
  });

  const basePersisted = {
    organization_id: "org-1",
    instance_id: "inst-1",
    message_id: "msg-123",
    phone_number: "5547999999999",
    content: "Ola, quero comprar",
    direction: "incoming" as const,
    message_type: "text",
    push_name: "Lead Test",
    media_url: null as string | null,
  };

  // ─── Scenario 1: Copilot fallback (queue fails → direct fetch) ───────────

  it("falls back to agent-message fetch when queue insert fails", async () => {
    mockQueueInsert.mockResolvedValueOnce({ error: { message: "queue_down" } });

    await triggerReactions(mockSupabase, basePersisted, {
      shouldTriggerCopilot: true,
      shouldResolveWaitResponse: true,
      isGroup: false,
      replaySource: null,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://local.supabase.test/functions/v1/agent-message",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Authorization": "Bearer test-service-key",
          "Content-Type": "application/json",
        }),
      }),
    );

    // Verify payload contains required fields
    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body).toEqual({
      from: "5547999999999",
      message: "Ola, quero comprar",
      channel: "whatsapp",
      organization_id: "org-1",
      push_name: "Lead Test",
      incoming_message_type: "text",
      media_url: null,
      instance_id: "inst-1",
    });
  });

  // ─── Scenario 2: Copilot skipped (no content / shouldTriggerCopilot false)

  // O gatilho `lead_replied` filtra por número de origem, e quem conhece a
  // Instance é ESTE webhook — o `fireTrigger` roda lá dentro do agent-message.
  // Sem o campo no payload a identidade do número se perde no caminho e o
  // filtro vira "qualquer número" em silêncio.
  it("leva o instance_id no payload do agent-message", async () => {
    mockQueueInsert.mockResolvedValueOnce({ error: { message: "queue_down" } });

    await triggerReactions(mockSupabase, basePersisted, {
      shouldTriggerCopilot: true,
      shouldResolveWaitResponse: true,
      isGroup: false,
      replaySource: null,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.instance_id).toBe(basePersisted.instance_id);
  });

  it("skips copilot when shouldTriggerCopilot is false", async () => {
    await triggerReactions(mockSupabase, basePersisted, {
      shouldTriggerCopilot: false,
      shouldResolveWaitResponse: true,
      isGroup: false,
      replaySource: null,
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not call agent-message for message with null content", async () => {
    await triggerReactions(
      mockSupabase,
      { ...basePersisted, content: null },
      {
        shouldTriggerCopilot: false, // caller sets false when content is null
        shouldResolveWaitResponse: true,
        isGroup: false,
        replaySource: null,
      },
    );

    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ─── Scenario 3: Copilot skipped (outgoing message) ─────────────────────

  it("does not call agent-message for outgoing message", async () => {
    await triggerReactions(
      mockSupabase,
      { ...basePersisted, direction: "outgoing" },
      {
        shouldTriggerCopilot: false, // caller sets false for outgoing
        shouldResolveWaitResponse: false,
        isGroup: false,
        replaySource: null,
      },
    );

    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ─── Scenario 4: Workflow wait_response resolved ─────────────────────────

  it("calls resolve_wait_response_by_phone RPC with correct params", async () => {
    await triggerReactions(mockSupabase, basePersisted, {
      shouldTriggerCopilot: false,
      shouldResolveWaitResponse: true,
      isGroup: false,
      replaySource: null,
    });

    expect(mockRpc).toHaveBeenCalledWith("resolve_wait_response_by_phone", {
      p_phone: "5547999999999",
      p_organization_id: "org-1",
      p_channel: "whatsapp",
    });
  });

  it("skips workflow resolve when shouldResolveWaitResponse is false", async () => {
    await triggerReactions(mockSupabase, basePersisted, {
      shouldTriggerCopilot: false,
      shouldResolveWaitResponse: false,
      isGroup: false,
      replaySource: null,
    });

    expect(mockRpc).not.toHaveBeenCalled();
  });

  // ─── Scenario 5: Group message skips all reactions ───────────────────────

  it("skips all reactions (copilot + workflow) when isGroup is true", async () => {
    await triggerReactions(mockSupabase, basePersisted, {
      shouldTriggerCopilot: true,
      shouldResolveWaitResponse: true,
      isGroup: true,
      replaySource: null,
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // ─── Scenario 6: Copilot cancellation mid-delivery ──────────────────────

  it("aborts delivery when isCopilotCanceled returns canceled after first chunk (fallback path)", async () => {
    vi.useFakeTimers();
    mockQueueInsert.mockResolvedValueOnce({ error: { message: "queue_down" } });

    // Agent returns 2 parts
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: ["Parte 1", "Parte 2"] }),
    });

    // First chunk: not canceled. Second chunk: canceled.
    let callCount = 0;
    mockIsCopilotCanceled.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { canceled: false, source: "default", ai_disabled: false };
      }
      return { canceled: true, source: "lead_toggle", ai_disabled: true };
    });

    await triggerReactions(mockSupabase, basePersisted, {
      shouldTriggerCopilot: true,
      shouldResolveWaitResponse: false,
      isGroup: false,
      replaySource: null,
    });

    // Flush the .then() chain: microtasks for fetch resolution
    await vi.advanceTimersByTimeAsync(0);
    // Advance past the inter-chunk delay (1200 + 800 max)
    await vi.advanceTimersByTimeAsync(2100);

    // sendTextViaInstance called only once (first chunk delivered, second aborted)
    expect(mockSendTextViaInstance).toHaveBeenCalledTimes(1);

    // logCopilotCancellation called with correct metadata
    expect(mockLogCopilotCancellation).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        gate: "outbound_chunks",
        phone: "5547999999999",
        chunksSent: 1,
        chunksTotal: 2,
        source: "lead_toggle",
      }),
    );

    vi.useRealTimers();
  });

  // ─── Scenario 7: Error swallowed (fire-and-forget) ──────────────────────

  it("swallows fetch errors gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));

    await expect(
      triggerReactions(mockSupabase, basePersisted, {
        shouldTriggerCopilot: true,
        shouldResolveWaitResponse: true,
        isGroup: false,
        replaySource: null,
      }),
    ).resolves.toBeUndefined();
  });

  // ─── Additional: logs copilot dispatch action ───────────────────────────

  it("logs copilot_queued on successful queue insert", async () => {
    await triggerReactions(mockSupabase, basePersisted, {
      shouldTriggerCopilot: true,
      shouldResolveWaitResponse: false,
      isGroup: false,
      replaySource: null,
    });

    expect(mockLogRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        module: "webhook",
        action: "copilot_queued",
        status: "success",
      }),
    );
  });

  it("logs uazapi_agent_message_dispatched on fallback dispatch", async () => {
    mockQueueInsert.mockResolvedValueOnce({ error: { message: "queue_down" } });

    await triggerReactions(mockSupabase, basePersisted, {
      shouldTriggerCopilot: true,
      shouldResolveWaitResponse: false,
      isGroup: false,
      replaySource: null,
    });

    expect(mockLogRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        module: "webhook",
        action: "uazapi_agent_message_dispatched",
        status: "success",
      }),
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Queue-based copilot dispatch tests (#203)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("copilot queue dispatch", () => {
    it("does NOT insert into queue when shouldTriggerCopilot is false", async () => {
      await triggerReactions(mockSupabase, basePersisted, {
        shouldTriggerCopilot: false,
        shouldResolveWaitResponse: true,
        isGroup: false,
        replaySource: null,
        conversationId: "conv-abc-123",
      });

      expect(mockQueueInsert).not.toHaveBeenCalled();
    });

    it("does NOT insert into queue for group messages", async () => {
      await triggerReactions(mockSupabase, basePersisted, {
        shouldTriggerCopilot: true,
        shouldResolveWaitResponse: true,
        isGroup: true,
        replaySource: null,
        conversationId: "conv-abc-123",
      });

      expect(mockQueueInsert).not.toHaveBeenCalled();
    });

    it("inserts into copilot_message_queue with correct fields for eligible message", async () => {
      await triggerReactions(mockSupabase, basePersisted, {
        shouldTriggerCopilot: true,
        shouldResolveWaitResponse: false,
        isGroup: false,
        replaySource: null,
        conversationId: "conv-abc-123",
      });

      expect(mockSupabase.from).toHaveBeenCalledWith("copilot_message_queue");
      expect(mockQueueInsert).toHaveBeenCalledWith({
        organization_id: "org-1",
        conversation_id: "conv-abc-123",
        message_id: "msg-123",
        phone: "5547999999999",
      });
    });

    it("does NOT call agent-message directly when queue insert succeeds", async () => {
      // mockQueueInsert returns { error: null } by default (success)
      await triggerReactions(mockSupabase, basePersisted, {
        shouldTriggerCopilot: true,
        shouldResolveWaitResponse: false,
        isGroup: false,
        replaySource: null,
        conversationId: "conv-abc-123",
      });

      expect(mockQueueInsert).toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("falls back to direct agent-message fetch when queue insert fails", async () => {
      mockQueueInsert.mockResolvedValueOnce({ error: { message: "relation does not exist" } });

      await triggerReactions(mockSupabase, basePersisted, {
        shouldTriggerCopilot: true,
        shouldResolveWaitResponse: false,
        isGroup: false,
        replaySource: null,
        conversationId: "conv-abc-123",
      });

      // Queue was attempted
      expect(mockQueueInsert).toHaveBeenCalled();
      // Fallback fetch fired
      expect(mockFetch).toHaveBeenCalledWith(
        "https://local.supabase.test/functions/v1/agent-message",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});

// ─── shouldTriggerCopilot logic ─────────────────────────────────────────────

const { computeShouldTriggerCopilot } = mod as unknown as {
  computeShouldTriggerCopilot: (normalized: {
    direction: string;
    content: string | null;
    phone_number: string | null;
    message_type: string;
    media_url: string | null;
  }) => boolean;
};

describe("computeShouldTriggerCopilot", () => {
  it("returns true for incoming text with content", () => {
    expect(
      computeShouldTriggerCopilot({
        direction: "incoming",
        content: "Olá",
        phone_number: "5511999999999",
        message_type: "text",
        media_url: null,
      }),
    ).toBe(true);
  });

  it("returns false for outgoing messages", () => {
    expect(
      computeShouldTriggerCopilot({
        direction: "outgoing",
        content: "Olá",
        phone_number: "5511999999999",
        message_type: "text",
        media_url: null,
      }),
    ).toBe(false);
  });

  it("returns false for empty text content", () => {
    expect(
      computeShouldTriggerCopilot({
        direction: "incoming",
        content: "   ",
        phone_number: "5511999999999",
        message_type: "text",
        media_url: null,
      }),
    ).toBe(false);
  });

  it("returns true for audio messages even without text content", () => {
    expect(
      computeShouldTriggerCopilot({
        direction: "incoming",
        content: null,
        phone_number: "5511999999999",
        message_type: "audio",
        media_url: "https://cdn.whatsapp.net/audio.ogg",
      }),
    ).toBe(true);
  });

  it("returns true for ptt (voice note) messages without text content", () => {
    expect(
      computeShouldTriggerCopilot({
        direction: "incoming",
        content: null,
        phone_number: "5511999999999",
        message_type: "ptt",
        media_url: "https://cdn.whatsapp.net/voice.ogg",
      }),
    ).toBe(true);
  });

  it("returns true for image messages", () => {
    expect(
      computeShouldTriggerCopilot({
        direction: "incoming",
        content: null,
        phone_number: "5511999999999",
        message_type: "image",
        media_url: "https://cdn.whatsapp.net/image.jpg",
      }),
    ).toBe(true);
  });

  it("returns true for video messages", () => {
    expect(
      computeShouldTriggerCopilot({
        direction: "incoming",
        content: null,
        phone_number: "5511999999999",
        message_type: "video",
        media_url: "https://cdn.whatsapp.net/video.mp4",
      }),
    ).toBe(true);
  });

  it("returns true for document messages", () => {
    expect(
      computeShouldTriggerCopilot({
        direction: "incoming",
        content: null,
        phone_number: "5511999999999",
        message_type: "document",
        media_url: "https://cdn.whatsapp.net/doc.pdf",
      }),
    ).toBe(true);
  });

  it("returns false without phone_number", () => {
    expect(
      computeShouldTriggerCopilot({
        direction: "incoming",
        content: "Olá",
        phone_number: null,
        message_type: "text",
        media_url: null,
      }),
    ).toBe(false);
  });

  it("returns false for sticker (no useful content to process)", () => {
    expect(
      computeShouldTriggerCopilot({
        direction: "incoming",
        content: null,
        phone_number: "5511999999999",
        message_type: "sticker",
        media_url: "https://cdn.whatsapp.net/sticker.webp",
      }),
    ).toBe(false);
  });
});
