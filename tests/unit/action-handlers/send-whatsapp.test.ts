// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../helpers/deno-mock";
import { createMockSupabase } from "../../helpers/supabase-mock";

// Mock whatsapp-dispatch (dynamic import inside handler)
vi.mock("../../../supabase/functions/_shared/whatsapp-dispatch.ts", () => ({
  sendTextViaInstance: vi.fn().mockResolvedValue({ success: true, messageId: "mock-text-id" }),
}));

// Mock message-gateway
vi.mock("../../../supabase/functions/_shared/message-gateway.ts", () => ({
  sendMessage: vi.fn().mockResolvedValue({ delegated: false, success: true }),
}));

// Mock instance-write-guard (dynamic import)
vi.mock("../../../supabase/functions/_shared/instance-write-guard.ts", () => ({
  resolveStrictInstanceForCaller: vi.fn().mockResolvedValue(null),
  StrictWriteResolutionError: class extends Error { errorCode = "test"; },
}));

// Mock time-variables
vi.mock("../../../supabase/functions/_shared/time-variables.ts", () => ({
  getTimeBasedVariables: vi.fn().mockReturnValue({ saudacao: "Bom dia", data: "18/05/2026", hora: "10:00" }),
}));

// Mock pipeline-adapter
vi.mock("../../../supabase/functions/_shared/pipeline-adapter.ts", () => ({
  getPipeEntry: vi.fn().mockResolvedValue(null),
}));

// Mock send-dedup — default: not a duplicate (existing tests send normally).
vi.mock("../../../supabase/functions/_shared/send-dedup.ts", () => ({
  reserveSendOrSkip: vi.fn().mockResolvedValue({ duplicate: false }),
}));

// Partial-mock whatsapp-helpers: keep the real resolvers, but control the
// recipient reachability gate. Default (unset) → undefined → no gate.
vi.mock("../../../supabase/functions/_shared/action-handlers/whatsapp-helpers.ts", async (orig) => ({
  ...(await (orig as () => Promise<Record<string, unknown>>)()),
  recipientGate: vi.fn(),
}));

import { sendWhatsApp } from "../../../supabase/functions/_shared/action-handlers/send-whatsapp";
import { recipientGate } from "../../../supabase/functions/_shared/action-handlers/whatsapp-helpers";
import { sendMessage } from "../../../supabase/functions/_shared/message-gateway";
import { sendTextViaInstance } from "../../../supabase/functions/_shared/whatsapp-dispatch";
import { reserveSendOrSkip } from "../../../supabase/functions/_shared/send-dedup";
import { saoPauloUsageDate } from "../../../supabase/functions/_shared/quick-blast/daily-budget";

const WA_INSTANCE = {
  id: "inst-1",
  instance_name: "main",
  organization_id: "org-1",
  status: "connected",
  provider: "uazapi",
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
}> = {}) {
  const { sb, mockTable } = createMockSupabase();
  mockTable("whatsapp_instances", [WA_INSTANCE]);
  mockTable("whatsapp_messages", []);
  mockTable("leads", [LEAD]);

  return {
    input: {
      supabase: sb,
      organizationId: "org-1",
      leadId: overrides.leadId !== undefined ? overrides.leadId : "lead-1",
      conversationId: null,
      params: overrides.params || {
        messageTemplate: "Oi {{nome}}!",
        whatsappInstanceId: "inst-1",
      },
      executionContext: {},
    },
    sb,
    mockTable,
  };
}

