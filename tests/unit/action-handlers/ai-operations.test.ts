// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../helpers/deno-mock";
import { createMockSupabase } from "../../helpers/supabase-mock";

// Mock time-variables
vi.mock("../../../supabase/functions/_shared/time-variables.ts", () => ({
  getTimeBasedVariables: vi.fn().mockReturnValue({ saudacao: "Bom dia", data: "18/05/2026", hora: "10:00" }),
}));

// Mock pipeline-adapter
vi.mock("../../../supabase/functions/_shared/pipeline-adapter.ts", () => ({
  getPipeEntry: vi.fn().mockResolvedValue(null),
}));

import {
  generateAiMessage,
  summarizeConversation,
  evaluateConversation,
  queueScheduleMeeting,
} from "../../../supabase/functions/_shared/action-handlers/ai-operations";

const LEAD = {
  id: "lead-1",
  name: "Test Lead",
  phone: "11999887766",
  company: "Acme",
  organization_id: "org-1",
  pipe_whatsapp: "novo",
};

function makeInput(overrides: Partial<{
  params: Record<string, unknown>;
  leadId: string | null;
  executionContext: Record<string, unknown>;
}> = {}) {
  const { sb, mockTable } = createMockSupabase();
  mockTable("leads", [LEAD]);

  return {
    input: {
      supabase: sb,
      organizationId: "org-1",
      leadId: overrides.leadId !== undefined ? overrides.leadId : "lead-1",
      conversationId: null,
      params: overrides.params || { aiPrompt: "Gere uma mensagem para {{nome}}" },
      executionContext: overrides.executionContext || {},
    },
    sb,
    mockTable,
  };
}

// ─── generateAiMessage ─────────────────────────────────────────────────────

describe("generateAiMessage action handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDenoEnv();
  });

  it("returns error when OPENROUTER_API_KEY is missing", async () => {
    const { input } = makeInput();
    const result = await generateAiMessage(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("OPENROUTER_API_KEY");
  });

  it("returns error when aiPrompt is empty", async () => {
    setDenoEnv("OPENROUTER_API_KEY", "test-key");
    const { input } = makeInput({ params: { aiPrompt: "" } });
    const result = await generateAiMessage(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Prompt");
  });

  it("generates message and stores in executionContext", async () => {
    setDenoEnv("OPENROUTER_API_KEY", "test-key");

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "Oi Test Lead, tudo bem?" } }],
      }),
      text: vi.fn(),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const executionContext: Record<string, unknown> = {};
    const { input } = makeInput({ executionContext });
    const result = await generateAiMessage(input);

    expect(result.success).toBe(true);
    expect(result.data?.ai_message).toBe("Oi Test Lead, tudo bem?");
    expect(executionContext.ai_message).toBe("Oi Test Lead, tudo bem?");

    vi.unstubAllGlobals();
  });

  it("returns error on API failure", async () => {
    setDenoEnv("OPENROUTER_API_KEY", "test-key");

    const mockResponse = {
      ok: false,
      status: 429,
      text: vi.fn().mockResolvedValue("rate limited"),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const { input } = makeInput();
    const result = await generateAiMessage(input);

    expect(result.success).toBe(false);
    expect(result.error).toContain("429");

    vi.unstubAllGlobals();
  });

  it("uses custom output variable name", async () => {
    setDenoEnv("OPENROUTER_API_KEY", "test-key");

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "Custom var content" } }],
      }),
      text: vi.fn(),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const executionContext: Record<string, unknown> = {};
    const { input } = makeInput({
      params: { aiPrompt: "Test prompt", aiOutputVariable: "my_custom_var" },
      executionContext,
    });
    const result = await generateAiMessage(input);

    expect(result.success).toBe(true);
    expect(result.data?.my_custom_var).toBe("Custom var content");
    expect(executionContext.my_custom_var).toBe("Custom var content");

    vi.unstubAllGlobals();
  });
});

// ─── summarizeConversation ─────────────────────────────────────────────────

describe("summarizeConversation action handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDenoEnv();
  });

  it("returns error when SUPABASE_URL is missing", async () => {
    setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    const { input } = makeInput();
    const result = await summarizeConversation(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("SUPABASE_URL");
  });

  it("calls summarize-conversation edge function successfully", async () => {
    setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
    setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");

    const responseData = {
      summary: "Lead interessado",
      sentiment: "positivo",
      lead_temperature: "quente",
      next_action: "agendar reuniao",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(responseData),
    }));

    const { input } = makeInput();
    const result = await summarizeConversation(input);

    expect(result.success).toBe(true);
    expect(result.data?.summary).toBe("Lead interessado");
    expect(result.data?.sentiment).toBe("positivo");

    const fetchCall = (fetch as any).mock.calls[0];
    expect(fetchCall[0]).toContain("summarize-conversation");

    vi.unstubAllGlobals();
  });

  it("returns error on edge function failure", async () => {
    setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
    setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      text: vi.fn().mockResolvedValue("Internal Server Error"),
    }));

    const { input } = makeInput();
    const result = await summarizeConversation(input);

    expect(result.success).toBe(false);
    expect(result.error).toContain("summarize-conversation");

    vi.unstubAllGlobals();
  });
});

// ─── evaluateConversation ──────────────────────────────────────────────────

describe("evaluateConversation action handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDenoEnv();
  });

  it("calls evaluate-agent-conversation edge function successfully", async () => {
    setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
    setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ score: 85, feedback: "good" }),
    }));

    const { input } = makeInput();
    const result = await evaluateConversation(input);

    expect(result.success).toBe(true);
    expect(result.data?.score).toBe(85);

    const fetchCall = (fetch as any).mock.calls[0];
    expect(fetchCall[0]).toContain("evaluate-agent-conversation");

    vi.unstubAllGlobals();
  });

  it("returns error on edge function failure", async () => {
    setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
    setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      text: vi.fn().mockResolvedValue("Bad Request"),
    }));

    const { input } = makeInput();
    const result = await evaluateConversation(input);

    expect(result.success).toBe(false);
    expect(result.error).toContain("evaluate-agent-conversation");

    vi.unstubAllGlobals();
  });

  it("returns error when SUPABASE_URL is missing", async () => {
    setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    const { input } = makeInput();
    const result = await evaluateConversation(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("SUPABASE_URL");
  });
});

// ─── queueScheduleMeeting ──────────────────────────────────────────────────

describe("queueScheduleMeeting action handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queues pending_ai_actions record successfully", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("pending_ai_actions", []);

    const result = await queueScheduleMeeting({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { meetingDate: "2026-05-20", meetingCloserId: "closer-1" },
      executionContext: {},
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("queued");

    const inserted = getInserted("pending_ai_actions");
    expect(inserted.length).toBe(1);
    expect(inserted[0].action_type).toBe("schedule_meeting");
    expect(inserted[0].payload.preferred_date).toBe("2026-05-20");
  });

  it("returns error when leadId is null", async () => {
    const { sb } = createMockSupabase();
    const result = await queueScheduleMeeting({
      supabase: sb,
      organizationId: "org-1",
      leadId: null,
      conversationId: null,
      params: {},
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("leadId");
  });

  it("queues with null date/closer when not provided", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("pending_ai_actions", []);

    const result = await queueScheduleMeeting({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: {},
      executionContext: {},
    });

    expect(result.success).toBe(true);
    const inserted = getInserted("pending_ai_actions");
    expect(inserted[0].payload.preferred_date).toBeNull();
    expect(inserted[0].payload.closer_id).toBeNull();
  });
});
