// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../helpers/deno-mock";
import { createMockSupabase } from "../../helpers/supabase-mock";

vi.mock("../../../supabase/functions/_shared/whatsapp-dispatch.ts", () => ({
  sendMediaViaInstance: vi.fn().mockResolvedValue({ success: true, messageId: "mock-media-id" }),
}));

vi.mock("../../../supabase/functions/_shared/audio-sender.ts", () => ({
  sendAudioViaProvider: vi.fn().mockResolvedValue({ success: true, messageId: "mock-audio-id" }),
}));

vi.mock("../../../supabase/functions/_shared/whatsapp-client.ts", () => ({
  getWhatsAppProvider: vi.fn().mockResolvedValue({ sendAudio: vi.fn() }),
}));

vi.mock("../../../supabase/functions/_shared/message-gateway.ts", () => ({
  sendMessage: vi.fn().mockResolvedValue({ delegated: false, success: true }),
}));

vi.mock("../../../supabase/functions/_shared/instance-write-guard.ts", () => ({
  resolveStrictInstanceForCaller: vi.fn().mockResolvedValue(null),
  StrictWriteResolutionError: class extends Error { errorCode = "test"; },
}));

vi.mock("../../../supabase/functions/_shared/time-variables.ts", () => ({
  getTimeBasedVariables: vi.fn().mockReturnValue({ saudacao: "Bom dia", data: "18/05/2026", hora: "10:00" }),
}));

vi.mock("../../../supabase/functions/_shared/pipeline-adapter.ts", () => ({
  getPipeEntry: vi.fn().mockResolvedValue(null),
}));

import {
  sendWhatsAppAudio,
  sendWhatsAppImage,
  sendWhatsAppSticker,
} from "../../../supabase/functions/_shared/action-handlers/send-whatsapp-media";

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

function makeInput(params: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
  const { sb, mockTable } = createMockSupabase();
  mockTable("whatsapp_instances", [WA_INSTANCE]);
  mockTable("whatsapp_messages", []);
  mockTable("leads", [LEAD]);

  return {
    input: {
      supabase: sb,
      organizationId: "org-1",
      leadId: overrides.leadId !== undefined ? overrides.leadId as string : "lead-1",
      conversationId: null,
      params: { whatsappInstanceId: "inst-1", ...params },
      executionContext: {},
    },
    sb,
    mockTable,
  };
}

// ── Audio ──
describe("sendWhatsAppAudio", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns error when leadId is null", async () => {
    const { input } = makeInput({ audioUrl: "https://cdn.test/audio.ogg" }, { leadId: null });
    const result = await sendWhatsAppAudio(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("leadId");
  });

  it("returns error when no audio URL configured", async () => {
    const { input } = makeInput({});
    const result = await sendWhatsAppAudio(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("audio URL");
  });

  it("returns error when lead has no phone", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("leads", [{ ...LEAD, phone: null }]);

    const result = await sendWhatsAppAudio({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { audioUrl: "https://cdn.test/audio.ogg", whatsappInstanceId: "inst-1" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("phone");
  });

  it("sends audio successfully", async () => {
    const { input } = makeInput({ audioUrl: "https://cdn.test/audio.ogg" });
    const result = await sendWhatsAppAudio(input);
    expect(result.success).toBe(true);
    expect(result.message).toContain("audio sent");
  });
});

// ── Image ──
describe("sendWhatsAppImage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns error when no image URL configured", async () => {
    const { input } = makeInput({});
    const result = await sendWhatsAppImage(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("image URL");
  });

  it("returns error when lead has no phone", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("leads", [{ ...LEAD, phone: null }]);

    const result = await sendWhatsAppImage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { imageUrl: "https://cdn.test/img.png", whatsappInstanceId: "inst-1" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("phone");
  });

  it("sends image successfully", async () => {
    const { input } = makeInput({ imageUrl: "https://cdn.test/img.png" });
    const result = await sendWhatsAppImage(input);
    expect(result.success).toBe(true);
    expect(result.message).toContain("image sent");
  });

  it("resolves caption variables", async () => {
    const { input } = makeInput({
      imageUrl: "https://cdn.test/img.png",
      imageCaption: "Oi {{nome}}!",
    });
    const result = await sendWhatsAppImage(input);
    expect(result.success).toBe(true);
  });
});

// ── Sticker ──
describe("sendWhatsAppSticker", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns error when no sticker URL configured", async () => {
    const { input } = makeInput({});
    const result = await sendWhatsAppSticker(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("sticker URL");
  });

  it("sends sticker successfully", async () => {
    const { input } = makeInput({ stickerUrl: "https://cdn.test/sticker.webp" });
    const result = await sendWhatsAppSticker(input);
    expect(result.success).toBe(true);
    expect(result.message).toContain("sticker sent");
  });
});
