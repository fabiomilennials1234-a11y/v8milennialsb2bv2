/**
 * Tests for context-loader.ts DB loaders (8 funções):
 * loadCapabilities, loadOrgCustomFields, loadPipelineStages,
 * loadDocumentSummaries, loadConversation, loadLeadData, loadProductCatalog,
 * loadConversationContextSummary + getDefaultContext.
 */

import { describe, it, expect, beforeEach } from "vitest";
import "../../helpers/deno-mock";
import { createMockSupabase } from "../../helpers/supabase-mock";
import {
  loadCapabilities,
  loadOrgCustomFields,
  loadPipelineStages,
  loadDocumentSummaries,
  loadConversation,
  loadLeadData,
  loadProductCatalog,
  loadConversationContextSummary,
  getDefaultContext,
  clearCapabilitiesCache,
} from "../../../supabase/functions/_shared/copilot/context-loader.ts";

const ORG = "00000000-0000-0000-0000-000000000001";
const LEAD = "11111111-1111-1111-1111-111111111111";
const AGENT = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  clearCapabilitiesCache();
});

describe("getDefaultContext", () => {
  it("retorna shape válido com defaults seguros", () => {
    const ctx = getDefaultContext();
    expect(ctx.keyPoints).toEqual([]);
    expect(ctx.objectionsRaised).toEqual([]);
    expect(ctx.questionsAsked).toEqual([]);
    expect(ctx.qualificationData).toEqual({});
    expect(ctx.leadTemperature).toBe("cold");
    expect(ctx.engagementScore).toBe(0);
    expect(ctx.messageCount).toBe(0);
    expect(ctx.followupCount).toBe(0);
  });
});

describe("loadOrgCustomFields", () => {
  it("retorna lista de field_name ordenada", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("lead_custom_fields", [
      { field_name: "cnpj", organization_id: ORG, display_order: 1 },
      { field_name: "segment", organization_id: ORG, display_order: 2 },
    ]);
    const result = await loadOrgCustomFields(sb, ORG);
    expect(result.length).toBe(2);
    expect(result[0].field_name).toBe("cnpj");
  });

  it("retorna [] se org sem custom fields", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("lead_custom_fields", []);
    const result = await loadOrgCustomFields(sb, ORG);
    expect(result).toEqual([]);
  });
});

describe("loadPipelineStages", () => {
  it("retorna stages ativos", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("pipeline_stages", [
      { stage_key: "novo", name: "Novo", pipeline_type: "whatsapp", organization_id: ORG, is_active: true, position: 1 },
      { stage_key: "abordado", name: "Abordado", pipeline_type: "whatsapp", organization_id: ORG, is_active: true, position: 2 },
    ]);
    const result = await loadPipelineStages(sb, ORG);
    expect(result.length).toBe(2);
    expect(result[0].stage_key).toBe("novo");
  });

  it("retorna [] se org sem stages", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("pipeline_stages", []);
    expect(await loadPipelineStages(sb, ORG)).toEqual([]);
  });
});

describe("loadDocumentSummaries", () => {
  it("retorna file_names com summary vazio (conteúdo via search_knowledge)", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("copilot_agent_documents", [
      { file_name: "manual.pdf", agent_id: AGENT, status: "ready" },
      { file_name: "faq.pdf", agent_id: AGENT, status: "ready" },
    ]);
    const result = await loadDocumentSummaries(sb, AGENT);
    expect(result.length).toBe(2);
    expect(result[0]).toEqual({ file_name: "manual.pdf", summary: "" });
  });

  it("retorna [] se agente sem docs ready", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("copilot_agent_documents", []);
    expect(await loadDocumentSummaries(sb, AGENT)).toEqual([]);
  });
});

describe("loadConversation", () => {
  it("retorna conversation tenant-isolated", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("conversations", [
      { id: "conv-1", lead_id: LEAD, agent_id: AGENT, organization_id: ORG, state: "QUALIFYING", turn_count: 5, created_at: "2026-04-26T10:00:00Z" },
    ]);
    const result = await loadConversation(sb, LEAD, AGENT, ORG);
    expect(result).toBeDefined();
    expect((result as Record<string, unknown>).id).toBe("conv-1");
    expect((result as Record<string, unknown>).state).toBe("QUALIFYING");
  });

  it("retorna null se conversa não existe", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("conversations", []);
    expect(await loadConversation(sb, LEAD, AGENT, ORG)).toBeNull();
  });

  it("filtra por agent_id (tenant isolation)", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("conversations", [
      { id: "conv-other-agent", lead_id: LEAD, agent_id: "other-agent", organization_id: ORG, state: "QUALIFYING" },
    ]);
    const result = await loadConversation(sb, LEAD, AGENT, ORG);
    expect(result).toBeNull(); // outro agent_id, não retorna
  });
});

