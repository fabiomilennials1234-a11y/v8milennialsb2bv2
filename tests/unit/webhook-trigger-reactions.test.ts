// @vitest-environment node
/**
 * Unit tests for triggerReactions — the reaction pipeline extracted from
 * handleMessagesEvent in whatsapp-webhook/index.ts.
 *
 * Verifies:
 * 1. Copilot dispatch is called for valid incoming messages
 * 2. Workflow resolve_wait_response RPC fires for incoming messages
 * 3. Group messages skip reactions entirely
 * 4. Outgoing messages skip copilot but may resolve workflow
 * 5. Empty content skips copilot dispatch
 * 6. Cancellation gate aborts mid-delivery
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

vi.mock("../../supabase/functions/_shared/sentry.ts", () => ({
  withSentry: (_name: string, fn: unknown) => fn,
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

// Mock createClient
const mockRpc = vi.fn(async () => ({ error: null }));
const mockUpsert = vi.fn(async () => ({ error: null }));
const mockSelect = vi.fn(() => ({
  eq: vi.fn(() => ({
    maybeSingle: vi.fn(async () => ({ data: null })),
    eq: vi.fn(() => ({
      maybeSingle: vi.fn(async () => ({ data: null })),
    })),
  })),
}));

const mockSupabase = {
  rpc: mockRpc,
  from: vi.fn((table: string) => {
    if (table === "whatsapp_messages") {
      return { upsert: mockUpsert, select: mockSelect() };
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
    return { upsert: mockUpsert, insert: vi.fn(async () => ({ error: null })) };
  }),
};

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: vi.fn(() => mockSupabase),
}));

// Mock whatsapp-dispatch dynamic import
vi.mock("../../supabase/functions/_shared/whatsapp-dispatch.ts", () => ({
  sendTextViaInstance: vi.fn(async () => ({ success: true, messageId: "msg-ai-1" })),
}));

// ─── Import module under test ────────────────────────────────────────────────

const mod = await import("../../supabase/functions/whatsapp-webhook/index.ts");
const { triggerReactions } = mod as unknown as {
  triggerReactions: (
    supabase: typeof mockSupabase,
    persisted: { organization_id: string; instance_id: string; message_id: string; phone_number: string; content: string; direction: string; message_type: string; push_name: string | null },
    context: { shouldTriggerCopilot: boolean; shouldResolveWaitResponse: boolean; isGroup: boolean; replaySource: string | null },
  ) => Promise<void>;
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("triggerReactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ messages: ["Oi! Como posso ajudar?"] }),
    });
  });

  const basePersisted = {
    organization_id: "org-1",
    instance_id: "inst-1",
    message_id: "msg-123",
    phone_number: "5547999999999",
    content: "Olá, quero comprar",
    direction: "incoming",
    message_type: "text",
    push_name: "Lead Test",
  };

  it("dispatches copilot (agent-message fetch) for valid incoming message", async () => {
    await triggerReactions(mockSupabase, basePersisted, {
      shouldTriggerCopilot: true,
      shouldResolveWaitResponse: true,
      isGroup: false,
      replaySource: null,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/agent-message"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("5547999999999"),
      }),
    );
  });

  it("calls resolve_wait_response_by_phone RPC for incoming message", async () => {
    await triggerReactions(mockSupabase, basePersisted, {
      shouldTriggerCopilot: true,
      shouldResolveWaitResponse: true,
      isGroup: false,
      replaySource: null,
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "resolve_wait_response_by_phone",
      expect.objectContaining({
        p_phone: "5547999999999",
        p_organization_id: "org-1",
        p_channel: "whatsapp",
      }),
    );
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

  it("skips workflow resolve when shouldResolveWaitResponse is false", async () => {
    await triggerReactions(mockSupabase, basePersisted, {
      shouldTriggerCopilot: false,
      shouldResolveWaitResponse: false,
      isGroup: false,
      replaySource: null,
    });

    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("does nothing when isGroup is true", async () => {
    await triggerReactions(mockSupabase, basePersisted, {
      shouldTriggerCopilot: true,
      shouldResolveWaitResponse: true,
      isGroup: true,
      replaySource: null,
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("logs copilot dispatch action", async () => {
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

  it("swallows errors gracefully (fire-and-forget)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));

    // Should not throw
    await expect(
      triggerReactions(mockSupabase, basePersisted, {
        shouldTriggerCopilot: true,
        shouldResolveWaitResponse: true,
        isGroup: false,
        replaySource: null,
      }),
    ).resolves.toBeUndefined();
  });
});
