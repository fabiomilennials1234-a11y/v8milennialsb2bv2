// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../helpers/deno-mock";
import { createMockSupabase } from "../../helpers/supabase-mock";

// Mock time-variables + pipeline-adapter (needed by the real resolveVariables).
vi.mock("../../../supabase/functions/_shared/time-variables.ts", () => ({
  getTimeBasedVariables: vi.fn().mockReturnValue({ saudacao: "Bom dia", data: "29/06/2026", hora: "10:00" }),
}));
vi.mock("../../../supabase/functions/_shared/pipeline-adapter.ts", () => ({
  getPipeEntry: vi.fn().mockResolvedValue(null),
}));

// Partial-mock whatsapp-helpers: keep the real getWhatsAppInstance / resolveVariables /
// getLeadPhone / buildTrackId, but control the per-recipient reachability gate.
vi.mock("../../../supabase/functions/_shared/action-handlers/whatsapp-helpers.ts", async (orig) => ({
  ...(await (orig as () => Promise<Record<string, unknown>>)()),
  recipientGate: vi.fn(),
}));

// Mock the strict-write resolver so we can assert it is NEVER consulted (the
// leadId=null design claim — recipients are fixed numbers, not the lead).
vi.mock("../../../supabase/functions/_shared/instance-write-guard.ts", () => ({
  resolveStrictInstanceForCaller: vi.fn().mockResolvedValue(null),
  StrictWriteResolutionError: class extends Error { errorCode = "test"; },
}));

// Partial-mock whatsapp-dispatch: keep the real normalizeBrazilianPhone (pure),
// but control the actual send.
vi.mock("../../../supabase/functions/_shared/whatsapp-dispatch.ts", async (orig) => ({
  ...(await (orig as () => Promise<Record<string, unknown>>)()),
  sendTextViaInstance: vi.fn(),
}));

// Mock the summarizer — reuse contract: { success, data: { summary } }.
vi.mock("../../../supabase/functions/_shared/action-handlers/ai-operations.ts", () => ({
  summarizeConversation: vi.fn(),
}));

import { sendToNumber } from "../../../supabase/functions/_shared/action-handlers/send-to-number";
import { recipientGate } from "../../../supabase/functions/_shared/action-handlers/whatsapp-helpers";
import { sendTextViaInstance } from "../../../supabase/functions/_shared/whatsapp-dispatch";
import { summarizeConversation } from "../../../supabase/functions/_shared/action-handlers/ai-operations";
import { resolveStrictInstanceForCaller } from "../../../supabase/functions/_shared/instance-write-guard";

const WA_INSTANCE = {
  id: "inst-1",
  instance_name: "main",
  organization_id: "org-1",
  status: "connected",
  provider: "uazapi",
  session_dead_since: null,
};

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
  lead: Record<string, unknown>;
  instances: Record<string, unknown>[];
  withInstance: boolean;
}> = {}) {
  const { sb, mockTable } = createMockSupabase();
  const instances = overrides.instances
    ?? (overrides.withInstance === false ? [] : [WA_INSTANCE]);
  mockTable("whatsapp_instances", instances);
  mockTable("whatsapp_messages", []);
  mockTable("leads", [overrides.lead || LEAD]);

  return {
    input: {
      supabase: sb,
      organizationId: "org-1",
      leadId: overrides.leadId !== undefined ? overrides.leadId : "lead-1",
      conversationId: null,
      params: overrides.params || {
        notifyPhones: ["5511988887777"],
        messageTemplate: "Lead {{nome}} respondeu!",
        whatsappInstanceId: "inst-1",
      },
      executionContext: {},
    },
    sb,
    mockTable,
  };
}

