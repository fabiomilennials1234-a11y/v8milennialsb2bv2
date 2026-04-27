import { describe, it, expect, vi } from "vitest";

// Mock serializeCustomInstructions before importing the module under test
vi.mock("@/lib/copilot/custom-instructions-utils", () => ({
  serializeCustomInstructions: (dos: string, donts: string) => {
    const d = dos.trim();
    const dt = donts.trim();
    if (!d && !dt) return null;
    return JSON.stringify({ dos: d, donts: dt });
  },
}));

import { mapWizardDataToAgentPreview } from "@/lib/copilot/prompt-utils";

describe("mapWizardDataToAgentPreview", () => {
  it("returns agent and faqs objects", () => {
    const result = mapWizardDataToAgentPreview({} as any);
    expect(result).toHaveProperty("agent");
    expect(result).toHaveProperty("faqs");
  });

  it("uses defaults when wizard data is empty", () => {
    const { agent, faqs } = mapWizardDataToAgentPreview({} as any);
    expect(agent.id).toBe("preview");
    expect(agent.name).toBe("Agente Preview");
    expect(agent.template_type).toBe("custom");
    expect(agent.personality_tone).toBe("profissional");
    expect(agent.personality_style).toBe("consultivo");
    expect(agent.personality_energy).toBe("moderada");
    expect(agent.main_objective).toBe("");
    expect(agent.objective_composite).toBeNull();
    expect(agent.custom_instructions).toBeNull();
    expect(agent.response_delay_seconds).toBe(0);
    expect(agent.system_prompt).toBeNull();
    expect(agent.system_prompt_version).toBe(1);
    expect(agent.is_active).toBe(false);
    expect(agent.is_default).toBe(false);
    expect(agent.organization_id).toBe("");
    expect(agent.created_by).toBe("");
    expect(faqs).toEqual([]);
  });

  it("maps name from wizard data", () => {
    const { agent } = mapWizardDataToAgentPreview({
      name: "Meu Agente",
    } as any);
    expect(agent.name).toBe("Meu Agente");
  });

  it("maps templateType from wizard data", () => {
    const { agent } = mapWizardDataToAgentPreview({
      templateType: "qualificador",
    } as any);
    expect(agent.template_type).toBe("qualificador");
  });

  it("maps personality fields from wizard data", () => {
    const { agent } = mapWizardDataToAgentPreview({
      personality: {
        tone: "casual",
        style: "direto",
        energy: "alta",
      },
    } as any);
    expect(agent.personality_tone).toBe("casual");
    expect(agent.personality_style).toBe("direto");
    expect(agent.personality_energy).toBe("alta");
  });

  it("maps mainObjective when objectiveComposite has no mission", () => {
    const { agent } = mapWizardDataToAgentPreview({
      mainObjective: "Qualificar leads",
    } as any);
    expect(agent.main_objective).toBe("Qualificar leads");
    expect(agent.objective_composite).toBeNull();
  });

  it("maps objectiveComposite mission when present", () => {
    const composite = { mission: "Agendar reuniões", kpis: ["KPI1"] };
    const { agent } = mapWizardDataToAgentPreview({
      objectiveComposite: composite,
    } as any);
    expect(agent.main_objective).toBe("Agendar reuniões");
    expect(agent.objective_composite).toEqual(composite);
  });

  it("maps customInstructions through serializeCustomInstructions", () => {
    const { agent } = mapWizardDataToAgentPreview({
      customInstructions: {
        dos: "Sempre cumprimente",
        donts: "Nunca prometa resultados",
      },
    } as any);
    expect(agent.custom_instructions).toBe(
      JSON.stringify({ dos: "Sempre cumprimente", donts: "Nunca prometa resultados" })
    );
  });

  it("maps customInstructions as null when both are empty", () => {
    const { agent } = mapWizardDataToAgentPreview({
      customInstructions: {
        dos: "",
        donts: "",
      },
    } as any);
    expect(agent.custom_instructions).toBeNull();
  });

  it("maps businessContext from wizard data", () => {
    const ctx = { companyName: "Torque", productSummary: "CRM B2B" };
    const { agent } = mapWizardDataToAgentPreview({
      businessContext: ctx,
    } as any);
    expect(agent.business_context).toEqual(ctx);
  });

  it("maps conversationStyle from wizard data", () => {
    const style = { responseLength: "curta", maxQuestions: "1" };
    const { agent } = mapWizardDataToAgentPreview({
      conversationStyle: style,
    } as any);
    expect(agent.conversation_style).toEqual(style);
  });

  it("maps qualification from wizard data", () => {
    const qual = { requiredFields: ["phone"], optionalFields: ["email"], notes: "" };
    const { agent } = mapWizardDataToAgentPreview({
      qualification: qual,
    } as any);
    expect(agent.qualification_rules).toEqual(qual);
  });

  it("maps skills from wizard data", () => {
    const skills = ["Fazer perguntas", "Qualificar leads"];
    const { agent } = mapWizardDataToAgentPreview({ skills } as any);
    expect(agent.skills).toEqual(skills);
  });

  it("maps allowedTopics from wizard data", () => {
    const topics = ["Budget", "Timeline"];
    const { agent } = mapWizardDataToAgentPreview({ allowedTopics: topics } as any);
    expect(agent.allowed_topics).toEqual(topics);
  });

  it("maps forbiddenTopics from wizard data", () => {
    const topics = ["Preço sem contexto"];
    const { agent } = mapWizardDataToAgentPreview({ forbiddenTopics: topics } as any);
    expect(agent.forbidden_topics).toEqual(topics);
  });

  it("maps few_shot_examples from wizard data", () => {
    const examples = [{ lead: "Oi", agent: "Olá!" }];
    const { agent } = mapWizardDataToAgentPreview({ examples } as any);
    expect(agent.few_shot_examples).toEqual(examples);
  });

  it("maps availability from wizard data", () => {
    const avail = { mode: "always", timezone: "America/Sao_Paulo", days: ["seg"] };
    const { agent } = mapWizardDataToAgentPreview({ availability: avail } as any);
    expect(agent.availability).toEqual(avail);
  });

  it("maps responseDelaySeconds from wizard data", () => {
    const { agent } = mapWizardDataToAgentPreview({
      responseDelaySeconds: 30,
    } as any);
    expect(agent.response_delay_seconds).toBe(30);
  });

  it("filters out FAQs without question or answer", () => {
    const { faqs } = mapWizardDataToAgentPreview({
      faqs: [
        { question: "Pergunta 1", answer: "Resposta 1" },
        { question: "", answer: "Resposta sem pergunta" },
        { question: "Pergunta sem resposta", answer: "" },
        { question: "Pergunta 2", answer: "Resposta 2" },
      ],
    } as any);
    expect(faqs).toHaveLength(2);
    expect(faqs[0].question).toBe("Pergunta 1");
    expect(faqs[1].question).toBe("Pergunta 2");
  });

  it("generates FAQ ids with correct index and agent_id", () => {
    const { faqs } = mapWizardDataToAgentPreview({
      faqs: [
        { question: "Q1", answer: "A1" },
        { question: "Q2", answer: "A2" },
      ],
    } as any);
    expect(faqs[0].id).toBe("faq-0");
    expect(faqs[0].agent_id).toBe("preview");
    expect(faqs[0].position).toBe(0);
    expect(faqs[1].id).toBe("faq-1");
    expect(faqs[1].agent_id).toBe("preview");
    expect(faqs[1].position).toBe(1);
  });

  it("generates valid ISO timestamps for agent and faqs", () => {
    const { agent, faqs } = mapWizardDataToAgentPreview({
      faqs: [{ question: "Q", answer: "A" }],
    } as any);
    expect(() => new Date(agent.created_at)).not.toThrow();
    expect(() => new Date(agent.updated_at)).not.toThrow();
    expect(() => new Date(faqs[0].created_at)).not.toThrow();
  });

  it("handles null faqs in wizard data", () => {
    const { faqs } = mapWizardDataToAgentPreview({ faqs: null } as any);
    expect(faqs).toEqual([]);
  });

  it("handles undefined faqs in wizard data", () => {
    const { faqs } = mapWizardDataToAgentPreview({ faqs: undefined } as any);
    expect(faqs).toEqual([]);
  });

  it("maps full wizard data correctly", () => {
    const fullData = {
      name: "Agent Pro",
      templateType: "sdr",
      personality: { tone: "amigavel", style: "persuasivo", energy: "alta" },
      objectiveComposite: { mission: "Agendar reuniões" },
      customInstructions: { dos: "Seja proativo", donts: "Não pressione" },
      businessContext: { companyName: "Acme" },
      conversationStyle: { responseLength: "media" },
      qualification: { requiredFields: ["phone"] },
      skills: ["Prospecção ativa"],
      allowedTopics: ["Apresentação"],
      forbiddenTopics: ["Preço"],
      examples: [{ lead: "Oi", agent: "Olá!" }],
      availability: { mode: "business_hours" },
      responseDelaySeconds: 15,
      faqs: [{ question: "Preço?", answer: "Depende do plano" }],
    };
    const { agent, faqs } = mapWizardDataToAgentPreview(fullData as any);
    expect(agent.name).toBe("Agent Pro");
    expect(agent.template_type).toBe("sdr");
    expect(agent.personality_tone).toBe("amigavel");
    expect(agent.main_objective).toBe("Agendar reuniões");
    expect(agent.skills).toEqual(["Prospecção ativa"]);
    expect(faqs).toHaveLength(1);
    expect(faqs[0].question).toBe("Preço?");
  });
});
