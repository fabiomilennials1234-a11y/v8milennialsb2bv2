// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../helpers/deno-mock";
import { createMockSupabase } from "../../helpers/supabase-mock";

// Mock whatsapp-dispatch (dynamic import inside handler)
vi.mock("../../../supabase/functions/_shared/whatsapp-dispatch.ts", () => ({
  sendTextViaInstance: vi.fn().mockResolvedValue({ success: true, messageId: "mock-text-id" }),
  sendAudioViaInstance: vi.fn().mockResolvedValue({ success: true, messageId: "mock-audio-id" }),
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

import { sendCampaignMessage } from "../../../supabase/functions/_shared/action-handlers/send-campaign-message";

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

const TEMPLATE = {
  id: "tpl-1",
  content: "Oi {{nome}}, tudo bem?",
  message_type: "text",
  audio_url: null,
};

function makeInput(overrides: Partial<{
  params: Record<string, unknown>;
  leadId: string | null;
}> = {}) {
  const { sb, mockTable, getInserted } = createMockSupabase();
  mockTable("whatsapp_instances", [WA_INSTANCE]);
  mockTable("whatsapp_messages", []);
  mockTable("leads", [LEAD]);
  mockTable("campaign_templates", [TEMPLATE]);

  return {
    input: {
      supabase: sb,
      organizationId: "org-1",
      leadId: overrides.leadId !== undefined ? overrides.leadId : "lead-1",
      conversationId: null,
      params: overrides.params || {
        campaignId: "camp-1",
        campaignTemplateId: "tpl-1",
        whatsappInstanceId: "inst-1",
        _executionId: "exec-1",
        _nodeId: "node-1",
      },
      executionContext: {},
    },
    sb,
    mockTable,
    getInserted,
  };
}

describe("sendCampaignMessage action handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when no campaignId provided", async () => {
    const { input } = makeInput({
      params: { campaignTemplateId: "tpl-1" },
    });
    const result = await sendCampaignMessage(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("campaign");
  });

  it("returns error when no template configured", async () => {
    const { input } = makeInput({
      params: { campaignId: "camp-1" },
    });
    const result = await sendCampaignMessage(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("template");
  });

  it("returns error when template not found in DB", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("leads", [LEAD]);
    mockTable("campaign_templates", []);

    const result = await sendCampaignMessage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: {
        campaignId: "camp-1",
        campaignTemplateId: "tpl-missing",
      },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("returns error when lead has no phone", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("leads", [{ ...LEAD, phone: null }]);
    mockTable("campaign_templates", [TEMPLATE]);

    const result = await sendCampaignMessage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: {
        campaignId: "camp-1",
        campaignTemplateId: "tpl-1",
        whatsappInstanceId: "inst-1",
      },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("phone");
  });

  it("sends text campaign message successfully via legacy path", async () => {
    const { input } = makeInput();
    const result = await sendCampaignMessage(input);
    expect(result.success).toBe(true);
    expect(result.message).toContain("Campaign message sent");
  });

  it("sends audio campaign message when template is audio type", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("leads", [LEAD]);
    mockTable("campaign_templates", [{
      ...TEMPLATE,
      message_type: "audio",
      audio_url: "https://storage.test/audio.ogg",
    }]);

    const result = await sendCampaignMessage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: {
        campaignId: "camp-1",
        campaignTemplateId: "tpl-1",
        whatsappInstanceId: "inst-1",
        _executionId: "exec-1",
      },
      executionContext: {},
    });
    expect(result.success).toBe(true);
  });
});
