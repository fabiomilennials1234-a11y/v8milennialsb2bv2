import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import React from "react";

// ---- Mocks ----

const mockFrom = vi.fn();
const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(...args),
    rpc: (...args: any[]) => mockRpc(...args),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ data: { path: "test/path.ogg" }, error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "https://example.com/audio.ogg" } }),
      }),
    },
  },
}));

vi.mock("@/lib/copilot/custom-instructions-utils", () => ({
  parseCustomInstructions: (text: string | null) => ({
    dos: text ? "Do this" : "",
    donts: text ? "Don't do that" : "",
  }),
}));

vi.mock("@/lib/copilot/template-prompts", () => ({
  getTemplatePromptConfig: (type: string) => {
    if (type === "unknown") return null;
    return {
      basePrompt: "Base prompt for " + type,
      methodology: "Methodology text",
      antiPatterns: ["Anti-pattern 1"],
      techniques: ["Technique 1"],
      humanTransferTriggers: ["Transfer trigger 1"],
      intentDetection: [
        { intent: "interest", keywords: ["quero", "gostei"], action: "Advance" },
      ],
      fewShotExamples: [
        { lead: "Oi", agent: "Olá!", context: "initial" },
      ],
      finalInstructions: ["Final instruction 1"],
    };
  },
}));

// ---- Imports under test ----

import {
  computePromptHash,
  generatePrompt,
  useCopilotPromptBuilder,
  saveCopilotSystemPrompt,
  regenerateAndSavePrompt,
} from "@/modules/copilot/hooks/useCopilotPromptBuilder";
import type { DocumentSummary } from "@/modules/copilot/hooks/useCopilotPromptBuilder";

// ---- Helpers ----

function createChainMock(data: unknown[] = []) {
  const chain: Record<string, any> = {};
  ["select", "eq", "neq", "or", "in", "gte", "lte", "lt", "ilike", "contains", "order", "limit", "range", "insert", "update", "delete", "upsert", "not", "is", "filter", "match"].forEach(m => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue({ data: data[0] ?? null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: data[0] ?? null, error: null });
  chain.then = (resolve: any, reject?: any) => Promise.resolve({ data, error: null }).then(resolve, reject);
  return chain;
}

function makeAgent(overrides: Record<string, any> = {}): any {
  return {
    id: "agent-1",
    name: "Agente Teste",
    template_type: "qualificador",
    personality_tone: "profissional",
    personality_style: "consultivo",
    personality_energy: "moderada",
    main_objective: "Qualificar leads",
    objective_composite: null,
    custom_instructions: "Do something. Don't do bad.",
    business_context: {
      companyName: "Acme",
      productSummary: "SaaS B2B",
      idealCustomerProfile: "Fábricas",
      serviceRegion: "Brasil",
      valueProps: "Melhor CRM",
      customerPains: "Desorganização",
      socialProof: "100 clientes",
      pricingPolicy: "Sob consulta",
      commercialTerms: "Sem fidelidade",
      businessHoursSla: "9-18h",
      primaryCta: "Agendar demo",
      compliancePolicy: "LGPD",
    },
    conversation_style: {
      responseLength: "curto",
      maxQuestions: "1",
      emojiPolicy: "raro",
      openingStyle: "Olá!",
      closingStyle: "Até mais!",
      whatsappGuidelines: "Seja breve",
      humanizationTips: "Fale como gente",
    },
    qualification_rules: {
      requiredFields: ["nome", "empresa"],
      optionalFields: ["email"],
      notes: "Priorizar faturamento",
    },
    skills: ["vendas", "agendamento"],
    allowed_topics: ["produto", "preço"],
    forbidden_topics: ["concorrência"],
    few_shot_examples: [{ lead: "Oi", agent: "Olá! Como posso ajudar?" }],
    availability: {
      mode: "business_hours",
      days: ["seg", "ter"],
      start: "09:00",
      end: "18:00",
      timezone: "America/Sao_Paulo",
    },
    response_delay_seconds: 5,
    system_prompt: "old prompt",
    system_prompt_version: 2,
    prompt_hash: "old_hash",
    ...overrides,
  };
}

function makeFaq(overrides: Record<string, any> = {}): any {
  return {
    id: "faq-1",
    agent_id: "agent-1",
    question: "Quanto custa?",
    answer: "Sob consulta.",
    position: 0,
    ...overrides,
  };
}

function makeKanbanRule(overrides: Record<string, any> = {}): any {
  return {
    id: "rule-1",
    agent_id: "agent-1",
    pipe_type: "whatsapp",
    stage_name: "novo",
    goal: "Abordar lead",
    behavior: "Ser proativo",
    allowed_actions: ["enviar_mensagem"],
    forbidden_actions: ["fechar_venda"],
    ...overrides,
  };
}

// ---- Tests ----

describe("computePromptHash", () => {
  it("returns deterministic hash for same input", () => {
    const agent = makeAgent();
    const faqs = [makeFaq()];
    const h1 = computePromptHash(agent, faqs);
    const h2 = computePromptHash(agent, faqs);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^v1_/);
  });

  it("returns different hash when agent name changes", () => {
    const agent1 = makeAgent({ name: "AgentA" });
    const agent2 = makeAgent({ name: "AgentB" });
    expect(computePromptHash(agent1)).not.toBe(computePromptHash(agent2));
  });

  it("returns different hash when FAQs change", () => {
    const agent = makeAgent();
    const h1 = computePromptHash(agent, []);
    const h2 = computePromptHash(agent, [makeFaq()]);
    expect(h1).not.toBe(h2);
  });

  it("handles empty agent fields gracefully", () => {
    const agent = makeAgent({
      custom_instructions: "",
      business_context: {},
      conversation_style: {},
      qualification_rules: {},
      skills: [],
      allowed_topics: [],
      forbidden_topics: [],
      few_shot_examples: [],
      availability: {},
      response_delay_seconds: 0,
      objective_composite: null,
    });
    const hash = computePromptHash(agent);
    expect(hash).toMatch(/^v1_/);
  });
});

