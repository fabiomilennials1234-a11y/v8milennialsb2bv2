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
  sendWhatsAppDocument,
  sendWhatsAppVideo,
} from "../../../supabase/functions/_shared/action-handlers/send-whatsapp-media";
import { sendMediaViaInstance } from "../../../supabase/functions/_shared/whatsapp-dispatch";

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

// ── Document ──
describe("sendWhatsAppDocument", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns error when leadId is null", async () => {
    const { input } = makeInput({ documentUrl: "https://cdn.test/proposta.pdf" }, { leadId: null });
    const result = await sendWhatsAppDocument(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("leadId");
  });

  it("returns error when no document URL configured", async () => {
    const { input } = makeInput({});
    const result = await sendWhatsAppDocument(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("document URL");
  });

  it("returns error when lead has no phone", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("leads", [{ ...LEAD, phone: null }]);

    const result = await sendWhatsAppDocument({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { documentUrl: "https://cdn.test/proposta.pdf", whatsappInstanceId: "inst-1" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("phone");
  });

  it("sends document successfully", async () => {
    const { input } = makeInput({ documentUrl: "https://cdn.test/proposta.pdf" });
    const result = await sendWhatsAppDocument(input);
    expect(result.success).toBe(true);
    expect(result.message).toContain("document sent");
  });

  it("forwards filename + type=document + caption to the provider (legacy path)", async () => {
    const { input } = makeInput({
      documentUrl: "https://cdn.test/proposta.pdf",
      documentName: "Proposta Comercial.pdf",
      documentCaption: "Segue, {{nome}}!",
    });
    const result = await sendWhatsAppDocument(input);
    expect(result.success).toBe(true);
    expect(sendMediaViaInstance).toHaveBeenCalledTimes(1);
    const mediaArg = (sendMediaViaInstance as unknown as import("vitest").Mock).mock.calls[0][3];
    expect(mediaArg).toMatchObject({
      type: "document",
      file: "https://cdn.test/proposta.pdf",
      filename: "Proposta Comercial.pdf",
    });
  });
});

// ── Video ──
describe("sendWhatsAppVideo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns error when leadId is null", async () => {
    const { input } = makeInput({ videoUrl: "https://cdn.test/demo.mp4" }, { leadId: null });
    const result = await sendWhatsAppVideo(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("leadId");
  });

  it("returns error when no video URL configured", async () => {
    const { input } = makeInput({});
    const result = await sendWhatsAppVideo(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("video URL");
  });

  it("returns error when lead has no phone", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("leads", [{ ...LEAD, phone: null }]);

    const result = await sendWhatsAppVideo({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { videoUrl: "https://cdn.test/demo.mp4", whatsappInstanceId: "inst-1" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("phone");
  });

  it("sends video successfully", async () => {
    const { input } = makeInput({ videoUrl: "https://cdn.test/demo.mp4" });
    const result = await sendWhatsAppVideo(input);
    expect(result.success).toBe(true);
    expect(result.message).toContain("video sent");
  });

  it("forwards type=video + resolved caption to the provider (legacy path)", async () => {
    const { input } = makeInput({
      videoUrl: "https://cdn.test/demo.mp4",
      videoCaption: "Olha isso, {{nome}}!",
    });
    const result = await sendWhatsAppVideo(input);
    expect(result.success).toBe(true);
    expect(sendMediaViaInstance).toHaveBeenCalledTimes(1);
    const mediaArg = (sendMediaViaInstance as unknown as import("vitest").Mock).mock.calls[0][3];
    expect(mediaArg).toMatchObject({
      type: "video",
      file: "https://cdn.test/demo.mp4",
    });
    // videoCaption resolves Template Variables, exactly like imageCaption.
    expect(mediaArg.caption).toContain("Test Lead");
    expect(mediaArg.caption).not.toContain("{{nome}}");
  });
});