describe("loadLeadData", () => {
  it("retorna lead enriquecido com pipes + custom fields", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [
      { id: LEAD, name: "João", phone: "11999", email: "j@test.com", company: "Acme", origin: "web", rating: 5, segment: "saas", pipe_whatsapp: "novo", created_at: "2026-04-01" },
    ]);
    mockTable("lead_custom_field_values", []);
    mockTable("upsell_clients", []);
    mockTable("pipe_confirmacao", []);
    mockTable("pipe_propostas", []);
    mockTable("campanha_leads", []);

    const result = await loadLeadData(sb, LEAD);
    expect(result).toBeDefined();
    const r = result as Record<string, unknown>;
    expect(r.id).toBe(LEAD);
    expect(r.name).toBe("João");
    expect(r.customFields).toEqual({});
    expect(r.upsell_base_stage).toBeNull();
    expect(r.confirmacao_status).toBeNull();
    expect(r.propostas_status).toBeNull();
    expect(r.campanha_id).toBeNull();
  });

  it("retorna null se lead não existe", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", []);
    mockTable("lead_custom_field_values", []);
    mockTable("upsell_clients", []);
    mockTable("pipe_confirmacao", []);
    mockTable("pipe_propostas", []);
    mockTable("campanha_leads", []);
    expect(await loadLeadData(sb, LEAD)).toBeNull();
  });
});

describe("loadProductCatalog", () => {
  it("retorna catálogo formatado com produtos + materiais", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("products", [
      { id: "prod-1", name: "SaaS Premium", type: "mrr", description: "Plano top", ticket: 1000, ticket_minimo: null, entregaveis: null, materiais: null, links: null, organization_id: ORG, is_active: true },
    ]);
    mockTable("product_materials", [
      { id: "mat-1", product_id: "prod-1", file_name: "deck.pdf", material_type: "pitch", is_active: true, summary: null, file_path: null },
    ]);

    const result = await loadProductCatalog(sb, ORG);
    expect(result).toContain("SaaS Premium");
    expect(result).toContain("Recorrência");
    expect(result).toContain("R$ 1.000");
    expect(result).toContain("deck.pdf");
    expect(result).toContain("send_product_material");
  });

  it("retorna string vazia se sem produtos", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("products", []);
    mockTable("product_materials", []);
    expect(await loadProductCatalog(sb, ORG)).toBe("");
  });
});

describe("loadConversationContextSummary", () => {
  it("retorna ConversationContextSummary mapeado de DB", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("conversation_context_summary", [
      {
        lead_id: LEAD,
        last_topic: "preço",
        last_intent: "negociar",
        key_points: ["interessado", "tem orçamento"],
        objections_raised: ["preço alto"],
        questions_asked: ["desconto?"],
        next_action: "enviar proposta",
        qualification_data: { budget: 5000 },
        lead_temperature: "hot",
        engagement_score: 85,
        last_message_at: "2026-04-26",
        message_count: 12,
        followup_count: 2,
      },
    ]);

    const result = await loadConversationContextSummary(sb, LEAD);
    expect(result).toBeDefined();
    expect(result?.lastTopic).toBe("preço");
    expect(result?.leadTemperature).toBe("hot");
    expect(result?.engagementScore).toBe(85);
    expect(result?.messageCount).toBe(12);
    expect(result?.keyPoints).toEqual(["interessado", "tem orçamento"]);
  });

  it("retorna null se sem contexto", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("conversation_context_summary", []);
    expect(await loadConversationContextSummary(sb, LEAD)).toBeNull();
  });

  it("aplica defaults pra arrays/objects ausentes", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("conversation_context_summary", [
      {
        lead_id: LEAD,
        last_topic: null,
        last_intent: null,
        key_points: null,
        objections_raised: null,
        questions_asked: null,
        next_action: null,
        qualification_data: null,
        lead_temperature: null,
        engagement_score: null,
        last_message_at: null,
        message_count: null,
        followup_count: null,
      },
    ]);
    const result = await loadConversationContextSummary(sb, LEAD);
    expect(result?.keyPoints).toEqual([]);
    expect(result?.objectionsRaised).toEqual([]);
    expect(result?.qualificationData).toEqual({});
    expect(result?.leadTemperature).toBe("cold");
    expect(result?.engagementScore).toBe(0);
    expect(result?.messageCount).toBe(0);
    expect(result?.followupCount).toBe(0);
  });
});

describe("loadCapabilities — fallback path", () => {
  it("retorna default agent se sem leadId", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("copilot_agents", [
      { id: AGENT, organization_id: ORG, is_active: true, is_default: true, name: "Default Agent" },
    ]);

    const result = await loadCapabilities(sb, ORG, undefined, { useCache: false });
    expect(result).toBeDefined();
    expect((result as Record<string, unknown>).id).toBe(AGENT);
  });

  it("fallback any active se sem default", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("copilot_agents", [
      { id: AGENT, organization_id: ORG, is_active: true, is_default: false, name: "Some Agent", created_at: "2026-04-01" },
    ]);

    const result = await loadCapabilities(sb, ORG, undefined, { useCache: false });
    expect(result).toBeDefined();
    expect((result as Record<string, unknown>).id).toBe(AGENT);
  });

  it("retorna null se org sem agentes ativos", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("copilot_agents", []);
    expect(await loadCapabilities(sb, ORG, undefined, { useCache: false })).toBeNull();
  });

  it("cache hit retorna sem hitar DB", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("copilot_agents", [
      { id: AGENT, organization_id: ORG, is_active: true, is_default: true, name: "Cached" },
    ]);

    // 1ª chamada popula cache
    const r1 = await loadCapabilities(sb, ORG);
    expect((r1 as Record<string, unknown>).id).toBe(AGENT);

    // 2ª chamada com tabela vazia ainda retorna do cache
    mockTable("copilot_agents", []);
    const r2 = await loadCapabilities(sb, ORG);
    expect(r2).toBeDefined();
    expect((r2 as Record<string, unknown>).id).toBe(AGENT);
  });
});