describe("generatePrompt", () => {
  it("generates prompt with all 4 layers", () => {
    const agent = makeAgent();
    const faqs = [makeFaq()];
    const rules = [makeKanbanRule()];
    const context = {
      currentPipe: "whatsapp",
      currentStage: "novo",
      leadName: "João",
      leadCompany: "Acme Corp",
      leadScore: 75,
      leadTags: ["Ouro"],
      leadHistory: ["Criado em 01/01"],
    } as any;

    const result = generatePrompt(agent, faqs, rules, context);

    expect(result.systemPrompt).toContain("IDENTIDADE DO AGENTE");
    expect(result.systemPrompt).toContain("Agente Teste");
    expect(result.systemPrompt).toContain("PERSONALIDADE");
    expect(result.systemPrompt).toContain("OBJETIVO PRINCIPAL");
    expect(result.systemPrompt).toContain("CONTEXTO DO NEGÓCIO");
    expect(result.systemPrompt).toContain("Acme");
    expect(result.systemPrompt).toContain("ESTILO DE CONVERSA");
    expect(result.systemPrompt).toContain("QUALIFICAÇÃO MÍNIMA");
    expect(result.systemPrompt).toContain("DISPONIBILIDADE");
    expect(result.systemPrompt).toContain("PERGUNTAS FREQUENTES");
    expect(result.systemPrompt).toContain("EXEMPLOS DE CONVERSA");
    expect(result.systemPrompt).toContain("ESPECIALIZAÇÃO DO AGENTE");
    expect(result.systemPrompt).toContain("CONTEXTO ATUAL");
    expect(result.systemPrompt).toContain("João");
    expect(result.systemPrompt).toContain("Acme Corp");
    expect(result.systemPrompt).toContain("INSTRUÇÕES FINAIS");

    expect(result.metadata.agentName).toBe("Agente Teste");
    expect(result.metadata.templateType).toBe("qualificador");
  });

  it("generates prompt with hideAiIdentity", () => {
    const agent = makeAgent({
      conversation_style: {
        hideAiIdentity: true,
        responseLength: "medio",
        maxQuestions: "2",
        emojiPolicy: "nunca",
      },
    });
    const result = generatePrompt(agent);
    expect(result.systemPrompt).toContain("consultor(a) especializado(a)");
    expect(result.systemPrompt).toContain("REGRA ABSOLUTA DE IDENTIDADE");
    expect(result.systemPrompt).toContain("NUNCA use frases como");
  });

  it("uses objective_composite when present", () => {
    const agent = makeAgent({
      objective_composite: {
        mission: "Qualificar leads B2B industriais",
        success_criteria: "Lead agendou reunião",
        limits: "Não discutir preço",
      },
    });
    const result = generatePrompt(agent);
    expect(result.systemPrompt).toContain("Qualificar leads B2B industriais");
    expect(result.systemPrompt).toContain("Critério de Sucesso");
    expect(result.systemPrompt).toContain("Limites");
  });

  it("uses personaDescription from conversation_style when available", () => {
    const agent = makeAgent({
      conversation_style: {
        personaDescription: "Sou um consultor energético e direto.",
      },
    });
    const result = generatePrompt(agent);
    expect(result.systemPrompt).toContain("Sou um consultor energético e direto.");
    expect(result.systemPrompt).toContain("PERSONALIDADE E TOM DE VOZ");
  });

  it("uses skillsAndTopics from businessContext when available", () => {
    const agent = makeAgent({
      business_context: {
        companyName: "Test",
        skillsAndTopics: "Vendas B2B, agendamento, qualificação de leads",
      },
      skills: [],
      allowed_topics: [],
      forbidden_topics: [],
    });
    const result = generatePrompt(agent);
    expect(result.systemPrompt).toContain("HABILIDADES, TÓPICOS E LIMITES");
    expect(result.systemPrompt).toContain("Vendas B2B, agendamento, qualificação de leads");
  });

  it("builds conversation style with different options", () => {
    const agent = makeAgent({
      conversation_style: {
        responseLength: "detalhado",
        maxQuestions: "2",
        emojiPolicy: "moderado",
        openingStyle: "Hey!",
        closingStyle: "Bye!",
      },
    });
    const result = generatePrompt(agent);
    expect(result.systemPrompt).toContain("Só responda detalhado quando o lead pedir");
    expect(result.systemPrompt).toContain("no máximo 2 perguntas");
    expect(result.systemPrompt).toContain("Use emojis apenas se o lead usar primeiro");
  });

  it("handles availability mode always", () => {
    const agent = makeAgent({
      availability: { mode: "always" },
      response_delay_seconds: 0,
    });
    const result = generatePrompt(agent);
    expect(result.systemPrompt).toContain("Atendimento: 24 horas");
  });

  it("includes document summaries when provided", () => {
    const agent = makeAgent();
    const docs: DocumentSummary[] = [
      { fileName: "catalogo.pdf", summary: "Catálogo de produtos 2025" },
    ];
    const result = generatePrompt(agent, [], [], undefined, undefined, docs);
    expect(result.systemPrompt).toContain("BASE DE CONHECIMENTO CORPORATIVO");
    expect(result.systemPrompt).toContain("catalogo.pdf");
    expect(result.systemPrompt).toContain("Catálogo de produtos 2025");
  });

  it("includes conversation context for follow-up", () => {
    const agent = makeAgent();
    const conversationContext = {
      messageCount: 10,
      lastTopic: "Preço do plano Pro",
      lastIntent: "interest",
      leadTemperature: "hot",
      engagementScore: 80,
      lastMessageAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
      keyPoints: ["Quer demo", "Usa CRM atual"],
      objectionsRaised: ["Preço alto"],
      questionsAsked: ["Tem integração com WhatsApp?"],
    } as any;

    const result = generatePrompt(agent, [], [], undefined, conversationContext);
    expect(result.systemPrompt).toContain("CONTEXTO DA ÚLTIMA CONVERSA");
    expect(result.systemPrompt).toContain("Preço do plano Pro");
    expect(result.systemPrompt).toContain("interest");
    expect(result.systemPrompt).toContain("HOT");
    expect(result.systemPrompt).toContain("80/100");
    expect(result.systemPrompt).toContain("Quer demo");
    expect(result.systemPrompt).toContain("Preço alto");
    expect(result.systemPrompt).toContain("Tem integração com WhatsApp?");
  });

  it("includes conversation context with days diff", () => {
    const agent = makeAgent();
    const conversationContext = {
      messageCount: 5,
      leadTemperature: "cold",
      engagementScore: 20,
      lastMessageAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
      keyPoints: [],
      objectionsRaised: [],
      questionsAsked: [],
    } as any;

    const result = generatePrompt(agent, [], [], undefined, conversationContext);
    expect(result.systemPrompt).toContain("3 dia(s)");
  });

  it("builds kanban rules for current stage", () => {
    const agent = makeAgent();
    const rules = [makeKanbanRule()];
    const context = {
      currentPipe: "whatsapp",
      currentStage: "novo",
    } as any;

    const result = generatePrompt(agent, [], rules, context);
    expect(result.systemPrompt).toContain("REGRAS PARA ESTA ETAPA");
    expect(result.systemPrompt).toContain("Abordar lead");
    expect(result.systemPrompt).toContain("enviar_mensagem");
    expect(result.systemPrompt).toContain("fechar_venda");
  });

  it("handles template type unknown (no template config)", () => {
    const agent = makeAgent({ template_type: "unknown" });
    const result = generatePrompt(agent);
    // Should not contain template-specific sections
    expect(result.systemPrompt).not.toContain("ESPECIALIZAÇÃO DO AGENTE");
    // Should have generic final instructions
    expect(result.systemPrompt).toContain("INSTRUÇÕES FINAIS");
    expect(result.systemPrompt).toContain("Sempre mantenha o tom");
  });

  it("handles custom layer with custom_instructions", () => {
    const agent = makeAgent({ custom_instructions: "Always greet warmly." });
    const result = generatePrompt(agent);
    expect(result.systemPrompt).toContain("O QUE VOCÊ DEVE FAZER");
    expect(result.systemPrompt).toContain("O QUE VOCÊ NUNCA DEVE FAZER");
  });
});

