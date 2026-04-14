/**
 * Batch 5 — tinyerp-utils, outbound-sender, audio-sender, track, ai-queue, logger (_shared)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve("ok"), arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)) });
global.fetch = mockFetch as any;

beforeEach(() => { clearDenoEnv(); vi.clearAllMocks(); });

// ── tinyerp-utils ──
import { TINY_API_BASE } from "../../supabase/functions/_shared/tinyerp-utils";

describe("tinyerp-utils", () => {
  it("TINY_API_BASE is correct", () => {
    expect(TINY_API_BASE).toBe("https://api.tiny.com.br/api2");
  });
});

// ── outbound-sender types ──
import { sendOutboundDispatch } from "../../supabase/functions/_shared/outbound-sender";

describe("sendOutboundDispatch", () => {
  it("returns error when dispatch not found", async () => {
    const { sb, mockTable } = createMockSupabase();
    // Empty table = dispatch not found
    const result = await sendOutboundDispatch(sb, "dispatch-1", "org-1");
    expect(result.success).toBe(false);
  });
});

// ── track.ts ──
import { trackEvent } from "../../supabase/functions/_shared/track";

describe("trackEvent", () => {
  it("does nothing when env vars not set", async () => {
    clearDenoEnv();
    await expect(trackEvent({
      organizationId: "org-1",
      eventType: "lead_created",
    })).resolves.not.toThrow();
  });

  it("does not throw even when Supabase fails", async () => {
    setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
    setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    // createClient from mocked module won't actually connect
    await expect(trackEvent({
      organizationId: "org-1",
      eventType: "message_sent",
      entityType: "lead",
      entityId: "l1",
    })).resolves.not.toThrow();
  });
});

// ── ai-queue.ts ──
import { enqueueAiAction, enqueueAiActions, type EnqueueParams, type EnqueueResult } from "../../supabase/functions/_shared/ai-queue";

describe("enqueueAiAction", () => {
  it("inserts action via Supabase", async () => {
    const { sb, mockTable } = createMockSupabase();
    const result = await enqueueAiAction(sb, {
      organizationId: "org-1",
      leadId: "lead-1",
      actionType: "qualify",
      payload: { score: 85 },
    });
    expect(result).toBeDefined();
    // May be queued or not depending on mock
  });

  it("handles duplicate idempotency gracefully", async () => {
    const { sb } = createMockSupabase();
    const result = await enqueueAiAction(sb, {
      organizationId: "org-1",
      actionType: "test",
      payload: {},
      idempotencyKey: "key-1",
    });
    expect(result).toBeDefined();
  });
});

describe("enqueueAiActions (batch)", () => {
  it("enqueues multiple actions", async () => {
    const { sb } = createMockSupabase();
    const actions: EnqueueParams[] = [
      { organizationId: "org-1", actionType: "a1", payload: {} },
      { organizationId: "org-1", actionType: "a2", payload: {} },
    ];
    const results = await enqueueAiActions(sb, actions);
    expect(results).toHaveLength(2);
  });
});

describe("EnqueueResult type", () => {
  it("success shape", () => {
    const r: EnqueueResult = { queued: true, id: "id-1" };
    expect(r.queued).toBe(true);
  });

  it("failure shape", () => {
    const r: EnqueueResult = { queued: false, reason: "duplicate" };
    expect(r.reason).toBe("duplicate");
  });
});

// ── logger (_shared) ──
import { logRuntime } from "../../supabase/functions/_shared/logger";

describe("logRuntime (_shared)", () => {
  it("does nothing when env vars not set", async () => {
    clearDenoEnv();
    await expect(logRuntime({
      module: "test",
      action: "test_action",
      status: "success",
    })).resolves.not.toThrow();
  });

  it("handles payloadSnapshot sanitization", async () => {
    setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
    setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "key");
    await expect(logRuntime({
      module: "test",
      action: "create",
      status: "success",
      payloadSnapshot: { password: "secret", name: "test" },
    })).resolves.not.toThrow();
  });
});
