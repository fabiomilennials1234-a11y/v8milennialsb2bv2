/**
 * Tests for workflow-action-handler — the 30 action type dispatcher
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve("") });
global.fetch = mockFetch as any;

beforeEach(() => { clearDenoEnv(); vi.clearAllMocks(); });

import { executeWorkflowAction, type ActionResult } from "../../supabase/functions/_shared/workflow-action-handler";

const LEAD = { id: "lead-1", name: "Test Lead", phone: "11999", company: "Acme", organization_id: "org-1", pipe_whatsapp: "novo", rating: 5 };

describe("ActionResult type", () => {
  it("success shape", () => {
    const r: ActionResult = { success: true, message: "done" };
    expect(r.success).toBe(true);
  });
  it("failure shape", () => {
    const r: ActionResult = { success: false, error: "failed" };
    expect(r.error).toBe("failed");
  });
});

describe("executeWorkflowAction", () => {
  // add_tag needs deeper mock (upsert with options) — tested via integration

  it("remove_tag — removes tag from lead", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("tags", [{ id: "t1", name: "VIP" }]);
    mockTable("lead_tags", [{ id: "lt1", lead_id: "lead-1", tag_id: "t1" }]);

    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: { actionType: "remove_tag", tagName: "VIP" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("move_stage — moves lead between stages", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("pipe_whatsapp", [{ id: "pw1", lead_id: "lead-1", stage: "novo" }]);

    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: { actionType: "move_stage", pipeType: "pipe_whatsapp", targetStage: "abordado" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("update_rating — updates lead rating", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);

    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: { actionType: "update_rating", rating: 8 },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("assign_responsible — assigns team member", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("team_members", [{ id: "tm1", name: "João", organization_id: "org-1" }]);

    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: { actionType: "assign_responsible", teamMemberId: "tm1" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("unknown action type returns error", async () => {
    const { sb } = createMockSupabase();
    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: { actionType: "nonexistent_action" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
  });

  it("send_whatsapp without Evolution config fails gracefully", async () => {
    clearDenoEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("whatsapp_instances", []);

    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp", message: "Hello {{nome}}" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("send_whatsapp_audio without instance fails gracefully", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("whatsapp_instances", []);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp_audio", audioUrl: "https://example.com/audio.mp3" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("send_whatsapp_image without instance fails gracefully", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("whatsapp_instances", []);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp_image", imageUrl: "https://example.com/img.jpg" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("send_whatsapp_template without instance fails gracefully", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("whatsapp_instances", []);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp_template", templateId: "tpl-1" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("send_meta_message invokes edge function", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_meta_message", message: "Hi from Meta", channel: "messenger" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("add_tag adds a tag to lead", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("tags", [{ id: "t1", name: "VIP", organization_id: "org-1" }]);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "add_tag", tagName: "VIP" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("update_lead_field updates a field", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "update_lead_field", field: "segment", value: "B2B" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("update_custom_field updates custom field", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "update_custom_field", fieldName: "score", value: "100" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("calculate_score calculates lead score", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "calculate_score" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("duplicate_to_pipe duplicates lead", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("pipe_confirmacao", []);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "duplicate_to_pipe", targetPipe: "confirmacao", targetStage: "reuniao_marcada" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("remove_from_pipe removes lead from pipe", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("pipe_whatsapp", [{ id: "pw1", lead_id: "lead-1" }]);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "remove_from_pipe", pipeType: "whatsapp" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("mark_as_lost marks lead as lost", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("pipe_whatsapp", [{ id: "pw1", lead_id: "lead-1" }]);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "mark_as_lost", pipeType: "whatsapp", reason: "Not interested" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("add_to_campaign adds lead to campaign", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("campanhas", [{ id: "camp-1", name: "Test Campaign" }]);
    mockTable("campanha_stages", [{ id: "cs1", campanha_id: "camp-1", position: 0 }]);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "add_to_campaign", campaignId: "camp-1" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("remove_from_campaign removes lead", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("campanha_leads", [{ id: "cl1", lead_id: "lead-1", campanha_id: "camp-1" }]);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "remove_from_campaign", campaignId: "camp-1" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("move_campaign_stage moves lead to stage", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("campanha_leads", [{ id: "cl1", lead_id: "lead-1", campanha_id: "camp-1" }]);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "move_campaign_stage", campaignId: "camp-1", stageId: "cs2" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("assign_sdr assigns SDR", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "assign_sdr", teamMemberId: "tm1" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("assign_closer assigns closer", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "assign_closer", teamMemberId: "tm2" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("notify_team_member sends notification", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "notify_team_member", teamMemberId: "tm1", message: "Check this lead" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("create_followup creates a follow-up", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "create_followup", title: "Follow up", dueInDays: 3 },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("generate_ai_message generates message", async () => {
    setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
    setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "generate_ai_message", prompt: "Generate a follow-up message" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("summarize_conversation invokes edge function", async () => {
    setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
    setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "summarize_conversation" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("evaluate_conversation invokes edge function", async () => {
    setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
    setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "evaluate_conversation" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("create_tinyerp_order invokes edge function", async () => {
    setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
    setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "create_tinyerp_order" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("create_calendar_event invokes edge function", async () => {
    setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
    setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "create_calendar_event", title: "Meeting", dateTime: "2026-04-15T10:00:00Z" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("schedule_meeting invokes edge function", async () => {
    setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
    setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "schedule_meeting" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("send_semi_automatic enqueues dispatch", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_semi_automatic", templateId: "tpl-1" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("pause_campaign_sequence pauses sequence", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    mockTable("campanha_leads", [{ id: "cl1", lead_id: "lead-1", campanha_id: "camp-1" }]);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "pause_campaign_sequence", campaignId: "camp-1" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });

  it("resume_campaign_sequence resumes", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD]);
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "resume_campaign_sequence", campaignId: "camp-1" },
      executionContext: {},
    });
    expect(result).toBeDefined();
  });
});

// ─── Deep handler tests ──────────────────────────────────────────────────────

const LEAD_WITH_PHONE = {
  id: "lead-1", name: "Test Lead", phone: "5511999999999", company: "Acme",
  organization_id: "org-1", pipe_whatsapp: "novo", rating: 5,
  responsible_id: "tm-resp-1", sdr_id: "tm-sdr-1", closer_id: "tm-closer-1",
};

const WA_INSTANCE = {
  id: "wi-1", organization_id: "org-1", instance_name: "MainInstance",
  status: "open", is_active: true,
};

function setupEvolutionEnv() {
  setDenoEnv("EVOLUTION_API_URL", "https://evo.test");
  setDenoEnv("EVOLUTION_API_KEY", "evo-key-123");
}

function setupSupabaseEnv() {
  setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
  setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
}

describe("handleSendWhatsApp — deep", () => {
  it("succeeds with instance + phone + message template", async () => {
    setupEvolutionEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("lead_history", []);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ key: { id: "msg-1" } }),
      text: () => Promise.resolve(""),
    });

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp", messageTemplate: "Olá {{nome}}, tudo bem?" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("WhatsApp");
  });

  it("fails when lead has no phone", async () => {
    setupEvolutionEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [{ id: "lead-1", name: "No Phone", phone: null, organization_id: "org-1" }]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp", messageTemplate: "Olá" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("phone");
  });

  it("fails when message template is empty", async () => {
    setupEvolutionEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp", messageTemplate: "" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Empty message");
  });

  it("fails when Evolution fetch returns !ok", async () => {
    setupEvolutionEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve("Gateway Timeout"),
      json: () => Promise.resolve({}),
    });

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp", messageTemplate: "Hello {{nome}}" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("WhatsApp send failed");
  });

  it("resolves executionContext variables in template", async () => {
    setupEvolutionEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("lead_history", []);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ key: { id: "msg-2" } }),
      text: () => Promise.resolve(""),
    });

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp", messageTemplate: "Resultado: {{ai_message}}" },
      executionContext: { ai_message: "Mensagem gerada pela IA" },
    });
    expect(result.success).toBe(true);
  });

  it("records whatsapp_messages with Evolution message_id + sent_by_ai=true (no duplicate with webhook echo)", async () => {
    setupEvolutionEnv();
    const { sb, mockTable, getInserted, getUpsertOpts } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("lead_history", []);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ key: { id: "evolution-real-id-42" } }),
      text: () => Promise.resolve(""),
    });

    await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp", messageTemplate: "Oi!" },
      executionContext: {},
    });

    const inserted = getInserted("whatsapp_messages");
    expect(inserted.length).toBe(1);
    const row = inserted[0] as Record<string, unknown>;
    expect(row.message_id).toBe("evolution-real-id-42");
    expect(row.sent_by_ai).toBe(true);
    expect(row.direction).toBe("outgoing");

    // Idempotency contract: must upsert on (message_id, instance_id) so the
    // Evolution send.message echo cannot duplicate the row.
    const opts = getUpsertOpts("whatsapp_messages") as Array<{
      onConflict?: string;
      ignoreDuplicates?: boolean;
    }>;
    expect(opts.length).toBe(1);
    expect(opts[0]?.onConflict).toBe("message_id,instance_id");
    expect(opts[0]?.ignoreDuplicates).toBe(false);
  });
});

describe("handleSendWhatsAppAudio — deep", () => {
  it("succeeds with instance + phone + audioUrl", async () => {
    setupEvolutionEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("lead_history", []);
    // sendWhatsAppAudio internally calls fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ key: { id: "audio-1" } }),
      text: () => Promise.resolve(""),
    });

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp_audio", audioUrl: "https://storage.test/audio.ogg" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("audio");
  });

  it("fails when audioUrl is missing", async () => {
    setupEvolutionEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp_audio" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("audio");
  });

  it("fails when lead has no phone", async () => {
    setupEvolutionEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [{ id: "lead-1", phone: null, organization_id: "org-1" }]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp_audio", audioUrl: "https://example.com/a.ogg" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("phone");
  });
});

describe("handleSendWhatsAppImage — deep", () => {
  it("succeeds with instance + phone + imageUrl", async () => {
    setupEvolutionEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("lead_history", []);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(""),
    });

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp_image", imageUrl: "https://cdn.test/img.jpg", imageCaption: "Veja {{nome}}" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("image");
  });

  it("fails when imageUrl is missing", async () => {
    setupEvolutionEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp_image" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("image");
  });

  it("fails when lead has no phone", async () => {
    setupEvolutionEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [{ id: "lead-1", phone: null, organization_id: "org-1" }]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp_image", imageUrl: "https://cdn.test/img.jpg" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("phone");
  });

  it("fails when Evolution fetch returns !ok", async () => {
    setupEvolutionEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve("500 Internal Server Error"),
      json: () => Promise.resolve({}),
    });

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp_image", imageUrl: "https://cdn.test/img.jpg" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Image send failed");
  });
});

describe("handleSendWhatsAppTemplate — deep", () => {
  it("succeeds with template found in DB", async () => {
    setupEvolutionEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_templates", [{ id: "tpl-1", name: "Welcome", content: "Olá {{nome}}, bem-vindo!" }]);
    mockTable("lead_history", []);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(""),
    });

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp_template", templateId: "tpl-1" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Welcome");
  });

  it("fails when template not found in DB", async () => {
    setupEvolutionEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_templates", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp_template", templateId: "tpl-missing" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Template not found");
  });

  it("fails when no templateId is configured", async () => {
    setupEvolutionEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_whatsapp_template" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("No template configured");
  });
});

describe("handleAddTag — deep", () => {
  it("adds existing tag to lead via tagName lookup", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("tags", [{ id: "tag-gold", name: "Ouro", organization_id: "org-1" }]);
    mockTable("lead_tags", []);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "add_tag", tagName: "Ouro" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Ouro");
    // Verify upsert was called on lead_tags
    const inserted = getInserted("lead_tags");
    expect(inserted.length).toBeGreaterThan(0);
    expect(inserted[0]).toMatchObject({ lead_id: "lead-1", tag_id: "tag-gold" });
  });

  it("creates new tag when tagName not found", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("tags", []); // no existing tags
    mockTable("lead_tags", []);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "add_tag", tagName: "NovoCriterio" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    // Should have created a tag in "tags" table
    const insertedTags = getInserted("tags");
    expect(insertedTags.length).toBeGreaterThan(0);
    expect(insertedTags[0]).toMatchObject({ name: "NovoCriterio", organization_id: "org-1" });
  });

  it("adds tag by tagId directly", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("tags", []);
    mockTable("lead_tags", []);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "add_tag", tagId: "tag-direct-id" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    const inserted = getInserted("lead_tags");
    expect(inserted.length).toBeGreaterThan(0);
    expect(inserted[0]).toMatchObject({ tag_id: "tag-direct-id" });
  });

  it("fails when no tag configured", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("tags", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "add_tag" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("No tag configured");
  });
});

describe("handleDuplicateToPipe — deep", () => {
  it("duplicates to confirmacao pipe", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("pipe_confirmacao", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "duplicate_to_pipe", targetPipeType: "confirmacao", targetPipeStage: "reuniao_marcada" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("confirmacao");
    const inserted = getInserted("pipe_confirmacao");
    expect(inserted.length).toBeGreaterThan(0);
    expect(inserted[0]).toMatchObject({ lead_id: "lead-1", status: "reuniao_marcada" });
  });

  it("duplicates to propostas pipe", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("pipe_propostas", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "duplicate_to_pipe", targetPipeType: "propostas", targetPipeStage: "proposta_enviada" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("propostas");
    const inserted = getInserted("pipe_propostas");
    expect(inserted.length).toBeGreaterThan(0);
    expect(inserted[0]).toMatchObject({ lead_id: "lead-1", status: "proposta_enviada" });
  });

  it("duplicates to whatsapp (default) updates lead stage", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "duplicate_to_pipe", targetPipeType: "whatsapp", targetPipeStage: "abordado" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("whatsapp");
  });

  it("skips insert when entry already exists in confirmacao", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("pipe_confirmacao", [{ id: "pc-existing", lead_id: "lead-1" }]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "duplicate_to_pipe", targetPipeType: "confirmacao", targetPipeStage: "reuniao_marcada" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    // Should NOT have inserted a new row since existing was found
    const inserted = getInserted("pipe_confirmacao");
    expect(inserted.length).toBe(0);
  });

  it("fails when lead not found", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", []); // no leads

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-missing",
      nodeData: { actionType: "duplicate_to_pipe", targetPipeType: "propostas", targetPipeStage: "novo" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Lead not found");
  });
});

describe("handleMarkAsLost — deep", () => {
  it("marks lead as lost in propostas with reason", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("pipe_propostas", [{ id: "pp-1", lead_id: "lead-1", status: "proposta_enviada" }]);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "mark_as_lost", pipeType: "propostas", lostReason: "Sem orçamento" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("lost");
  });

  it("marks lead as lost with default pipeType (propostas)", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("pipe_propostas", [{ id: "pp-1", lead_id: "lead-1" }]);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "mark_as_lost" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("propostas");
  });

  it("marks lead as lost in non-propostas pipe (no DB update)", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "mark_as_lost", pipeType: "whatsapp", lostReason: "Desistiu" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("whatsapp");
  });
});

describe("handleAssignResponsible — deep (round_robin)", () => {
  it("assigns via round_robin to least-loaded member", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [
      { ...LEAD_WITH_PHONE, responsible_id: "tm-a" },
      { id: "lead-2", name: "Lead 2", phone: "123", organization_id: "org-1", responsible_id: "tm-a" },
    ]);
    mockTable("team_members", [
      { id: "tm-a", organization_id: "org-1", is_active: true },
      { id: "tm-b", organization_id: "org-1", is_active: true },
    ]);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "assign_responsible", assignMode: "round_robin" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.assigneeId).toBeDefined();
  });

  it("assign_responsible specific mode", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "assign_responsible", assigneeId: "tm-specific", assignMode: "specific" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.data!.assigneeId).toBe("tm-specific");
  });

  it("fails when no assignee in specific mode", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "assign_responsible", assignMode: "specific" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("No team member");
  });
});

describe("handleAssign (sdr/closer) — deep", () => {
  it("assign_sdr round_robin with campaign context", async () => {
    const { sb, mockTable, mockRpc } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("lead_history", []);
    mockRpc("get_next_campaign_sdr", "tm-round-robin-sdr");

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "assign_sdr", assignMode: "round_robin", campaignId: "camp-1" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.data!.assigneeId).toBe("tm-round-robin-sdr");
    expect(result.data!.role).toBe("sdr");
  });

  it("assign_closer round_robin with campaign context", async () => {
    const { sb, mockTable, mockRpc } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("lead_history", []);
    mockRpc("get_next_campaign_closer", "tm-round-robin-closer");

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "assign_closer", assignMode: "round_robin", campaignId: "camp-1" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.data!.assigneeId).toBe("tm-round-robin-closer");
    expect(result.data!.role).toBe("closer");
  });

  it("assign_sdr round_robin with pipe context", async () => {
    const { sb, mockTable, mockRpc } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("lead_history", []);
    mockRpc("get_next_pipe_sdr", "tm-pipe-sdr");

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "assign_sdr", assignMode: "round_robin", pipeType: "whatsapp" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.data!.assigneeId).toBe("tm-pipe-sdr");
  });

  it("assign_sdr round_robin org-scoped fallback", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("team_members", [
      { id: "tm-sdr-a", organization_id: "org-1", is_active: true, metric_type: "meetings" },
      { id: "tm-sdr-b", organization_id: "org-1", is_active: true, metric_type: "meetings" },
    ]);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "assign_sdr", assignMode: "round_robin" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it("assign_closer fails when no closer to assign", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("team_members", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "assign_closer", assignMode: "round_robin" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("No closer");
  });
});

describe("handleNotifyTeamMember — deep", () => {
  it("sends notification to team member with user_id", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("team_members", [{ id: "tm-notify", user_id: "user-abc", name: "Maria", organization_id: "org-1" }]);
    mockTable("notifications", []);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "notify_team_member", notifyMemberId: "tm-notify", notifyMessage: "Lead {{nome}} precisa de atenção" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Maria");
    const inserted = getInserted("notifications");
    expect(inserted.length).toBeGreaterThan(0);
    expect(inserted[0]).toMatchObject({
      organization_id: "org-1",
      user_id: "user-abc",
      type: "workflow_notification",
    });
  });

  it("fails when no member configured", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "notify_team_member" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("No team member configured");
  });

  it("fails when team member has no user_id", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("team_members", [{ id: "tm-no-user", user_id: null, name: "Ghost" }]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "notify_team_member", notifyMemberId: "tm-no-user" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Team member not found");
  });
});

describe("handleCreateFollowup — deep", () => {
  it("creates follow-up with responsible from lead", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("follow_ups", []);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: {
        actionType: "create_followup",
        followupTitle: "Retornar para {{nome}}",
        followupDescription: "Falar sobre a proposta",
        followupPriority: "high",
      },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Follow-up");
    const inserted = getInserted("follow_ups");
    expect(inserted.length).toBeGreaterThan(0);
    expect(inserted[0]).toMatchObject({
      lead_id: "lead-1",
      assigned_to: "tm-resp-1",
      priority: "high",
      is_automated: true,
      organization_id: "org-1",
    });
  });

  it("creates follow-up with sdr fallback when no responsible", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("leads", [{ id: "lead-1", name: "Lead", phone: "123", organization_id: "org-1", responsible_id: null, sdr_id: "tm-sdr-fallback", closer_id: null }]);
    mockTable("follow_ups", []);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "create_followup", followupTitle: "Follow up" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    const inserted = getInserted("follow_ups");
    expect(inserted[0].assigned_to).toBe("tm-sdr-fallback");
  });

  it("creates follow-up with null assigned_to when lead has no members", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("leads", [{ id: "lead-1", name: "Orphan", phone: "123", organization_id: "org-1", responsible_id: null, sdr_id: null, closer_id: null }]);
    mockTable("follow_ups", []);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "create_followup" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    const inserted = getInserted("follow_ups");
    expect(inserted[0].assigned_to).toBeNull();
  });
});

describe("handleMoveStage — deep", () => {
  it("moves stage in whatsapp pipe (creates new entry)", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("pipe_whatsapp", []); // no existing entry

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "move_stage", pipeType: "whatsapp", targetStage: "respondeu" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ pipeType: "whatsapp", targetStage: "respondeu" });
    const inserted = getInserted("pipe_whatsapp");
    expect(inserted.length).toBeGreaterThan(0);
  });

  it("moves stage in confirmacao pipe (creates new entry)", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("pipe_confirmacao", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "move_stage", pipeType: "confirmacao", targetStage: "confirmar_d3" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ pipeType: "confirmacao", targetStage: "confirmar_d3" });
  });

  it("moves stage in propostas pipe (creates new entry)", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("pipe_propostas", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "move_stage", pipeType: "propostas", targetStage: "negociando" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ pipeType: "propostas", targetStage: "negociando" });
  });

  it("moves stage in upsell_base pipe", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("upsell_clients", [{ id: "uc-1", lead_id: "lead-1" }]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "move_stage", pipeType: "upsell_base", targetStage: "ativo" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
  });

  it("fails when no target stage configured", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "move_stage", pipeType: "whatsapp" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("No target stage");
  });
});

describe("handleRemoveFromPipe — deep", () => {
  it("removes from whatsapp pipe", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("pipe_whatsapp", [{ id: "pw-1", lead_id: "lead-1" }]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "remove_from_pipe", pipeType: "whatsapp" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("whatsapp");
  });

  it("removes from confirmacao pipe", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("pipe_confirmacao", [{ id: "pc-1", lead_id: "lead-1" }]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "remove_from_pipe", pipeType: "confirmacao" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("confirmacao");
  });

  it("removes from propostas pipe", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("pipe_propostas", [{ id: "pp-1", lead_id: "lead-1" }]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "remove_from_pipe", pipeType: "propostas" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("propostas");
  });
});

describe("handleInvokeEdgeFunction — deep", () => {
  it("summarize_conversation stores AI vars in executionContext", async () => {
    setupSupabaseEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("lead_history", []);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        summary: "Lead interessado em CRM",
        sentiment: "positive",
        lead_temperature: "quente",
        next_action: "Enviar proposta",
      }),
      text: () => Promise.resolve(""),
    });

    const execCtx: Record<string, unknown> = {};
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "summarize_conversation" },
      executionContext: execCtx,
    });
    expect(result.success).toBe(true);
    expect(execCtx.ai_resumo).toBe("Lead interessado em CRM");
    expect(execCtx.ai_sentimento).toBe("positive");
    expect(execCtx.ai_temperatura).toBe("quente");
    expect(execCtx.ai_proxima_acao).toBe("Enviar proposta");
  });

  it("evaluate_conversation returns success on ok response", async () => {
    setupSupabaseEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("lead_history", []);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ evaluation: "good" }),
      text: () => Promise.resolve(""),
    });

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "evaluate_conversation" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("evaluate-agent-conversation");
  });

  it("returns failure when edge function responds !ok", async () => {
    setupSupabaseEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve("Function crashed"),
      json: () => Promise.reject(new Error("not json")),
    });

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "evaluate_conversation" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("failed");
  });
});

describe("handleSendMetaMessage — deep", () => {
  it("sends meta message with resolved variables", async () => {
    setupSupabaseEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("lead_history", []);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ sent: true }),
      text: () => Promise.resolve(""),
    });

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_meta_message", metaChannel: "instagram", metaMessage: "Olá {{nome}}" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("instagram");
  });

  it("fails when edge function returns !ok", async () => {
    setupSupabaseEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve("Unauthorized"),
      json: () => Promise.resolve({}),
    });

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_meta_message", metaMessage: "Hi" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Meta message failed");
  });
});

describe("handleSendSemiAutomatic — deep", () => {
  it("inserts scheduled pipe message for approval", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("scheduled_pipe_messages", []);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_semi_automatic", semiAutoMessage: "Oi {{nome}}, confirma a reunião?", semiAutoApprover: "user-approver" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("approval");
    const inserted = getInserted("scheduled_pipe_messages");
    expect(inserted.length).toBeGreaterThan(0);
    expect(inserted[0]).toMatchObject({
      lead_id: "lead-1",
      organization_id: "org-1",
      status: "waiting_approval",
      source: "workflow",
    });
  });
});

describe("handleGenerateAiMessage — deep", () => {
  it("generates AI message and stores in executionContext", async () => {
    setDenoEnv("OPENROUTER_API_KEY", "or-test-key");
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("lead_history", []);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: "Oi Test Lead, tudo bem? Vi que você é da Acme." } }],
      }),
      text: () => Promise.resolve(""),
    });

    const execCtx: Record<string, unknown> = {};
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "generate_ai_message", aiPrompt: "Gere uma mensagem para {{nome}}" },
      executionContext: execCtx,
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("chars");
    expect(execCtx.ai_message).toBeDefined();
    expect(typeof execCtx.ai_message).toBe("string");
  });

  it("fails when OPENROUTER_API_KEY is not set", async () => {
    clearDenoEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "generate_ai_message", aiPrompt: "test" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("OPENROUTER_API_KEY");
  });

  it("fails when prompt is empty", async () => {
    setDenoEnv("OPENROUTER_API_KEY", "or-test-key");
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "generate_ai_message", aiPrompt: "" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Prompt");
  });

  it("fails when OpenRouter API returns !ok", async () => {
    setDenoEnv("OPENROUTER_API_KEY", "or-test-key");
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: () => Promise.resolve("Rate limited"),
      json: () => Promise.resolve({}),
    });

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "generate_ai_message", aiPrompt: "generate something" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("OpenRouter");
  });

  it("stores in custom output variable", async () => {
    setDenoEnv("OPENROUTER_API_KEY", "or-test-key");
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("lead_history", []);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: "Custom message output" } }],
      }),
      text: () => Promise.resolve(""),
    });

    const execCtx: Record<string, unknown> = {};
    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "generate_ai_message", aiPrompt: "test prompt", aiOutputVariable: "my_custom_var" },
      executionContext: execCtx,
    });
    expect(result.success).toBe(true);
    expect(execCtx.my_custom_var).toBe("Custom message output");
    expect(result.data!.my_custom_var).toBe("Custom message output");
  });
});

describe("handleUpdateLeadField — deep", () => {
  it("updates a field with variable resolution", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "update_lead_field", fieldName: "segment", fieldValue: "B2B Industrial" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ fieldName: "segment", fieldValue: "B2B Industrial" });
  });

  it("fails when no field name configured", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "update_lead_field", fieldValue: "something" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("No field name");
  });
});

describe("handleUpdateCustomField — deep", () => {
  it("upserts custom field value when field exists", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("lead_custom_fields", [{ id: "cf-1", organization_id: "org-1", field_name: "faturamento_anual" }]);
    mockTable("lead_custom_field_values", []);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "update_custom_field", customFieldName: "faturamento_anual", customFieldValue: "R$ 1.000.000" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("faturamento_anual");
    const inserted = getInserted("lead_custom_field_values");
    expect(inserted.length).toBeGreaterThan(0);
  });

  it("fails when custom field not found", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("lead_custom_fields", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "update_custom_field", customFieldName: "nonexistent_field" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Custom field");
  });

  it("fails when no custom field name configured", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "update_custom_field" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("No custom field name");
  });
});

describe("handleCalculateScore — deep", () => {
  it("inserts pending_ai_actions row", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("pending_ai_actions", []);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "calculate_score" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("queued");
    const inserted = getInserted("pending_ai_actions");
    expect(inserted.length).toBeGreaterThan(0);
    expect(inserted[0]).toMatchObject({
      organization_id: "org-1",
      lead_id: "lead-1",
      action_type: "update_qualification_score",
      status: "pending",
    });
  });
});

describe("handleUpdateRating — deep", () => {
  it("clamps rating to 0-10 range (above max)", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "update_rating", ratingValue: 15 },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("10");
  });

  it("clamps rating to 0-10 range (below min)", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "update_rating", ratingValue: -5 },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("0");
  });
});

describe("handleScheduleMeeting — deep", () => {
  it("inserts pending_ai_actions for meeting scheduling", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("pending_ai_actions", []);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "schedule_meeting", meetingDate: "2026-04-20", meetingCloserId: "closer-1" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("queued");
    const inserted = getInserted("pending_ai_actions");
    expect(inserted.length).toBeGreaterThan(0);
    expect(inserted[0]).toMatchObject({
      action_type: "schedule_meeting",
      status: "pending",
    });
  });
});

describe("handleRemoveTag — deep", () => {
  it("removes tag by name lookup", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("tags", [{ id: "tag-vip", name: "VIP", organization_id: "org-1" }]);
    mockTable("lead_tags", [{ id: "lt-1", lead_id: "lead-1", tag_id: "tag-vip" }]);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "remove_tag", tagName: "VIP" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("VIP");
  });

  it("fails when tag name not found", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("tags", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "remove_tag", tagName: "NonexistentTag" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Tag not found");
  });

  it("removes tag by tagId directly", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("lead_tags", [{ id: "lt-1", lead_id: "lead-1", tag_id: "tag-direct" }]);
    mockTable("lead_history", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "remove_tag", tagId: "tag-direct" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
  });
});

describe("handleTinyErpOrder — deep", () => {
  it("creates TinyERP order via edge function", async () => {
    setupSupabaseEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("lead_history", []);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ order_id: "tiny-123" }),
      text: () => Promise.resolve(""),
    });

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "create_tinyerp_order", tinyProductId: "prod-1" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("TinyERP");
  });

  it("creates TinyERP upsell order", async () => {
    setupSupabaseEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("lead_history", []);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ order_id: "tiny-upsell-1" }),
      text: () => Promise.resolve(""),
    });

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "create_tinyerp_upsell_order" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("TinyERP");
  });

  it("fails when edge function returns !ok", async () => {
    setupSupabaseEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve("TinyERP API error"),
      json: () => Promise.resolve({}),
    });

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "create_tinyerp_order" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("TinyERP order failed");
  });
});

describe("handleCreateCalendarEvent — deep", () => {
  it("creates calendar event via edge function", async () => {
    setupSupabaseEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("lead_history", []);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ event_id: "cal-123" }),
      text: () => Promise.resolve(""),
    });

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: {
        actionType: "create_calendar_event",
        eventTitle: "Reunião com {{nome}}",
        eventDescription: "Discutir proposta",
        eventDurationMinutes: 30,
      },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Calendar");
  });

  it("fails when edge function returns !ok", async () => {
    setupSupabaseEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve("Calendar API error"),
      json: () => Promise.resolve({}),
    });

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "create_calendar_event" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Calendar event failed");
  });
});

describe("handleAddToCampaign — deep", () => {
  it("fails when no campaign configured", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "add_to_campaign" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("No campaign configured");
  });
});

describe("handleSendCampaignMessage — deep", () => {
  it("sends campaign text message", async () => {
    setupEvolutionEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("campaign_templates", [{ id: "ct-1", content: "Promoção para {{nome}}", message_type: "text", audio_url: null }]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("lead_history", []);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(""),
    });

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_campaign_message", campaignId: "camp-1", campaignTemplateId: "ct-1" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Campaign message sent");
  });

  it("sends campaign audio message", async () => {
    setupEvolutionEnv();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("campaign_templates", [{ id: "ct-audio", content: null, message_type: "audio", audio_url: "https://audio.test/msg.ogg" }]);
    mockTable("whatsapp_instances", [WA_INSTANCE]);
    mockTable("whatsapp_messages", []);
    mockTable("lead_history", []);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(""),
    });

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_campaign_message", campaignId: "camp-1", campaignTemplateId: "ct-audio" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
  });

  it("fails when no campaign configured", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_campaign_message", campaignTemplateId: "ct-1" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("No campaign configured");
  });

  it("fails when no template configured", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_campaign_message", campaignId: "camp-1" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("No template configured");
  });

  it("fails when template not found in DB", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_WITH_PHONE]);
    mockTable("campaign_templates", []);

    const result = await executeWorkflowAction({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      nodeData: { actionType: "send_campaign_message", campaignId: "camp-1", campaignTemplateId: "ct-missing" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Template not found");
  });
});