describe("useCopilotPromptBuilder", () => {
  it("returns null when agent is null", () => {
    const { result } = renderHook(() =>
      useCopilotPromptBuilder(null, undefined, undefined)
    );
    expect(result.current).toBeNull();
  });

  it("returns generated prompt when agent is provided", () => {
    const agent = makeAgent();
    const faqs = [makeFaq()];
    const rules = [makeKanbanRule()];
    const { result } = renderHook(() =>
      useCopilotPromptBuilder(agent, faqs, rules)
    );
    expect(result.current).not.toBeNull();
    expect(result.current!.systemPrompt).toContain("Agente Teste");
    expect(result.current!.metadata.agentName).toBe("Agente Teste");
  });
});

describe("saveCopilotSystemPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("updates the copilot_agents table", async () => {
    await saveCopilotSystemPrompt("agent-1", "new prompt", 3, "hash123");
    expect(mockFrom).toHaveBeenCalledWith("copilot_agents");
  });

  it("works without promptHash", async () => {
    await saveCopilotSystemPrompt("agent-1", "new prompt", 3);
    expect(mockFrom).toHaveBeenCalledWith("copilot_agents");
  });
});

describe("regenerateAndSavePrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips regeneration when hash has not changed", async () => {
    const agent = makeAgent();
    const hash = computePromptHash(agent, []);
    agent.prompt_hash = hash;

    const result = await regenerateAndSavePrompt(agent, []);
    expect(result.systemPrompt).toBe("old prompt");
    expect(result.promptHash).toBe(hash);
    // Should NOT call from() for save since hash unchanged
    expect(mockFrom).not.toHaveBeenCalledWith("copilot_agents");
  });

  it("regenerates and saves when hash changed", async () => {
    const docChain = createChainMock([]);
    const saveChain = createChainMock();
    mockFrom.mockImplementation((table: string) => {
      if (table === "copilot_agent_documents") return docChain;
      return saveChain;
    });

    const agent = makeAgent({ prompt_hash: "different_hash" });
    const result = await regenerateAndSavePrompt(agent, [makeFaq()]);
    expect(result.systemPrompt).toContain("Agente Teste");
    expect(result.promptHash).toMatch(/^v1_/);
    expect(mockFrom).toHaveBeenCalledWith("copilot_agent_documents");
    expect(mockFrom).toHaveBeenCalledWith("copilot_agents");
  });

  it("includes document summaries in regenerated prompt", async () => {
    const docData = [
      { file_name: "manual.pdf", summary: "Manual de vendas completo" },
    ];
    const docChain = createChainMock(docData);
    const saveChain = createChainMock();
    mockFrom.mockImplementation((table: string) => {
      if (table === "copilot_agent_documents") return docChain;
      return saveChain;
    });

    const agent = makeAgent({ prompt_hash: "old" });
    const result = await regenerateAndSavePrompt(agent, []);
    expect(result.systemPrompt).toContain("manual.pdf");
    expect(result.systemPrompt).toContain("Manual de vendas completo");
  });
});