describe("sendToNumber action handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendTextViaInstance).mockResolvedValue({ success: true, messageId: "m1" });
    vi.mocked(summarizeConversation).mockResolvedValue({
      success: true,
      data: { summary: "Lead quente, pediu preço." },
    });
    // Default: every recipient is reachable (gate returns null = no block).
    vi.mocked(recipientGate).mockResolvedValue(null);
  });

  it("returns error when leadId is null", async () => {
    const { input } = makeInput({ leadId: null });
    const result = await sendToNumber(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("leadId");
  });

  it("rejects (non-retryable) when notifyPhones is empty", async () => {
    const { input } = makeInput({
      params: { notifyPhones: [], messageTemplate: "oi", whatsappInstanceId: "inst-1" },
    });
    const result = await sendToNumber(input);
    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(vi.mocked(sendTextViaInstance)).not.toHaveBeenCalled();
  });

  it("rejects (non-retryable) when all numbers are invalid", async () => {
    const { input } = makeInput({
      params: { notifyPhones: ["abc", "  "], messageTemplate: "oi", whatsappInstanceId: "inst-1" },
    });
    const result = await sendToNumber(input);
    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.error).toContain("invalid");
    expect(vi.mocked(sendTextViaInstance)).not.toHaveBeenCalled();
  });

  it("returns error (non-retryable) when no WhatsApp instance is available", async () => {
    const { input } = makeInput({
      withInstance: false,
      params: { notifyPhones: ["5511988887777"], messageTemplate: "oi" },
    });
    const result = await sendToNumber(input);
    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.error).toContain("instance");
  });

  // ── M1: dead / logged-out FROM instance ──────────────────────────────────
  it("bails non-retryably (no send, no storm) when the FROM instance is logged out", async () => {
    const dead = { ...WA_INSTANCE, id: "inst-dead", session_dead_since: "2026-06-01T00:00:00Z" };
    const { input } = makeInput({
      instances: [dead],
      params: { notifyPhones: ["5511988887777"], messageTemplate: "oi", whatsappInstanceId: "inst-dead" },
    });
    const result = await sendToNumber(input);

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.error).toMatch(/deslogada|indispon/i);
    // No send and no per-recipient check were attempted — storm avoided.
    expect(vi.mocked(sendTextViaInstance)).not.toHaveBeenCalled();
    expect(vi.mocked(recipientGate)).not.toHaveBeenCalled();
  });

  it("bails non-retryably when the FROM instance status is not open/connected", async () => {
    const closed = { ...WA_INSTANCE, id: "inst-closed", status: "close" };
    const { input } = makeInput({
      instances: [closed],
      params: { notifyPhones: ["5511988887777"], messageTemplate: "oi", whatsappInstanceId: "inst-closed" },
    });
    const result = await sendToNumber(input);
    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(vi.mocked(sendTextViaInstance)).not.toHaveBeenCalled();
  });

  it("returns error (non-retryable) when message template resolves empty", async () => {
    const { input } = makeInput({
      params: { notifyPhones: ["5511988887777"], messageTemplate: "", whatsappInstanceId: "inst-1" },
    });
    const result = await sendToNumber(input);
    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.error).toContain("Empty");
  });

  it("resolves lead variables and sends to each (normalized) number", async () => {
    const { input } = makeInput({
      params: {
        notifyPhones: ["11988887777", "5521977776666"],
        messageTemplate: "Lead {{nome}} ({{empresa}}) respondeu!",
        whatsappInstanceId: "inst-1",
      },
    });
    const result = await sendToNumber(input);

    expect(result.success).toBe(true);
    expect(vi.mocked(sendTextViaInstance)).toHaveBeenCalledTimes(2);

    const calls = vi.mocked(sendTextViaInstance).mock.calls;
    expect(calls[0][2]).toBe("5511988887777");
    expect(calls[1][2]).toBe("5521977776666");
    expect(calls[0][3]).toBe("Lead Test Lead (Acme) respondeu!");
    expect(result.data?.sent_to).toEqual(["5511988887777", "5521977776666"]);
  });

  it("dedupes numbers that normalize to the same value", async () => {
    const { input } = makeInput({
      params: {
        notifyPhones: ["11988887777", "5511988887777"],
        messageTemplate: "oi",
        whatsappInstanceId: "inst-1",
      },
    });
    const result = await sendToNumber(input);
    expect(result.success).toBe(true);
    expect(vi.mocked(sendTextViaInstance)).toHaveBeenCalledTimes(1);
  });

  // ── L1: recipient pre-flight skips not-on-WhatsApp numbers ────────────────
  it("skips a destination flagged not-on-WhatsApp and surfaces it in data.skipped", async () => {
    vi.mocked(recipientGate)
      .mockResolvedValueOnce(null) // first reachable
      .mockResolvedValueOnce({ success: false, error: "Recipient number is not on WhatsApp", retryable: false });

    const { input } = makeInput({
      params: {
        notifyPhones: ["5511988887777", "5521977776666"],
        messageTemplate: "oi",
        whatsappInstanceId: "inst-1",
      },
    });
    const result = await sendToNumber(input);

    expect(result.success).toBe(true);
    expect(vi.mocked(sendTextViaInstance)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendTextViaInstance).mock.calls[0][2]).toBe("5511988887777");
    expect(result.data?.sent_to).toEqual(["5511988887777"]);
    expect(result.data?.skipped).toEqual(["5521977776666"]);
  });

  it("bails non-retryably (no send) when ALL destinations are not on WhatsApp", async () => {
    vi.mocked(recipientGate).mockResolvedValue({
      success: false,
      error: "Recipient number is not on WhatsApp",
      retryable: false,
    });
    const { input } = makeInput({
      params: {
        notifyPhones: ["5511988887777", "5521977776666"],
        messageTemplate: "oi",
        whatsappInstanceId: "inst-1",
      },
    });
    const result = await sendToNumber(input);

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(vi.mocked(sendTextViaInstance)).not.toHaveBeenCalled();
    expect(result.data?.skipped).toEqual(["5511988887777", "5521977776666"]);
  });

  it("sends to the valid number and reports the format-invalid one (mixed)", async () => {
    const { input } = makeInput({
      params: {
        notifyPhones: ["abc", "11988887777"],
        messageTemplate: "oi",
        whatsappInstanceId: "inst-1",
      },
    });
    const result = await sendToNumber(input);

    expect(result.success).toBe(true);
    expect(vi.mocked(sendTextViaInstance)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendTextViaInstance).mock.calls[0][2]).toBe("5511988887777");
    expect(result.data?.invalid).toEqual(["abc"]);
    expect(result.data?.sent_to).toEqual(["5511988887777"]);
  });

  // ── Design claim: leadId is NOT passed to instance resolution ─────────────
  it("uses the org-default instance and never consults the strict-write resolver", async () => {
    const instX = { ...WA_INSTANCE, id: "inst-x", instance_name: "responsible-bound", last_connection_at: "2026-01-01T00:00:00Z" };
    const instY = { ...WA_INSTANCE, id: "inst-y", instance_name: "org-default", last_connection_at: "2026-06-01T00:00:00Z" };
    const { input } = makeInput({
      instances: [instX, instY],
      // No whatsappInstanceId → org-default fallback (most recent connection = Y).
      params: { notifyPhones: ["5511988887777"], messageTemplate: "oi" },
    });
    const result = await sendToNumber(input);

    expect(result.success).toBe(true);
    expect(vi.mocked(sendTextViaInstance)).toHaveBeenCalledTimes(1);
    // Sent FROM the org-default instance Y, not the responsible-bound X.
    expect((vi.mocked(sendTextViaInstance).mock.calls[0][1] as { id: string }).id).toBe("inst-y");
    // Strict-write lead binding was never consulted (leadId not passed to resolver).
    expect(vi.mocked(resolveStrictInstanceForCaller)).not.toHaveBeenCalled();
  });

  it("appends the AI summary + lead phone when includeConversationSummary is true", async () => {
    const { input } = makeInput({
      params: {
        notifyPhones: ["5511988887777"],
        messageTemplate: "Assuma o lead {{nome}}.",
        includeConversationSummary: true,
        whatsappInstanceId: "inst-1",
      },
    });
    const result = await sendToNumber(input);

    expect(result.success).toBe(true);
    expect(vi.mocked(summarizeConversation)).toHaveBeenCalledTimes(1);
    const sentMessage = vi.mocked(sendTextViaInstance).mock.calls[0][3] as string;
    expect(sentMessage).toContain("Assuma o lead Test Lead.");
    expect(sentMessage).toContain("Resumo da conversa:");
    expect(sentMessage).toContain("Lead quente, pediu preço.");
    expect(sentMessage).toContain("📞 Telefone do lead: 5511999887766");
    expect(result.data?.includedSummary).toBe(true);
  });

  it("does NOT call the summarizer when the flag is off", async () => {
    const { input } = makeInput();
    await sendToNumber(input);
    expect(vi.mocked(summarizeConversation)).not.toHaveBeenCalled();
  });

  it("still sends (with lead phone, no summary block) when the summarizer THROWS", async () => {
    vi.mocked(summarizeConversation).mockRejectedValueOnce(new Error("openrouter down"));
    const { input } = makeInput({
      params: {
        notifyPhones: ["5511988887777"],
        messageTemplate: "Assuma o lead.",
        includeConversationSummary: true,
        whatsappInstanceId: "inst-1",
      },
    });
    const result = await sendToNumber(input);

    expect(result.success).toBe(true);
    const sentMessage = vi.mocked(sendTextViaInstance).mock.calls[0][3] as string;
    expect(sentMessage).toContain("Assuma o lead.");
    expect(sentMessage).not.toContain("Resumo da conversa:");
    expect(sentMessage).toContain("📞 Telefone do lead: 5511999887766");
  });

  it("still sends (with lead phone, no summary block) when the summary is empty", async () => {
    vi.mocked(summarizeConversation).mockResolvedValueOnce({ success: true, data: {} });
    const { input } = makeInput({
      params: {
        notifyPhones: ["5511988887777"],
        messageTemplate: "Assuma o lead.",
        includeConversationSummary: true,
        whatsappInstanceId: "inst-1",
      },
    });
    const result = await sendToNumber(input);

    expect(result.success).toBe(true);
    const sentMessage = vi.mocked(sendTextViaInstance).mock.calls[0][3] as string;
    expect(sentMessage).not.toContain("Resumo da conversa:");
    expect(sentMessage).toContain("📞 Telefone do lead: 5511999887766");
  });

  it("aggregates partial failure as success and reports the failed number", async () => {
    vi.mocked(sendTextViaInstance)
      .mockResolvedValueOnce({ success: true, messageId: "m1" })
      .mockResolvedValueOnce({ success: false, error: "uazapi 500" });

    const { input } = makeInput({
      params: {
        notifyPhones: ["5511988887777", "5521977776666"],
        messageTemplate: "oi",
        whatsappInstanceId: "inst-1",
      },
    });
    const result = await sendToNumber(input);

    expect(result.success).toBe(true);
    expect(result.message).toContain("5521977776666");
    expect(result.data?.sent_to).toEqual(["5511988887777"]);
    expect((result.data?.failed as Array<{ phone: string }>)[0].phone).toBe("5521977776666");
  });

  it("returns transient failure (retryable default) when every send fails on a live instance", async () => {
    vi.mocked(sendTextViaInstance).mockResolvedValue({ success: false, error: "uazapi 500" });

    const { input } = makeInput({
      params: {
        notifyPhones: ["5511988887777", "5521977776666"],
        messageTemplate: "oi",
        whatsappInstanceId: "inst-1",
      },
    });
    const result = await sendToNumber(input);

    expect(result.success).toBe(false);
    expect(result.error).toContain("all 2 number(s)");
    // Live instance + reachable recipients → genuine transient blip → retryable default.
    expect(result.retryable).toBeUndefined();
  });
});