describe("sendWhatsApp action handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when leadId is null", async () => {
    const { input } = makeInput({ leadId: null });
    const result = await sendWhatsApp(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("leadId");
  });

  it("skips the send (no provider call) when the content-dedup flags a duplicate", async () => {
    vi.mocked(reserveSendOrSkip).mockResolvedValueOnce({ duplicate: true });
    const { input } = makeInput();
    const result = await sendWhatsApp(input);
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/duplicate/i);
    // Neither the gateway nor the legacy provider send was attempted.
    expect(vi.mocked(sendMessage)).not.toHaveBeenCalled();
    expect(vi.mocked(sendTextViaInstance)).not.toHaveBeenCalled();
  });

  it("returns error when no WhatsApp instance available", async () => {
    const { sb } = createMockSupabase();
    // No instances mocked
    const result = await sendWhatsApp({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { messageTemplate: "Hello" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("instance");
  });

  it("returns error when lead has no phone", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("leads", [{ ...LEAD, phone: null }]);

    const result = await sendWhatsApp({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { messageTemplate: "Hello" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("phone");
  });

  it("returns error when message template is empty", async () => {
    const { input } = makeInput({ params: { messageTemplate: "", whatsappInstanceId: "inst-1" } });
    const result = await sendWhatsApp(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Empty");
  });

  it("sends text successfully via legacy path", async () => {
    const { input } = makeInput();
    const result = await sendWhatsApp(input);
    expect(result.success).toBe(true);
    expect(result.message).toContain("text sent");
  });

  it("returns retryable:false and skips the send when recipient is not on WhatsApp", async () => {
    vi.mocked(recipientGate).mockResolvedValueOnce({
      success: false,
      error: "Recipient number is not on WhatsApp",
      retryable: false,
    });

    const { input } = makeInput();
    const result = await sendWhatsApp(input);

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.error).toContain("not on WhatsApp");
    // The gate short-circuits before any send is attempted.
    expect(vi.mocked(sendMessage)).not.toHaveBeenCalled();
    expect(vi.mocked(sendTextViaInstance)).not.toHaveBeenCalled();
  });
});

describe("sendWhatsApp — Send Governor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Acceptance: master flag OFF must be byte-identical to the legacy behaviour —
  // the send goes out normally, with no deferUntil.
  it("flag OFF is a perfect no-op: sends normally, no deferUntil", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("leads", [LEAD]);
    mockTable("organizations", [{ id: "org-1", workflow_send_governor_enabled: false }]);

    const result = await sendWhatsApp({
      supabase: sb, organizationId: "org-1", leadId: "lead-1", conversationId: null,
      params: { messageTemplate: "Oi {{nome}}!", whatsappInstanceId: "inst-1", _nodeId: "n1" },
      executionContext: {},
    });

    expect(result.success).toBe(true);
    expect(result.deferUntil).toBeUndefined();
    expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(1);
  });

  // Enforce + per-number cap exhausted → DEFER (never fail), and NO send happens.
  it("defers instead of sending when the number's daily cap is exhausted", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_instances", [{ ...WA_INSTANCE, daily_blast_cap: 80 }]);
    mockTable("whatsapp_messages", []);
    mockTable("leads", [LEAD]);
    mockTable("organizations", [{
      id: "org-1",
      workflow_send_governor_enabled: true,
      workflow_send_governor: {
        jitter: { mode: "off" },
        instance_cap: { mode: "enforce" },
        org_cap: { mode: "off" },
        quiet_hours: { mode: "off" },
      },
      daily_blast_budget: 200,
    }]);
    mockTable("blast_instance_daily_usage", [
      { instance_id: "inst-1", usage_date: saoPauloUsageDate(new Date()), leads_sent: 999 },
    ]);

    const result = await sendWhatsApp({
      supabase: sb, organizationId: "org-1", leadId: "lead-1", conversationId: null,
      params: { messageTemplate: "Oi {{nome}}!", whatsappInstanceId: "inst-1", _nodeId: "n1" },
      executionContext: {},
    });

    expect(result.success).toBe(true);
    expect(typeof result.deferUntil).toBe("string");
    expect(new Date(result.deferUntil!).getTime()).toBeGreaterThan(Date.now());
    // Crucially: no message was sent — it was deferred, not delivered or failed.
    expect(vi.mocked(sendMessage)).not.toHaveBeenCalled();
    expect(vi.mocked(sendTextViaInstance)).not.toHaveBeenCalled();
  });
});
