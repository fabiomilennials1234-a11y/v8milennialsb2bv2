/**
 * Branch coverage for workflow-action-handler.ts — fills gaps in:
 * - resolveVariables (all conditional branches for template variables)
 * - handleMoveStage (confirmacao, propostas, upsell_base, upsell_gestao, custom pipeline)
 * - handleMoveCampaignStage (no campaign, stage not found, name lookup)
 * - handleGenerateAiMessage (API error, empty response, thrown error)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

beforeEach(() => {
  clearDenoEnv();
  vi.clearAllMocks();
  mockFetch.mockReset();
});

import { executeWorkflowAction } from "../../supabase/functions/_shared/workflow-action-handler";

const LEAD_FULL = {
  id: "lead-1",
  name: "Ada Lovelace",
  company: "Analytical Co",
  email: "ada@x.com",
  phone: "11987654321",
  pipe_whatsapp: "novo",
  qualification_score: 80,
  rating: 5,
  sdr_id: "tm-sdr",
  closer_id: "tm-closer",
  responsible_id: "tm-resp",
  organization_id: "org-1",
  faturamento: 10000,
  segment: "B2B",
  urgency: "alta",
  notes: "important",
  origin: "meta_ads",
};

// ─── resolveVariables via handleSendWhatsApp ──────────────────────────────

describe("resolveVariables — template substitution", () => {
  const setupSupabase = () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_FULL]);
    mockTable("whatsapp_instances", [
      { id: "inst-1", instance_name: "Main", organization_id: "org-1", status: "open" },
    ]);
    mockTable("team_members", [
      { id: "tm-sdr", name: "SDR Joe", phone: "11111" },
      { id: "tm-closer", name: "Closer Mary", phone: "22222" },
      { id: "tm-resp", name: "Resp Bob", phone: "33333" },
    ]);
    mockTable("organizations", [{ id: "org-1", name: "Torque CRM Demo" }]);
    mockTable("pipe_confirmacao", [
      { lead_id: "lead-1", meeting_date: "2026-05-15T14:00:00Z" },
    ]);
    mockTable("pipe_propostas", [{ lead_id: "lead-1", sale_value: 5500.75 }]);
    mockTable("campanha_leads", [
      { lead_id: "lead-1", campanha_id: "c1", stage_id: "cs1" },
    ]);
    mockTable("conversation_summaries", [
      {
        lead_id: "lead-1",
        summary: "Lead quer desconto",
        sentiment: "positivo",
        lead_temperature: "quente",
        next_action: "enviar proposta",
      },
    ]);
    mockTable("lead_custom_fields", [
      { id: "cf1", field_name: "cnpj", organization_id: "org-1" },
    ]);
    mockTable("lead_custom_field_values", [
      { lead_id: "lead-1", field_id: "cf1", value: "12.345.678/0001-90" },
    ]);
    return sb;
  };

  const okFetch = () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(""),
    });
  };

  const getSentMessage = (): string => {
    const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    const init = lastCall?.[1] as { body?: string } | undefined;
    if (!init?.body) return "";
    const parsed = JSON.parse(init.body);
    return parsed.text ?? parsed.message ?? "";
  };

  it("resolves standard lead variables", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo");
    setDenoEnv("EVOLUTION_API_KEY", "key");
    okFetch();

    const result = await executeWorkflowAction({
      supabase: setupSupabase(),
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "send_whatsapp",
        messageTemplate:
          "Oi {{nome}} da {{empresa}}, score {{score}}, rating {{rating}}, segmento {{segmento}}, urgencia {{urgencia}}, origem {{origem}}",
      },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    const sent = getSentMessage();
    expect(sent).toContain("Ada Lovelace");
    expect(sent).toContain("Analytical Co");
    expect(sent).toContain("score 80");
    expect(sent).toContain("rating 5");
    expect(sent).toContain("segmento B2B");
    expect(sent).toContain("origem meta_ads");
  });

  it("resolves time-based variables (saudacao / data_hoje / hora_atual)", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo");
    setDenoEnv("EVOLUTION_API_KEY", "key");
    okFetch();

    const result = await executeWorkflowAction({
      supabase: setupSupabase(),
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "send_whatsapp",
        messageTemplate: "{{saudacao}} {{nome}} — {{data_hoje}} às {{hora_atual}}",
      },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    const sent = getSentMessage();
    // Time vars are never empty strings
    expect(sent).not.toContain("{{saudacao}}");
    expect(sent).not.toContain("{{data_hoje}}");
    expect(sent).not.toContain("{{hora_atual}}");
  });

  it("resolves team member variables (sdr, closer, responsavel)", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo");
    setDenoEnv("EVOLUTION_API_KEY", "key");
    okFetch();

    await executeWorkflowAction({
      supabase: setupSupabase(),
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "send_whatsapp",
        messageTemplate:
          "SDR: {{sdr}} | Closer: {{closer}} | Resp: {{responsavel}} ({{responsavel_telefone}})",
      },
      executionContext: {},
    });
    const sent = getSentMessage();
    expect(sent).toContain("SDR Joe");
    expect(sent).toContain("Closer Mary");
    expect(sent).toContain("Resp Bob");
    expect(sent).toContain("33333");
  });

  it("resolves org name and meeting/proposal variables", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo");
    setDenoEnv("EVOLUTION_API_KEY", "key");
    okFetch();
    await executeWorkflowAction({
      supabase: setupSupabase(),
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "send_whatsapp",
        messageTemplate:
          "Empresa {{nome_empresa_crm}}, reunião {{data_reuniao}}, valor {{valor_proposta}}",
      },
      executionContext: {},
    });
    const sent = getSentMessage();
    expect(sent).toContain("Torque CRM Demo");
    expect(sent).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(sent).toContain("R$");
  });

  it("resolves AI variables from conversation_summaries", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo");
    setDenoEnv("EVOLUTION_API_KEY", "key");
    okFetch();
    await executeWorkflowAction({
      supabase: setupSupabase(),
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "send_whatsapp",
        messageTemplate:
          "Resumo: {{ai_resumo}} | sentimento: {{ai_sentimento}} | temp: {{ai_temperatura}} | próxima: {{ai_proxima_acao}}",
      },
      executionContext: {},
    });
    const sent = getSentMessage();
    expect(sent).toContain("Lead quer desconto");
    expect(sent).toContain("positivo");
    expect(sent).toContain("quente");
  });

  it("resolves custom fields via {{custom.cnpj}}", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo");
    setDenoEnv("EVOLUTION_API_KEY", "key");
    okFetch();
    await executeWorkflowAction({
      supabase: setupSupabase(),
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "send_whatsapp",
        messageTemplate: "CNPJ: {{custom.cnpj}}",
      },
      executionContext: {},
    });
    const sent = getSentMessage();
    expect(sent).toContain("12.345.678/0001-90");
  });

  it("prefers executionContext values over DB lookups for pre-computed vars", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo");
    setDenoEnv("EVOLUTION_API_KEY", "key");
    okFetch();
    await executeWorkflowAction({
      supabase: setupSupabase(),
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "send_whatsapp",
        messageTemplate: "Mensagem IA: {{ai_message}}",
      },
      executionContext: { ai_message: "Olá gerada pela IA" },
    });
    const sent = getSentMessage();
    expect(sent).toContain("Olá gerada pela IA");
  });

  it("leaves template unchanged when lead missing", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo");
    setDenoEnv("EVOLUTION_API_KEY", "key");
    okFetch();
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", []);
    mockTable("whatsapp_instances", [
      { id: "inst-1", instance_name: "Main", organization_id: "org-1", status: "open" },
    ]);

    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "missing",
      nodeData: { actionType: "send_whatsapp", messageTemplate: "Oi {{nome}}" },
      executionContext: {},
    });
    // No lead found → getLeadPhone fails → overall result is an error
    expect(result.success).toBe(false);
  });
});

// ─── handleMoveStage — every pipe type ────────────────────────────────────

describe("handleMoveStage — all pipe types", () => {
  it("returns error when targetStage missing", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_FULL]);
    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: { actionType: "move_stage", pipeType: "whatsapp" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("target stage");
  });

  it("whatsapp — inserts new pipe_whatsapp row when none exists", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_FULL]);
    mockTable("pipe_whatsapp", []);
    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "move_stage",
        pipeType: "whatsapp",
        targetStage: "agendado",
      },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("agendado");
  });

  it("confirmacao — updates existing row", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_FULL]);
    mockTable("pipe_confirmacao", [{ id: "pc1", lead_id: "lead-1" }]);
    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "move_stage",
        pipeType: "confirmacao",
        targetStage: "confirmar_d3",
      },
      executionContext: {},
    });
    expect(result.success).toBe(true);
  });

  it("confirmacao — inserts when no row", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("pipe_confirmacao", []);
    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "move_stage",
        pipeType: "confirmacao",
        targetStage: "reuniao_marcada",
      },
      executionContext: {},
    });
    expect(result.success).toBe(true);
  });

  it("propostas — updates existing row", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("pipe_propostas", [{ id: "pp1", lead_id: "lead-1" }]);
    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "move_stage",
        pipeType: "propostas",
        targetStage: "proposta_enviada",
      },
      executionContext: {},
    });
    expect(result.success).toBe(true);
  });

  it("propostas — inserts when no row", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("pipe_propostas", []);
    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "move_stage",
        pipeType: "propostas",
        targetStage: "vendido",
      },
      executionContext: {},
    });
    expect(result.success).toBe(true);
  });

  it("upsell_base — updates tipo_cliente_tempo", async () => {
    const { sb } = createMockSupabase();
    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "move_stage",
        pipeType: "upsell_base",
        targetStage: "recorrente",
      },
      executionContext: {},
    });
    expect(result.success).toBe(true);
  });

  it("upsell_gestao — updates gestao_stage", async () => {
    const { sb } = createMockSupabase();
    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "move_stage",
        pipeType: "upsell_gestao",
        targetStage: "avaliacao",
      },
      executionContext: {},
    });
    expect(result.success).toBe(true);
  });

  it("custom pipeline — target stage not found returns error", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("custom_pipeline_stages", []);
    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "move_stage",
        pipeType: "custom-pipeline-uuid",
        targetStage: "stage-missing",
      },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("custom pipeline — inserts new entry on first move", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("custom_pipeline_stages", [
      {
        id: "stage-target",
        pipeline_id: "pipe-custom",
        organization_id: "org-1",
        is_final_positive: false,
      },
    ]);
    mockTable("custom_pipe_entries", []);
    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "move_stage",
        pipeType: "pipe-custom",
        targetStage: "stage-target",
      },
      executionContext: {},
    });
    expect(result.success).toBe(true);
  });

  it("custom pipeline — is_final_positive triggers auto-transition to standard pipe", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("custom_pipeline_stages", [
      {
        id: "stage-target",
        pipeline_id: "pipe-custom",
        organization_id: "org-1",
        is_final_positive: true,
        target_pipe_type: "propostas",
        target_stage_key: "proposta_enviada",
      },
    ]);
    mockTable("custom_pipe_entries", [
      { id: "cpe1", lead_id: "lead-1", pipeline_id: "pipe-custom" },
    ]);
    mockTable("pipe_propostas", []);
    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "move_stage",
        pipeType: "pipe-custom",
        targetStage: "stage-target",
      },
      executionContext: {},
    });
    expect(result.success).toBe(true);
  });

  it("custom pipeline — is_final_positive with target_pipeline_id transitions to another custom pipeline", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("custom_pipeline_stages", [
      {
        id: "stage-target",
        pipeline_id: "pipe-A",
        organization_id: "org-1",
        is_final_positive: true,
        target_pipeline_id: "pipe-B",
        target_stage_id: "stage-B-start",
      },
    ]);
    mockTable("custom_pipe_entries", [
      { id: "cpe1", lead_id: "lead-1", pipeline_id: "pipe-A" },
    ]);
    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "move_stage",
        pipeType: "pipe-A",
        targetStage: "stage-target",
      },
      executionContext: {},
    });
    expect(result.success).toBe(true);
  });
});

// ─── handleMoveCampaignStage ──────────────────────────────────────────────

describe("handleMoveCampaignStage", () => {
  it("rejects when campaignId missing", async () => {
    const { sb } = createMockSupabase();
    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: { actionType: "move_campaign_stage", campaignStageId: "cs1" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("campaign");
  });

  it("rejects when stage cannot be resolved", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("campanha_stages", []);
    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "move_campaign_stage",
        campaignId: "c1",
        campaignStageName: "Qualificação",
      },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("stage");
  });

  it("resolves stage by name via ilike lookup", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("campanha_stages", [
      { id: "cs1", name: "Qualificação", campanha_id: "c1" },
    ]);
    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "move_campaign_stage",
        campaignId: "c1",
        campaignStageName: "qualificação",
      },
      executionContext: {},
    });
    expect(result.success).toBe(true);
  });

  it("uses stage_id directly when provided", async () => {
    const { sb } = createMockSupabase();
    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "move_campaign_stage",
        campaignId: "c1",
        campaignStageId: "cs-direct",
      },
      executionContext: {},
    });
    expect(result.success).toBe(true);
  });
});

// ─── handleGenerateAiMessage — API error paths ────────────────────────────

describe("handleGenerateAiMessage — error paths", () => {
  it("returns error when OPENROUTER_API_KEY missing", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_FULL]);
    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "generate_ai_message",
        aiPrompt: "Escreva algo",
      },
      executionContext: {},
    });
    expect(result.success).toBe(false);
  });

  it("returns error when OpenRouter returns non-ok response", async () => {
    setDenoEnv("OPENROUTER_API_KEY", "key");
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_FULL]);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("internal error"),
    });
    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "generate_ai_message",
        aiPrompt: "Escreva algo",
      },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("OpenRouter");
  });

  it("returns error when OpenRouter returns empty content", async () => {
    setDenoEnv("OPENROUTER_API_KEY", "key");
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_FULL]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ choices: [{ message: { content: "" } }] }),
    });
    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "generate_ai_message",
        aiPrompt: "Escreva algo",
      },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/vazia|empty/i);
  });

  it("catches thrown errors from fetch", async () => {
    setDenoEnv("OPENROUTER_API_KEY", "key");
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_FULL]);
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "generate_ai_message",
        aiPrompt: "Escreva algo",
      },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/network down|Erro ao gerar/);
  });

  it("stores generated message under custom aiOutputVariable", async () => {
    setDenoEnv("OPENROUTER_API_KEY", "key");
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [LEAD_FULL]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: " Olá, posso ajudar? " } }],
        }),
    });
    const context: Record<string, unknown> = {};
    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: {
        actionType: "generate_ai_message",
        aiPrompt: "Gere saudação",
        aiOutputVariable: "greeting",
      },
      executionContext: context,
    });
    expect(result.success).toBe(true);
    expect(context.greeting).toBe("Olá, posso ajudar?");
  });
});
