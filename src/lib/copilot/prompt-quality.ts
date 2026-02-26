/**
 * Prompt Quality Score
 *
 * Calcula um score de 0-100 baseado em quão completos e ricos
 * são os campos que compõem o prompt do agente.
 *
 * Ponderação padrão (ajustada por templateType):
 *   Business Context  20-25%
 *   Objetivo          15-20%
 *   Kanban Rules      10-15%
 *   FAQs               0-15%
 *   Exemplos          10-15%
 *   Estilo              8-10%
 *   Custom Instructions 7-10%
 *   Qualificação        0-5%
 */

import type { CopilotWizardData } from "@/types/copilot";

// Pesos por template (somam 100)
interface TemplateWeights {
  businessContext: number;  // pontos máximos
  objective: number;
  kanbanRules: number;
  faqs: number;
  examples: number;
  style: number;
  customInstructions: number;
  qualification: number;
}

const TEMPLATE_WEIGHTS: Record<string, TemplateWeights> = {
  qualificador: {
    businessContext: 20,
    objective: 15,
    kanbanRules: 10,
    faqs: 15,
    examples: 12,
    style: 8,
    customInstructions: 10,
    qualification: 10,
  },
  sdr: {
    businessContext: 22,
    objective: 15,
    kanbanRules: 12,
    faqs: 12,
    examples: 15,
    style: 8,
    customInstructions: 8,
    qualification: 8,
  },
  followup: {
    businessContext: 20,
    objective: 18,
    kanbanRules: 12,
    faqs: 8,
    examples: 18,
    style: 10,
    customInstructions: 10,
    qualification: 4,
  },
  agendador: {
    businessContext: 22,
    objective: 20,
    kanbanRules: 18,
    faqs: 8,
    examples: 15,
    style: 8,
    customInstructions: 7,
    qualification: 2,
  },
  prospectador: {
    businessContext: 25,
    objective: 18,
    kanbanRules: 10,
    faqs: 8,
    examples: 15,
    style: 10,
    customInstructions: 8,
    qualification: 6,
  },
  custom: {
    businessContext: 25,
    objective: 20,
    kanbanRules: 5,
    faqs: 15,
    examples: 15,
    style: 10,
    customInstructions: 10,
    qualification: 0,
  },
};

const DEFAULT_WEIGHTS: TemplateWeights = {
  businessContext: 20,
  objective: 15,
  kanbanRules: 10,
  faqs: 12,
  examples: 15,
  style: 8,
  customInstructions: 10,
  qualification: 5,
};

export type QualityLevel = "low" | "medium" | "good" | "excellent";

