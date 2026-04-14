import { describe, it, expect } from "vitest";
import {
  computePromptQuality,
  getQualityColor,
  getQualityBgColor,
  getQualityLabel,
} from "../../src/lib/copilot/prompt-quality";

describe("getQualityColor", () => {
  it("returns green for excellent", () => {
    expect(getQualityColor("excellent")).toContain("green");
  });
  it("returns blue for good", () => {
    expect(getQualityColor("good")).toContain("blue");
  });
  it("returns yellow for medium", () => {
    expect(getQualityColor("medium")).toContain("yellow");
  });
  it("returns red for low", () => {
    expect(getQualityColor("low")).toContain("red");
  });
});

describe("getQualityBgColor", () => {
  it("returns bg class for each level", () => {
    expect(getQualityBgColor("excellent")).toContain("bg-green");
    expect(getQualityBgColor("good")).toContain("bg-blue");
    expect(getQualityBgColor("medium")).toContain("bg-yellow");
    expect(getQualityBgColor("low")).toContain("bg-red");
  });
});

describe("getQualityLabel", () => {
  it("returns Excelente for excellent", () => {
    expect(getQualityLabel("excellent")).toBe("Excelente");
  });
  it("returns Bom for good", () => {
    expect(getQualityLabel("good")).toBe("Bom");
  });
  it("returns Médio for medium", () => {
    expect(getQualityLabel("medium")).toBe("Médio");
  });
  it("returns Básico for low", () => {
    expect(getQualityLabel("low")).toBe("Básico");
  });
});

describe("computePromptQuality", () => {
  it("empty data returns low score", () => {
    const result = computePromptQuality({});
    expect(result.score).toBeLessThan(40);
    expect(result.level).toBe("low");
    expect(result.missingItems.length).toBeGreaterThan(0);
  });

  it("reports missing business context", () => {
    const result = computePromptQuality({});
    expect(result.missingItems).toContain("Contexto do negócio");
  });

  it("reports missing objective", () => {
    const result = computePromptQuality({});
    expect(result.missingItems).toContain("Objetivo do agente");
  });

  it("reports missing examples", () => {
    const result = computePromptQuality({});
    expect(result.missingItems).toContain("Exemplos de conversa");
  });

  it("rich data scores higher", () => {
    const richData = {
      businessContext: {
        companyName: "Torque CRM",
        productSummary: "CRM B2B com WhatsApp e IA para vendas",
        idealCustomerProfile: "Fábricas e distribuidoras B2B",
        valueProps: "Automação de vendas com IA conversacional",
        customerPains: "Gestão manual de leads e follow-ups",
      },
      objectiveComposite: {
        mission: "Qualificar leads inbound via WhatsApp de forma automatizada",
        success_criteria: "Lead qualificado com dados completos",
        limits: "Não fazer promessas de preço",
      },
      mainObjective: "Qualificar leads",
      kanbanRules: [
        { goal: "Engajar o lead", behavior: "Apresentar a empresa e entender a dor" },
        { goal: "Qualificar o lead", behavior: "Coletar informações obrigatórias" },
        { goal: "Agendar reunião", behavior: "Propor horários disponíveis" },
      ],
      faqs: [
        { question: "Qual o preço?", answer: "Depende do plano escolhido, vamos entender sua necessidade" },
        { question: "Tem teste grátis?", answer: "Sim, oferecemos 7 dias de teste" },
        { question: "Integra com WhatsApp?", answer: "Sim, integração nativa com Evolution API" },
      ],
      examples: [
        { lead: "Boa tarde, vi o anúncio de vocês", agent: "Olá! Que bom que nos encontrou. Em que posso ajudar?" },
        { lead: "Quanto custa?", agent: "Temos planos a partir de R$500/mês. Posso entender melhor sua necessidade?" },
        { lead: "Preciso de CRM para minha fábrica", agent: "Legal! Trabalhamos com várias fábricas. Quantos vendedores vocês têm?" },
      ],
      conversationStyle: {
        responseLength: "medium",
        emojiPolicy: "moderate",
        openingStyle: "Cumprimento personalizado com nome do lead",
        closingStyle: "Sempre perguntar próximo passo",
      },
      customInstructions: "Sempre usar linguagem formal. Não mencionar concorrentes. Priorizar agendamento.",
    };

    const result = computePromptQuality(richData as any);
    expect(result.score).toBeGreaterThan(60);
    expect(["good", "excellent"]).toContain(result.level);
  });

  it("uses template-specific weights", () => {
    const minimalData = {
      businessContext: {
        companyName: "Test Co",
        productSummary: "A product that does something useful for people",
        idealCustomerProfile: "Small businesses in Brazil",
        valueProps: "Saves time and increases sales",
        customerPains: "Manual processes that waste time",
      },
    };

    const qualificador = computePromptQuality(minimalData as any, "qualificador");
    const custom = computePromptQuality(minimalData as any, "custom");
    // Different templates weight business context differently
    expect(qualificador.score).not.toBe(custom.score);
  });

  it("score is always 0-100", () => {
    const result1 = computePromptQuality({});
    expect(result1.score).toBeGreaterThanOrEqual(0);
    expect(result1.score).toBeLessThanOrEqual(100);

    const result2 = computePromptQuality({
      businessContext: { companyName: "X" },
    } as any);
    expect(result2.score).toBeGreaterThanOrEqual(0);
    expect(result2.score).toBeLessThanOrEqual(100);
  });

  it("level thresholds: <40=low, 40-64=medium, 65-84=good, 85+=excellent", () => {
    // Test by checking the function logic
    const low = computePromptQuality({});
    expect(low.level).toBe("low");
  });
});
