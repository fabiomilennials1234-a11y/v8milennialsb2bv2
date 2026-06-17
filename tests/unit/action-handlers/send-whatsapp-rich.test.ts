// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../helpers/deno-mock";
import { createMockSupabase } from "../../helpers/supabase-mock";

vi.mock("../../../supabase/functions/_shared/whatsapp-dispatch.ts", () => ({
  sendTextViaInstance: vi.fn().mockResolvedValue({ success: true, messageId: "mock-text-id" }),
  sendMenuViaInstance: vi.fn().mockResolvedValue({ success: true, messageId: "mock-menu-id" }),
  sendPixButtonViaInstance: vi.fn().mockResolvedValue({ success: true, messageId: "mock-pix-id" }),
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
  sendWhatsAppTemplate,
  sendWhatsAppMenu,
  sendWhatsAppPixButton,
} from "../../../supabase/functions/_shared/action-handlers/send-whatsapp-rich";

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

// ── Template ──
describe("sendWhatsAppTemplate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns error when leadId is null", async () => {
    const { input } = makeInput({ templateId: "tpl-1" }, { leadId: null });
    const result = await sendWhatsAppTemplate(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("leadId");
  });

  it("returns error when no template configured", async () => {
    const { input } = makeInput({});
    const result = await sendWhatsAppTemplate(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("template");
  });

  it("returns error when template not found in DB", async () => {
    const { input } = makeInput({ templateId: "tpl-nonexistent" });
    // whatsapp_templates table not mocked → returns null
    const result = await sendWhatsAppTemplate(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Template not found");
  });

  it("sends template successfully", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("leads", [LEAD]);
    mockTable("whatsapp_templates", [{ id: "tpl-1", name: "Welcome", content: "Oi {{nome}}!" }]);

    const result = await sendWhatsAppTemplate({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { templateId: "tpl-1", whatsappInstanceId: "inst-1" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Welcome");
  });
});

// ── Menu ──
describe("sendWhatsAppMenu", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns error when no phone", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("leads", [{ ...LEAD, phone: null }]);

    const result = await sendWhatsAppMenu({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: {
        menuType: "button",
        menuText: "Choose",
        menuChoices: ["A", "B"],
        whatsappInstanceId: "inst-1",
      },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("phone");
  });

  it("returns error on invalid menuType", async () => {
    const { input } = makeInput({
      menuType: "invalid_type",
      menuText: "Choose",
      menuChoices: ["A", "B"],
    });
    const result = await sendWhatsAppMenu(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("menuType");
  });

  it("returns error when no choices provided", async () => {
    const { input } = makeInput({
      menuType: "button",
      menuText: "Choose",
      menuChoices: [],
    });
    const result = await sendWhatsAppMenu(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("choice");
  });

  it("returns error when menu text is empty", async () => {
    const { input } = makeInput({
      menuType: "button",
      menuText: "",
      menuChoices: ["A", "B"],
    });
    const result = await sendWhatsAppMenu(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("menu text");
  });

  it("sends button menu successfully", async () => {
    const { input } = makeInput({
      menuType: "button",
      menuText: "Choose one",
      menuChoices: ["Option A", "Option B"],
    });
    const result = await sendWhatsAppMenu(input);
    expect(result.success).toBe(true);
    expect(result.message).toContain("menu sent");
  });
});

// ── PIX Button ──
describe("sendWhatsAppPixButton", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns error when missing PIX config", async () => {
    const { input } = makeInput({ pixkey: "test@test.com" });
    const result = await sendWhatsAppPixButton(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("PIX config");
  });

  it("returns error on invalid pixkeyType", async () => {
    const { input } = makeInput({
      pixkey: "test@test.com",
      pixkeyType: "invalid",
      pixAmount: 100,
      pixMerchantName: "Acme Corp",
    });
    const result = await sendWhatsAppPixButton(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("pixkeyType");
  });

  it("returns error when lead has no phone", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("leads", [{ ...LEAD, phone: null }]);

    const result = await sendWhatsAppPixButton({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: {
        pixkey: "test@test.com",
        pixkeyType: "email",
        pixAmount: 100,
        pixMerchantName: "Acme Corp",
        whatsappInstanceId: "inst-1",
      },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("phone");
  });

  it("sends PIX button successfully", async () => {
    const { input } = makeInput({
      pixkey: "test@test.com",
      pixkeyType: "email",
      pixAmount: 100,
      pixMerchantName: "Acme Corp",
    });
    const result = await sendWhatsAppPixButton(input);
    expect(result.success).toBe(true);
    expect(result.message).toContain("PIX");
  });
});