export interface PromptQualityResult {
  score: number;
  level: QualityLevel;
  missingItems: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function computePromptQuality(
  data: Partial<CopilotWizardData>,
  templateType?: string
): PromptQualityResult {
  const missing: string[] = [];
  let total = 0;
  const w = (templateType && TEMPLATE_WEIGHTS[templateType]) || DEFAULT_WEIGHTS;

  // 1. Business Context
  const bc = data.businessContext;
  if (bc) {
    const fields = [
      { key: "companyName", label: "Nome da empresa", min: 2 },
      { key: "productSummary", label: "Produto/Serviço", min: 20 },
      { key: "idealCustomerProfile", label: "Perfil de cliente ideal", min: 10 },
      { key: "valueProps", label: "Proposta de valor", min: 10 },
      { key: "customerPains", label: "Dores que resolve", min: 10 },
    ];
    const pointsEach = w.businessContext / fields.length;
    fields.forEach((f) => {
      const val = (bc as any)[f.key] as string;
      if (val && val.trim().length >= f.min) {
        total += pointsEach;
      } else {
        missing.push(f.label);
      }
    });
  } else {
    missing.push("Contexto do negócio");
  }

  // 2. Objetivo
  const obj = data.objectiveComposite;
  if (obj?.mission && obj.mission.length >= 20) {
    total += w.objective * 0.5;
    if (obj.success_criteria && obj.success_criteria.length >= 10) {
      total += w.objective * 0.35;
    } else {
      missing.push("Critério de sucesso");
    }
    if (obj.limits && obj.limits.length >= 5) {
      total += w.objective * 0.15;
    }
  } else if (data.mainObjective && data.mainObjective.length >= 10) {
    total += w.objective * 0.4; // legado recebe parcial
  } else {
    missing.push("Objetivo do agente");
  }

  // 3. Kanban Rules
  const kanbanRules = (data.kanbanRules || []).filter(
    (r: any) => r.goal && r.goal.length >= 5 && r.behavior && r.behavior.length >= 5
  );
  if (w.kanbanRules > 0) {
    if (kanbanRules.length >= 3) {
      total += w.kanbanRules;
    } else if (kanbanRules.length >= 1) {
      total += (kanbanRules.length / 3) * w.kanbanRules;
    } else {
      missing.push("Regras do Kanban");
    }
  }

  // 4. FAQs (apenas se o template valoriza FAQs)
  if (w.faqs > 0) {
    const faqsWithAnswer = (data.faqs || []).filter(
      (f) => f.question && f.answer && f.answer.length >= 5
    );
    if (faqsWithAnswer.length >= 3) {
      total += w.faqs;
    } else if (faqsWithAnswer.length >= 1) {
      total += (faqsWithAnswer.length / 3) * w.faqs;
    } else {
      missing.push("FAQs (pelo menos 1 com resposta)");
    }
  }

  // 5. Exemplos
  const validExamples = (data.examples || []).filter(
    (e) => e.lead && e.agent && e.lead.length >= 5 && e.agent.length >= 5
  );
  if (validExamples.length >= 3) {
    total += w.examples;
  } else if (validExamples.length >= 1) {
    total += (validExamples.length / 3) * w.examples;
  } else {
    missing.push("Exemplos de conversa");
  }

  // 6. Estilo
  const style = data.conversationStyle;
  if (style) {
    let styleScore = 0;
    const maxStyle = w.style;
    if (style.responseLength) styleScore += maxStyle * 0.3;
    if (style.emojiPolicy) styleScore += maxStyle * 0.2;
    if (style.openingStyle && style.openingStyle.length >= 5) styleScore += maxStyle * 0.3;
    if (style.closingStyle && style.closingStyle.length >= 5) styleScore += maxStyle * 0.2;
    total += styleScore;
    if (styleScore < maxStyle * 0.5) missing.push("Estilo de conversa (abertura/fechamento)");
  } else {
    missing.push("Estilo de conversa");
  }

  // 7. Custom Instructions (opcional — não penaliza se ausente)
  const ci = data.customInstructions;
  const ciText = typeof ci === "string" ? ci : ((ci?.dos || "") + " " + (ci?.donts || "")).trim();
  if (ciText.length >= 20) {
    total += w.customInstructions;
  } else if (ciText.length >= 5) {
    total += w.customInstructions * 0.5;
  }

  // 8. Qualificação (apenas se o template valoriza)
  if (w.qualification > 0) {
    const qual = data.qualification;
    if (qual?.requiredFields && qual.requiredFields.length >= 2) {
      total += w.qualification;
    } else if (qual?.requiredFields && qual.requiredFields.length >= 1) {
      total += w.qualification * 0.4;
    }
  }

  const score = clamp(Math.round(total), 0, 100);
  let level: QualityLevel;
  if (score >= 85) level = "excellent";
  else if (score >= 65) level = "good";
  else if (score >= 40) level = "medium";
  else level = "low";

  return { score, level, missingItems: missing };
}

export function getQualityColor(level: QualityLevel): string {
  switch (level) {
    case "excellent":
      return "text-green-500";
    case "good":
      return "text-blue-500";
    case "medium":
      return "text-yellow-500";
    case "low":
      return "text-red-500";
  }
}

export function getQualityBgColor(level: QualityLevel): string {
  switch (level) {
    case "excellent":
      return "bg-green-500/10 border-green-500/20";
    case "good":
      return "bg-blue-500/10 border-blue-500/20";
    case "medium":
      return "bg-yellow-500/10 border-yellow-500/20";
    case "low":
      return "bg-red-500/10 border-red-500/20";
  }
}

export function getQualityLabel(level: QualityLevel): string {
  switch (level) {
    case "excellent":
      return "Excelente";
    case "good":
      return "Bom";
    case "medium":
      return "Médio";
    case "low":
      return "Básico";
  }
}
