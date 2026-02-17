/**
 * Prompt Quality Score
 *
 * Calcula um score de 0-100 baseado em quão completos e ricos
 * são os campos que compõem o prompt do agente.
 *
 * Ponderação:
 *   Business Context  25%
 *   Objetivo           20%
 *   FAQs               15%
 *   Exemplos           15%
 *   Estilo             10%
 *   Custom Instructions 10%
 *   Qualificação        5%
 */

import type { CopilotWizardData } from "@/types/copilot";

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
  data: Partial<CopilotWizardData>
): PromptQualityResult {
  const missing: string[] = [];
  let total = 0;

  // 1. Business Context (25 pontos)
  const bc = data.businessContext;
  if (bc) {
    const fields = [
      { key: "companyName", label: "Nome da empresa", min: 2 },
      { key: "productSummary", label: "Produto/Serviço", min: 20 },
      { key: "idealCustomerProfile", label: "Perfil de cliente ideal", min: 10 },
      { key: "valueProps", label: "Proposta de valor", min: 10 },
      { key: "customerPains", label: "Dores que resolve", min: 10 },
    ];
    let bcScore = 0;
    fields.forEach((f) => {
      const val = (bc as any)[f.key] as string;
      if (val && val.trim().length >= f.min) {
        bcScore += 5;
      } else {
        missing.push(f.label);
      }
    });
    total += bcScore;
  } else {
    total += 0;
    missing.push("Contexto do negócio");
  }

  // 2. Objetivo (20 pontos)
  const obj = data.objectiveComposite;
  if (obj?.mission && obj.mission.length >= 20) {
    total += 10;
    if (obj.success_criteria && obj.success_criteria.length >= 10) {
      total += 7;
    } else {
      missing.push("Critério de sucesso");
    }
    if (obj.limits && obj.limits.length >= 5) {
      total += 3;
    }
  } else if (data.mainObjective && data.mainObjective.length >= 10) {
    total += 8; // legado recebe parcial
  } else {
    missing.push("Objetivo do agente");
  }

  // 3. FAQs (15 pontos)
  const faqsWithAnswer = (data.faqs || []).filter(
    (f) => f.question && f.answer && f.answer.length >= 5
  );
  if (faqsWithAnswer.length >= 3) {
    total += 15;
  } else if (faqsWithAnswer.length >= 1) {
    total += faqsWithAnswer.length * 5;
  } else {
    missing.push("FAQs (pelo menos 1 com resposta)");
  }

  // 4. Exemplos (15 pontos)
  const validExamples = (data.examples || []).filter(
    (e) => e.lead && e.agent && e.lead.length >= 5 && e.agent.length >= 5
  );
  if (validExamples.length >= 3) {
    total += 15;
  } else if (validExamples.length >= 1) {
    total += validExamples.length * 5;
  } else {
    missing.push("Exemplos de conversa");
  }

  // 5. Estilo (10 pontos)
  const style = data.conversationStyle;
  if (style) {
    let styleScore = 0;
    if (style.responseLength) styleScore += 3;
    if (style.emojiPolicy) styleScore += 2;
    if (style.openingStyle && style.openingStyle.length >= 5) styleScore += 3;
    if (style.closingStyle && style.closingStyle.length >= 5) styleScore += 2;
    total += styleScore;
    if (styleScore < 5) missing.push("Estilo de conversa (abertura/fechamento)");
  } else {
    missing.push("Estilo de conversa");
  }

  // 6. Custom Instructions (10 pontos)
  const ci = data.customInstructions;
  if (ci && ci.trim().length >= 20) {
    total += 10;
  } else if (ci && ci.trim().length >= 5) {
    total += 5;
  }
  // Não adicionamos missing — é opcional

  // 7. Qualificação (5 pontos)
  const qual = data.qualification;
  if (qual?.requiredFields && qual.requiredFields.length >= 2) {
    total += 5;
  } else if (qual?.requiredFields && qual.requiredFields.length >= 1) {
    total += 2;
  }

  const score = clamp(total, 0, 100);
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
