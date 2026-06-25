/**
 * Tests for the unified "Enviar Mensagem" workflow node (send_whatsapp_message).
 *
 * The node carries a `messageType` discriminator and dispatches to the existing
 * per-type WhatsApp handlers — see ADR-0012. These tests exercise external
 * behavior through executeWorkflowAction (the public dispatch entry point).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

vi.mock("../../supabase/functions/_shared/whatsapp-dispatch.ts", () => ({
  sendTextViaInstance: vi.fn().mockResolvedValue({ success: true, messageId: "mock-text-id" }),
  sendMediaViaInstance: vi.fn().mockResolvedValue({ success: true, messageId: "mock-media-id" }),
  sendMenuViaInstance: vi.fn().mockResolvedValue({ success: true, messageId: "mock-menu-id" }),
  sendPixButtonViaInstance: vi.fn().mockResolvedValue({ success: true, messageId: "mock-pix-id" }),
  sendAudioViaInstance: vi.fn().mockResolvedValue({ success: true, messageId: "mock-audio-id" }),
}));

vi.mock("../../supabase/functions/_shared/audio-sender.ts", () => ({
  sendWhatsAppAudio: vi.fn().mockResolvedValue({ success: true, messageId: "mock-audio-direct-id" }),
  sendAudioViaProvider: vi.fn().mockResolvedValue({ success: true, messageId: "mock-audio-provider-id" }),
}));

vi.mock("../../supabase/functions/_shared/message-gateway.ts", () => ({
  sendMessage: vi.fn().mockResolvedValue({ delegated: false, success: true }),
}));

vi.mock("../../supabase/functions/_shared/instance-write-guard.ts", () => ({
  resolveStrictInstanceForCaller: vi.fn().mockResolvedValue(null),
  StrictWriteResolutionError: class extends Error { errorCode = "test"; },
}));

vi.mock("../../supabase/functions/_shared/whatsapp-client.ts", () => ({
  getWhatsAppProvider: vi.fn().mockResolvedValue({ sendAudio: vi.fn() }),
}));

// AI generation — stub so the "Gerar com IA" text mode is deterministic.
vi.mock("../../supabase/functions/_shared/action-handlers/ai-operations.ts", () => ({
  generateAiMessage: vi.fn().mockResolvedValue({ success: true, data: { ai_message: "TEXTO GERADO PELA IA" } }),
  summarizeConversation: vi.fn().mockResolvedValue({ success: true, data: {} }),
  evaluateConversation: vi.fn().mockResolvedValue({ success: true, data: {} }),
  queueScheduleMeeting: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve("") });
global.fetch = mockFetch as any;

beforeEach(() => { clearDenoEnv(); vi.clearAllMocks(); });

import { executeWorkflowAction } from "../../supabase/functions/_shared/workflow-action-handler";

const LEAD = {
  id: "lead-1", name: "Test Lead", phone: "5511999999999", company: "Acme",
  organization_id: "org-1", pipe_whatsapp: "novo", rating: 5,
};
const WA_INSTANCE = { id: "wi-1", organization_id: "org-1", instance_name: "MainInstance", status: "open", is_active: true };

describe("send_whatsapp_message — dispatch by messageType", () => {
  it("messageType 'texto' sends a WhatsApp text via the existing handler", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp_message", messageType: "texto", messageTemplate: "Olá {{nome}}, tudo bem?" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("WhatsApp");
  });

  it("texto 'Gerar com IA' mode generates into a variable then sends the resolved text", async () => {
    const { sendTextViaInstance } = await import("../../supabase/functions/_shared/whatsapp-dispatch");
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: {
        actionType: "send_whatsapp_message",
        messageType: "texto",
        templateMode: "ai",
        aiPrompt: "Gere uma saudação para {{nome}}",
        messageTemplate: "Resposta: {{ai_message}}",
      },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    // The generated text must reach the WhatsApp dispatch (resolved {{ai_message}}).
    const sentText = JSON.stringify(vi.mocked(sendTextViaInstance).mock.calls);
    expect(sentText).toContain("TEXTO GERADO PELA IA");
  });

  it("messageType 'imagem' sends a WhatsApp image via the existing handler", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp_message", messageType: "imagem", imageUrl: "https://cdn.test/img.jpg", imageCaption: "Veja {{nome}}" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("image");
  });

  it("messageType 'audio' sends a WhatsApp audio via the existing handler", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp_message", messageType: "audio", audioUrl: "https://storage.test/a.ogg" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("audio");
  });

  it("messageType 'sticker' sends a WhatsApp sticker via the existing handler", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp_message", messageType: "sticker", stickerUrl: "https://cdn.test/s.webp" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("sticker");
  });

  it("messageType 'menu' sends a WhatsApp interactive menu via the existing handler", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: {
        actionType: "send_whatsapp_message", messageType: "menu",
        menuType: "button", menuText: "Escolha:", menuChoices: ["A", "B"],
      },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("menu");
  });

  it("messageType 'pix' sends a WhatsApp PIX button via the existing handler", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: {
        actionType: "send_whatsapp_message", messageType: "pix",
        pixkey: "11999", pixkeyType: "phone", pixAmount: 100, pixMerchantName: "Acme",
      },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("PIX");
  });

  it("unknown messageType fails cleanly, non-retryable, without sending", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp_message", messageType: "bogus" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect((result.error ?? "").toLowerCase()).toContain("message type");
  });
});
