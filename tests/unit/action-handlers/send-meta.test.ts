// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../helpers/deno-mock";
import { createMockSupabase } from "../../helpers/supabase-mock";

// Mock time-variables and pipeline-adapter (needed by resolveVariables)
vi.mock("../../../supabase/functions/_shared/time-variables.ts", () => ({
  getTimeBasedVariables: vi.fn().mockReturnValue({ saudacao: "Bom dia", data: "18/05/2026", hora: "10:00" }),
}));

vi.mock("../../../supabase/functions/_shared/pipeline-adapter.ts", () => ({
  getPipeEntry: vi.fn().mockResolvedValue(null),
}));

const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({}),
  text: () => Promise.resolve(""),
});
global.fetch = mockFetch as any;

import {
  sendMetaMessage,
  sendSemiAutomatic,
} from "../../../supabase/functions/_shared/action-handlers/send-meta";

const LEAD = {
  id: "lead-1",
  name: "Test Lead",
  phone: "11999887766",
  company: "Acme",
  organization_id: "org-1",
  pipe_whatsapp: "novo",
};

// ── Meta Message ──
describe("sendMetaMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDenoEnv();
    setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
    setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  });

  it("returns error when leadId is null", async () => {
    const { sb } = createMockSupabase();
    const result = await sendMetaMessage({
      supabase: sb,
      organizationId: "org-1",
      leadId: null,
      conversationId: null,
      params: { metaChannel: "instagram", metaMessage: "Hello" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("leadId");
  });

  it("sends Meta message via edge function", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);

    const result = await sendMetaMessage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { metaChannel: "instagram", metaMessage: "Oi {{nome}}!" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("instagram");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns error when edge function call fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve("Internal Error"),
    });
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);

    const result = await sendMetaMessage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { metaChannel: "instagram", metaMessage: "Hello" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Meta message failed");
  });

  it("defaults to instagram channel when not specified", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);

    const result = await sendMetaMessage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { metaMessage: "Hello" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("instagram");
  });
});

// ── Semi-automatic ──
describe("sendSemiAutomatic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns error when leadId is null", async () => {
    const { sb } = createMockSupabase();
    const result = await sendSemiAutomatic({
      supabase: sb,
      organizationId: "org-1",
      leadId: null,
      conversationId: null,
      params: { semiAutoMessage: "Approve this" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("leadId");
  });

  it("queues message for approval successfully", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("scheduled_pipe_messages", []);

    const result = await sendSemiAutomatic({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: {
        semiAutoMessage: "Oi {{nome}}!",
        semiAutoApprover: "user-123",
      },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("approval");
    const inserted = getInserted("scheduled_pipe_messages");
    expect(inserted.length).toBe(1);
    expect(inserted[0]).toMatchObject({
      lead_id: "lead-1",
      status: "waiting_approval",
      source: "workflow",
    });
  });

  it("resolves variables in message", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("scheduled_pipe_messages", []);

    await sendSemiAutomatic({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { semiAutoMessage: "Oi {{nome}}!" },
      executionContext: {},
    });

    const inserted = getInserted("scheduled_pipe_messages");
    expect(inserted[0].message_content).toBe("Oi Test Lead!");
  });
});
