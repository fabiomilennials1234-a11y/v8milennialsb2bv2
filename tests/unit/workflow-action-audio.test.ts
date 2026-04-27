/**
 * Regression test for workflow send_whatsapp_audio node.
 *
 * Bug: handleSendWhatsAppAudio was calling the legacy sendWhatsAppAudio
 * helper with wrong arity — (instanceName, phone, audioUrl) instead of
 * (supabaseAdmin, instanceId, phone, audioUrl). The helper then ran
 * `supabaseAdmin.from(...)` on a string, yielding the runtime error
 * "supabaseAdmin.from is not a function" in automation executions.
 *
 * Fix: handler now resolves the provider via getWhatsAppProvider and
 * calls sendAudioViaProvider directly (same pattern as the other media
 * handlers). This test guards that contract.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { clearDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

const sendMediaMock = vi.fn();

vi.mock("../../supabase/functions/_shared/whatsapp-client.ts", () => ({
  getWhatsAppProvider: vi.fn(async () => ({
    provider: "uazapi",
    sendMedia: sendMediaMock,
  })),
}));

beforeEach(() => {
  clearDenoEnv();
  vi.clearAllMocks();
  sendMediaMock.mockReset();
});

import { executeWorkflowAction } from "../../supabase/functions/_shared/workflow-action-handler";

const LEAD = {
  id: "lead-1",
  name: "Test Lead",
  phone: "11999999999",
  company: "Acme",
  organization_id: "org-1",
  pipe_whatsapp: "novo",
  rating: 5,
};

const INSTANCE = {
  id: "inst-1",
  organization_id: "org-1",
  provider: "uazapi",
  instance_name: "main",
  status: "connected",
};

describe("workflow action: send_whatsapp_audio", () => {
  it("resolves provider and sends audio as PTT — no supabaseAdmin.from regression", async () => {
    sendMediaMock.mockResolvedValue({ message_id: "uaz-msg-1" });
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("whatsapp_instances", [INSTANCE]);

    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "send_whatsapp_audio",
        whatsappInstanceId: "inst-1",
        audioUrl: "https://cdn.example.com/a.ogg",
      },
      executionContext: {},
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    // The literal regression string must never resurface
    expect(result.error ?? "").not.toContain("supabaseAdmin.from is not a function");

    expect(sendMediaMock).toHaveBeenCalledTimes(1);
    const payload = sendMediaMock.mock.calls[0][0];
    expect(payload.type).toBe("ptt");
    expect(payload.file).toBe("https://cdn.example.com/a.ogg");
    expect(payload.number).toBe("5511999999999");
    expect(payload.trackSource).toBe("workflow-action-audio");
  });

  it("returns structured error when no audio URL configured", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("whatsapp_instances", [INSTANCE]);

    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "send_whatsapp_audio",
        whatsappInstanceId: "inst-1",
      },
      executionContext: {},
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("No audio URL configured");
    expect(sendMediaMock).not.toHaveBeenCalled();
  });

  it("propagates provider failure as handler error", async () => {
    sendMediaMock.mockRejectedValue(new Error("network down"));
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("whatsapp_instances", [INSTANCE]);

    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "send_whatsapp_audio",
        whatsappInstanceId: "inst-1",
        audioUrl: "https://cdn.example.com/a.ogg",
      },
      executionContext: {},
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("network down");
  });

  it("fails cleanly when lead has no phone — no provider call", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [{ ...LEAD, phone: null }]);
    mockTable("whatsapp_instances", [INSTANCE]);

    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "send_whatsapp_audio",
        whatsappInstanceId: "inst-1",
        audioUrl: "https://cdn.example.com/a.ogg",
      },
      executionContext: {},
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("phone");
    expect(sendMediaMock).not.toHaveBeenCalled();
  });

  it("upserts whatsapp_messages row with provider message_id + correct idempotency key", async () => {
    sendMediaMock.mockResolvedValue({ message_id: "uaz-real-id-42" });
    const { sb, mockTable, getInserted, getUpsertOpts } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("whatsapp_instances", [INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("lead_history", []);

    await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "send_whatsapp_audio",
        whatsappInstanceId: "inst-1",
        audioUrl: "https://cdn.example.com/a.ogg",
      },
      executionContext: {},
    });

    const inserted = getInserted("whatsapp_messages");
    expect(inserted.length).toBe(1);
    const row = inserted[0] as Record<string, unknown>;
    expect(row.message_id).toBe("uaz-real-id-42");
    expect(row.message_type).toBe("audio");
    expect(row.direction).toBe("outgoing");
    expect(row.sent_by_ai).toBe(true);
    expect(row.media_url).toBe("https://cdn.example.com/a.ogg");

    // Idempotency contract: upsert on (message_id, instance_id) so the
    // inbound webhook echo cannot create a duplicate row.
    const opts = getUpsertOpts("whatsapp_messages") as Array<{
      onConflict?: string;
      ignoreDuplicates?: boolean;
    }>;
    expect(opts[0]?.onConflict).toBe("message_id,instance_id");
    expect(opts[0]?.ignoreDuplicates).toBe(false);
  });
});
