/**
 * Hook + funções para geração de System Prompts dos Copilots
 *
 * Arquitetura de 4 camadas:
 *   Camada 1 — Identidade: nome, empresa, personalidade, objetivo composto, business context
 *   Camada 2 — Conhecimento: habilidades, tópicos, estilo, qualificação, disponibilidade, FAQs, exemplos
 *   Camada 3 — Metodologia: template basePrompt, methodology, anti-patterns, techniques, intent detection
 *   Camada 4 — Custom: instruções personalizadas do usuário + instruções finais
 *
 * Funções exportadas:
 *   - generatePrompt()           — função pura que monta o prompt completo
 *   - useCopilotPromptBuilder()  — React hook wrapper (com memoização)
 *   - computePromptHash()        — calcula hash dos campos que afetam o prompt
 *   - saveCopilotSystemPrompt()  — salva prompt + hash no banco
 *   - regenerateAndSavePrompt()  — compõe generatePrompt + save + hash (tudo-em-um)
 */

import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parseCustomInstructions } from "@/lib/copilot/custom-instructions-utils";
import type {
  CopilotAgent,
  CopilotAgentFaq,
  CopilotAgentKanbanRule,
  AgentContext,
  GeneratedPrompt,
  ConversationContextSummary,
  ObjectiveComposite,
} from "@/types/copilot";
import { getTemplatePromptConfig } from "@/lib/copilot/template-prompts";

// =====================================================
// PROMPT HASH
// =====================================================

/**
 * Calcula um hash determinístico dos campos que afetam o prompt.
 * Quando o hash muda, o system_prompt cacheado precisa ser regenerado.
 */
export function computePromptHash(
  agent: CopilotAgent,
  faqs: CopilotAgentFaq[] = []
): string {
  const fields = [
    agent.name,
    agent.template_type,
    agent.personality_tone,
    agent.personality_style,
    agent.personality_energy,
    agent.main_objective,
    JSON.stringify(agent.objective_composite || null),
    agent.custom_instructions || "",
    JSON.stringify(agent.business_context || {}),
    JSON.stringify(agent.conversation_style || {}),
    JSON.stringify(agent.qualification_rules || {}),
    JSON.stringify(agent.skills || []),
    JSON.stringify(agent.allowed_topics || []),
    JSON.stringify(agent.forbidden_topics || []),
    JSON.stringify(agent.few_shot_examples || []),
    JSON.stringify(agent.availability || {}),
    String(agent.response_delay_seconds || 0),
    // Wizard v3 fields (stored in JSONB)
    ((agent.conversation_style as any)?.personaDescription || ""),
    ((agent.business_context as any)?.skillsAndTopics || ""),
    // FAQs (sorted by position for determinism)
    ...faqs
      .slice()
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .map((f) => `${f.question}|${f.answer}`),
  ];

  // djb2 hash
  const str = fields.join("||");
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return `v1_${Math.abs(hash).toString(36)}`;
}

// =====================================================
// HELPER: appendIf
// =====================================================

function appendIf(sections: string[], label: string, value?: string) {
  if (value && value.trim()) {
    sections.push(`- ${label}: ${value}`);
  }
}

// =====================================================
// CAMADA 1 — IDENTIDADE
// =====================================================

function buildIdentityLayer(
  sections: string[],
  agent: CopilotAgent,
  businessContext: Record<string, any>,
  hideAiIdentity?: boolean,
  conversationStyle: Record<string, any> = {}
) {
  // 1.1 Identidade
  sections.push("# IDENTIDADE DO AGENTE");
  sections.push("");
  const companyName = businessContext.companyName?.trim();

  if (hideAiIdentity) {
    // Persona humana — nunca revelar que é IA
    sections.push(
      `Você é ${agent.name}, consultor(a) especializado(a) em vendas B2B${companyName ? ` da ${companyName}` : ""}.`
    );
    sections.push("");
    sections.push("⚠️ REGRA ABSOLUTA DE IDENTIDADE — NUNCA VIOLAR:");
    sections.push("- Você é um HUMANO. Nunca diga que é uma IA, robô, bot, assistente virtual ou sistema automatizado.");
    sections.push("- Se alguém perguntar se você é uma IA ou robô, negue ou desvie naturalmente: 'Sou da equipe da [empresa], não sou robô 😄' ou 'Sou humano sim! Posso te ajudar com...'");
    sections.push("- NUNCA use frases como: 'como uma IA', 'fui programado para', 'minha programação', 'sou um assistente virtual', 'sou um chatbot'");
    sections.push("- NUNCA admita ter limitações de IA (ex: 'não consigo sentir', 'não tenho opinião')");
    sections.push("- Responda com naturalidade humana: use 'achei', 'acho', 'na minha experiência', 'já vi casos assim'");
  } else {
    sections.push(
      `Você é ${agent.name}, assistente virtual${companyName ? ` da ${companyName}` : ""} especializado em vendas B2B.`
    );
  }
  sections.push(`Template: ${agent.template_type}`);
  sections.push("");

  // 1.2 Personalidade
  const personaDescription = (conversationStyle as any).personaDescription as string | undefined;
  if (personaDescription && personaDescription.trim()) {
    // Wizard v3: campo livre descritivo
    sections.push("# PERSONALIDADE E TOM DE VOZ");
    sections.push("");
    sections.push(personaDescription.trim());
    sections.push("");
  } else {
    // Fallback: dropdowns legados (Wizard v2)
    sections.push("# PERSONALIDADE");
    sections.push("");
    sections.push(`Tom de voz: ${agent.personality_tone}`);
    sections.push(`Estilo de comunicação: ${agent.personality_style}`);
    sections.push(`Nível de energia: ${agent.personality_energy}`);
    sections.push("");
  }

  // 1.3 Objetivo Principal (composite ou legado)
  const objectiveComposite = agent.objective_composite as ObjectiveComposite | null;

  sections.push("# OBJETIVO PRINCIPAL");
  sections.push("");

  if (objectiveComposite && objectiveComposite.mission) {
    sections.push("## Missão");
    sections.push(objectiveComposite.mission);
    sections.push("");
    if (objectiveComposite.success_criteria) {
      sections.push("## Critério de Sucesso");
      sections.push(objectiveComposite.success_criteria);
      sections.push("");
    }
    if (objectiveComposite.limits) {
      sections.push("## Limites");
      sections.push(objectiveComposite.limits);
      sections.push("");
    }
  } else {
    // Fallback: main_objective legado
    sections.push(agent.main_objective);
    sections.push("");
  }

  // 1.4 Contexto do Negócio
  if (Object.keys(businessContext).length > 0) {
    sections.push("# CONTEXTO DO NEGÓCIO");
    sections.push("");
    appendIf(sections, "Empresa/Marca", businessContext.companyName);
    appendIf(sections, "Produto/Serviço", businessContext.productSummary);
    appendIf(sections, "Perfil de cliente ideal", businessContext.idealCustomerProfile);
    appendIf(sections, "Região/Atendimento", businessContext.serviceRegion);
    appendIf(sections, "Proposta de valor", businessContext.valueProps);
    appendIf(sections, "Dores que resolve", businessContext.customerPains);
    appendIf(sections, "Prova social", businessContext.socialProof);
    appendIf(sections, "Política de preço", businessContext.pricingPolicy);
    appendIf(sections, "Condições comerciais", businessContext.commercialTerms);
    appendIf(sections, "Horários/SLA", businessContext.businessHoursSla);
    appendIf(sections, "Próximo passo padrão", businessContext.primaryCta);
    appendIf(sections, "Compliance/Políticas", businessContext.compliancePolicy);
    sections.push("");
  }
}

// =====================================================
// CAMADA 2 — CONHECIMENTO
// =====================================================

function buildKnowledgeLayer(
  sections: string[],
  agent: CopilotAgent,
  faqs: CopilotAgentFaq[],
  conversationStyle: Record<string, any>,
  qualificationRules: Record<string, any>,
  fewShotExamples: Array<{ lead: string; agent: string }>,
  availability: Record<string, any>,
  responseDelaySeconds: number,
  businessContext: Record<string, any> = {}
) {
  // 2.1-2.3 Habilidades e Tópicos
  const skillsAndTopics = (businessContext as any).skillsAndTopics as string | undefined;
  if (skillsAndTopics && skillsAndTopics.trim()) {
    // Wizard v3: campo livre unificado
    sections.push("# HABILIDADES, TÓPICOS E LIMITES");
    sections.push("");
    sections.push(skillsAndTopics.trim());
    sections.push("");
  } else {
    // Fallback: arrays legados (Wizard v2)
    if (agent.skills && agent.skills.length > 0) {
      sections.push("# HABILIDADES");
      sections.push("");
      sections.push("Você possui as seguintes habilidades:");
      agent.skills.forEach((skill) => sections.push(`- ${skill}`));
      sections.push("");
    }

    if (agent.allowed_topics && agent.allowed_topics.length > 0) {
      sections.push("# O QUE VOCÊ PODE DISCUTIR");
      sections.push("");
      sections.push("Você está autorizado a discutir sobre:");
      agent.allowed_topics.forEach((topic) => sections.push(`- ${topic}`));
      sections.push("");
    }

    if (agent.forbidden_topics && agent.forbidden_topics.length > 0) {
      sections.push("# O QUE VOCÊ NÃO PODE DISCUTIR");
      sections.push("");
      sections.push(
        "⚠️ IMPORTANTE: Você NÃO DEVE, em hipótese alguma, discutir sobre:"
      );
      agent.forbidden_topics.forEach((topic) => sections.push(`- ${topic}`));
      sections.push("");
      sections.push(
        "Se o cliente perguntar sobre esses tópicos, redirecione educadamente para um humano."
      );
      sections.push("");
    }
  }

  // 2.4 Estilo de conversa
  if (Object.keys(conversationStyle).length > 0) {
    sections.push("# ESTILO DE CONVERSA (WHATSAPP)");
    sections.push("");
    if (conversationStyle.responseLength === "curto") {
      sections.push("- Responda em 1–3 frases curtas por padrão");
    } else if (conversationStyle.responseLength === "medio") {
      sections.push("- Responda em 3–6 frases quando necessário");
    } else if (conversationStyle.responseLength === "detalhado") {
      sections.push("- Só responda detalhado quando o lead pedir");
    }
    if (conversationStyle.maxQuestions === "1") {
      sections.push("- Faça no máximo 1 pergunta por mensagem");
    } else if (conversationStyle.maxQuestions === "2") {
      sections.push("- Faça no máximo 2 perguntas por mensagem");
    }
    if (conversationStyle.emojiPolicy === "nunca") {
      sections.push("- Não use emojis");
    } else if (conversationStyle.emojiPolicy === "raro") {
      sections.push("- Use emojis raramente (no máximo 1)");
    } else if (conversationStyle.emojiPolicy === "moderado") {
      sections.push("- Use emojis apenas se o lead usar primeiro");
    }
    appendIf(sections, "Abertura preferida", conversationStyle.openingStyle);
    appendIf(sections, "Fechamento preferido", conversationStyle.closingStyle);
    if (conversationStyle.whatsappGuidelines) {
      sections.push("");
      sections.push("Diretrizes adicionais:");
      sections.push(conversationStyle.whatsappGuidelines);
    }
    if (conversationStyle.humanizationTips) {
      sections.push("");
      sections.push("Dicas de humanização:");
      sections.push(conversationStyle.humanizationTips);
    }

    // Split de mensagens — sempre ativo para WhatsApp
    sections.push("");
    sections.push("## SPLIT DE MENSAGENS (OBRIGATÓRIO)");
    sections.push("");
    sections.push('Use o delimitador "||SPLIT||" para dividir sua resposta em 2-3 mensagens curtas e naturais, como um humano faz no WhatsApp.');
    sections.push("Regras:");
    sections.push("- Máximo 3-4 frases por bloco");
    sections.push("- Primeira mensagem: saudação, gancho ou contexto");
    sections.push("- Última mensagem: pergunta aberta ou CTA claro");
    sections.push('- Se a resposta tiver apenas 1-2 frases curtas, NÃO use ||SPLIT||');
    sections.push('Exemplo: "Oi {nome}! 😊 ||SPLIT|| Aqui na [Empresa] ajudamos times B2B a fechar mais negócios com menos esforço. ||SPLIT|| Me conta: qual o maior desafio do seu time hoje?"');
    sections.push("");
  }

  // 2.5 Qualificação mínima
  if (qualificationRules) {
    const requiredFields = (qualificationRules.requiredFields || []) as string[];
    const optionalFields = (qualificationRules.optionalFields || []) as string[];
    if (
      requiredFields.length > 0 ||
      optionalFields.length > 0 ||
      qualificationRules.notes
    ) {
      sections.push("# QUALIFICAÇÃO MÍNIMA");
      sections.push("");
      if (requiredFields.length > 0) {
        sections.push("Campos obrigatórios (prioridade):");
        requiredFields.forEach((field) => sections.push(`- ${field}`));
        sections.push("");
      }
      if (optionalFields.length > 0) {
        sections.push("Campos opcionais:");
        optionalFields.forEach((field) => sections.push(`- ${field}`));
        sections.push("");
      }
      if (qualificationRules.notes) {
        sections.push("Observações:");
        sections.push(String(qualificationRules.notes));
        sections.push("");
      }
    }
  }

  // 2.6 Disponibilidade
  if (availability.mode) {
    sections.push("# DISPONIBILIDADE");
    sections.push("");
    if (availability.mode === "always") {
      sections.push("- Atendimento: 24 horas");
    } else {
      const days = Array.isArray(availability.days)
        ? availability.days.join(", ")
        : "";
      appendIf(sections, "Dias", days);
      appendIf(
        sections,
        "Horário",
        availability.start && availability.end
          ? `${availability.start}–${availability.end}`
          : ""
      );
      appendIf(sections, "Fuso", availability.timezone);
    }
    if (responseDelaySeconds && responseDelaySeconds > 0) {
      sections.push(`- Tempo médio de resposta: ~${responseDelaySeconds}s`);
    }
    sections.push("");
  }

  // 2.7 FAQs
  if (faqs && faqs.length > 0) {
    sections.push("# PERGUNTAS FREQUENTES");
    sections.push("");
    sections.push(
      "Se o cliente fizer perguntas similares a estas, use as respostas abaixo como base:"
    );
    sections.push("");
    faqs
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .forEach((faq, index) => {
        sections.push(`## FAQ ${index + 1}`);
        sections.push(`**Pergunta:** ${faq.question}`);
        sections.push(`**Resposta:** ${faq.answer}`);
        sections.push("");
      });
  }

  // 2.8 Exemplos de conversa do usuário
  if (fewShotExamples && fewShotExamples.length > 0) {
    sections.push("# EXEMPLOS DE CONVERSA (IMITE O ESTILO)");
    sections.push("");
    fewShotExamples.slice(0, 5).forEach((example, index) => {
      sections.push(`## Exemplo ${index + 1}`);
      sections.push(`Lead: ${example.lead}`);
      sections.push(`Agente: ${example.agent}`);
      sections.push("");
    });
  }
}

// =====================================================
// CAMADA 3 — METODOLOGIA (template-specific)
// =====================================================

function buildMethodologyLayer(sections: string[], agent: CopilotAgent) {
  const templateConfig = getTemplatePromptConfig(agent.template_type as any);
  if (!templateConfig) return;

  sections.push("# ESPECIALIZAÇÃO DO AGENTE");
  sections.push("");
  sections.push(templateConfig.basePrompt);
  sections.push("");

  sections.push(templateConfig.methodology);
  sections.push("");

  sections.push("# O QUE VOCÊ NUNCA DEVE FAZER");
  sections.push("");
  templateConfig.antiPatterns.forEach((ap) => sections.push(`- ${ap}`));
  sections.push("");

  sections.push("# TÉCNICAS RECOMENDADAS");
  sections.push("");
  templateConfig.techniques.forEach((t) => sections.push(`- ${t}`));
  sections.push("");

  sections.push("# QUANDO TRANSFERIR PARA HUMANO");
  sections.push("");
  templateConfig.humanTransferTriggers.forEach((t) =>
    sections.push(`- ${t}`)
  );
  sections.push("");

  sections.push("# DETECÇÃO DE INTENÇÃO DO LEAD");
  sections.push("");
  sections.push("Ao detectar estas intenções, ajuste seu comportamento:");
  sections.push("");
  templateConfig.intentDetection.forEach((intent) => {
    sections.push(`## ${intent.intent.toUpperCase()}`);
    sections.push(`Keywords: ${intent.keywords.join(", ")}`);
    sections.push(`Ação: ${intent.action}`);
    sections.push("");
  });

  if (templateConfig.fewShotExamples.length > 0) {
    sections.push("# EXEMPLOS DE CONVERSA DO TEMPLATE");
    sections.push("");
    templateConfig.fewShotExamples.forEach((ex, i) => {
      sections.push(
        `## Exemplo ${i + 1}${ex.context ? ` (${ex.context})` : ""}`
      );
      sections.push(`Lead: ${ex.lead}`);
      sections.push(`Agente: ${ex.agent}`);
      sections.push("");
    });
  }
}

// =====================================================
// CONTEXTO DINÂMICO (runtime — não afeta o hash)
// =====================================================

function buildDynamicContext(
  sections: string[],
  context: AgentContext | undefined,
  kanbanRules: CopilotAgentKanbanRule[],
  conversationContext: ConversationContextSummary | undefined
) {
  // Contexto da última conversa (follow-up inteligente)
  if (conversationContext && conversationContext.messageCount > 0) {
    sections.push("# CONTEXTO DA ÚLTIMA CONVERSA");
    sections.push("");
    sections.push(
      "⚠️ IMPORTANTE: Use estas informações para continuar a conversa de forma natural e contextualizada."
    );
    sections.push("");

    if (conversationContext.lastTopic) {
      sections.push(
        `**Último assunto discutido:** ${conversationContext.lastTopic}`
      );
    }
    if (conversationContext.lastIntent) {
      sections.push(
        `**Última intenção detectada:** ${conversationContext.lastIntent}`
      );
    }
    sections.push(
      `**Temperatura do lead:** ${conversationContext.leadTemperature.toUpperCase()}`
    );
    sections.push(
      `**Score de engajamento:** ${conversationContext.engagementScore}/100`
    );
    sections.push(
      `**Total de mensagens trocadas:** ${conversationContext.messageCount}`
    );

    if (conversationContext.lastMessageAt) {
      const lastDate = new Date(conversationContext.lastMessageAt);
      const now = new Date();
      const diffMs = now.getTime() - lastDate.getTime();
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffHours / 24);

      if (diffDays > 0) {
        sections.push(
          `**Tempo desde última mensagem:** ${diffDays} dia(s)`
        );
      } else if (diffHours > 0) {
        sections.push(
          `**Tempo desde última mensagem:** ${diffHours} hora(s)`
        );
      }
    }

    if (conversationContext.keyPoints.length > 0) {
      sections.push("");
      sections.push("**Pontos-chave mencionados pelo lead:**");
      conversationContext.keyPoints.forEach((point, i) => {
        sections.push(`${i + 1}. "${point}"`);
      });
    }

    if (conversationContext.objectionsRaised.length > 0) {
      sections.push("");
      sections.push("**Objeções levantadas anteriormente:**");
      conversationContext.objectionsRaised.forEach((obj, i) => {
        sections.push(`${i + 1}. "${obj}"`);
      });
      sections.push("");
      sections.push(
        "→ Se estas objeções surgirem novamente, aborde-as diretamente."
      );
    }

    if (conversationContext.questionsAsked.length > 0) {
      sections.push("");
      sections.push("**Perguntas feitas pelo lead:**");
      conversationContext.questionsAsked.forEach((q, i) => {
        sections.push(`${i + 1}. "${q}"`);
      });
      sections.push("");
      sections.push(
        "→ Se alguma pergunta não foi respondida, priorize respondê-la."
      );
    }

    sections.push("");
    sections.push("**COMO USAR ESTE CONTEXTO:**");
    sections.push(
      "- Retome o último assunto naturalmente ('Na nossa última conversa você mencionou...')"
    );
    sections.push(
      "- Se lead estava interessado: avance para próximo passo"
    );
    sections.push(
      "- Se lead tinha objeção: endereça antes de avançar"
    );
    sections.push(
      "- Se lead fez pergunta não respondida: responda primeiro"
    );
    sections.push("");
  }

  // Contexto atual da conversa
  if (context) {
    sections.push("# CONTEXTO ATUAL");
    sections.push("");
    sections.push(`**Pipeline:** ${context.currentPipe}`);
    sections.push(`**Etapa:** ${context.currentStage}`);

    if (context.leadName) {
      const leadInfo = context.leadCompany
        ? `${context.leadName} (${context.leadCompany})`
        : context.leadName;
      sections.push(`**Lead:** ${leadInfo}`);
    }

    if (context.leadScore !== undefined) {
      sections.push(`**Score do Lead:** ${context.leadScore}/100`);
    }

    if (context.leadTags && context.leadTags.length > 0) {
      sections.push(`**Tags:** ${context.leadTags.join(", ")}`);
    }

    if (context.leadHistory && context.leadHistory.length > 0) {
      sections.push("");
      sections.push("**Histórico Recente:**");
      context.leadHistory.slice(0, 5).forEach((item, index) => {
        sections.push(`${index + 1}. ${item}`);
      });
    }

    sections.push("");

    // Regras específicas do Kanban para a etapa atual — aceita os dois formatos
    // vivos (SCRUM-628): legado (slug + stage_key) e novo (uuid do funil + uuid
    // da etapa, casado via currentPipelineId/currentStageId do contexto).
    const currentRule = kanbanRules?.find(
      (rule) =>
        (rule.pipe_type === context.currentPipe ||
          (!!context.currentPipelineId && rule.pipe_type === context.currentPipelineId)) &&
        (rule.stage_name === context.currentStage ||
          (!!context.currentStageId && rule.stage_name === context.currentStageId))
    );

    if (currentRule) {
      sections.push("# REGRAS PARA ESTA ETAPA");
      sections.push("");

      sections.push("## Objetivo desta etapa:");
      sections.push(currentRule.goal);
      sections.push("");

      sections.push("## Comportamento esperado:");
      sections.push(currentRule.behavior);
      sections.push("");

      if (
        currentRule.allowed_actions &&
        currentRule.allowed_actions.length > 0
      ) {
        sections.push("## Ações permitidas:");
        currentRule.allowed_actions.forEach((action) => {
          sections.push(`✓ ${action}`);
        });
        sections.push("");
      }

      if (
        currentRule.forbidden_actions &&
        currentRule.forbidden_actions.length > 0
      ) {
        sections.push("## Ações proibidas:");
        currentRule.forbidden_actions.forEach((action) => {
          sections.push(`✗ ${action}`);
        });
        sections.push("");
      }

      sections.push(
        "**IMPORTANTE:** Não avance o lead para a próxima etapa sem confirmação explícita de que o objetivo foi atingido."
      );
      sections.push("");
    }
  }
}

// =====================================================
// CAMADA 4 — CUSTOM + INSTRUÇÕES FINAIS
// =====================================================

function buildCustomLayer(sections: string[], agent: CopilotAgent, hideAiIdentity?: boolean) {
  const { dos, donts } = parseCustomInstructions(agent.custom_instructions as string | null);

  // O que deve fazer
  if (dos.trim()) {
    sections.push("# O QUE VOCÊ DEVE FAZER");
    sections.push("");
    sections.push(dos.trim());
    sections.push("");
  }

  // O que não deve fazer
  if (donts.trim()) {
    sections.push("# O QUE VOCÊ NUNCA DEVE FAZER (INSTRUÇÕES DO OPERADOR)");
    sections.push("");
    sections.push("⚠️ As regras abaixo têm PRIORIDADE MÁXIMA e sobrepõem qualquer outra instrução:");
    sections.push("");
    sections.push(donts.trim());
    sections.push("");
  }

  // Instruções finais: usa template-specific quando disponível, senão genéricas
  const templateConfig = getTemplatePromptConfig(agent.template_type as any);

  sections.push("# INSTRUÇÕES FINAIS");
  sections.push("");

  if (templateConfig?.finalInstructions && templateConfig.finalInstructions.length > 0) {
    // Instruções específicas do template
    templateConfig.finalInstructions.forEach((instruction) => {
      sections.push(`- ${instruction}`);
    });
  } else {
    // Fallback: instruções genéricas para custom e templates sem finalInstructions
    sections.push(
      "- Sempre mantenha o tom e estilo definidos na sua personalidade"
    );
    sections.push("- Respeite rigorosamente os tópicos permitidos e proibidos");
    sections.push(
      "- Use as FAQs como base, mas adapte a resposta ao contexto específico"
    );
    if (hideAiIdentity) {
      sections.push("- NUNCA revele que é uma IA, bot ou sistema automatizado — mantenha a persona humana em toda a conversa");
    } else {
      sections.push(
        "- Se perguntarem, seja transparente: você é um assistente virtual da empresa"
      );
    }
    sections.push("- Evite linguagem de IA; responda de forma natural");
    sections.push("- Seja sempre ético, transparente e profissional");
    sections.push(
      "- Em caso de dúvida ou situação complexa, transfira para um humano"
    );
    sections.push(
      "- Nunca invente informações - se não souber, admita e ofereça alternativa"
    );
    sections.push(
      "- Mantenha o foco no objetivo principal sem ser insistente ou agressivo"
    );
  }
}

// =====================================================
// CAMADA 2.5 — BASE DE CONHECIMENTO (document summaries)
// =====================================================

export interface DocumentSummary {
  fileName: string;
  summary: string;
}

function buildKnowledgeBaseLayer(
  sections: string[],
  documentSummaries: DocumentSummary[]
) {
  if (!documentSummaries || documentSummaries.length === 0) return;

  sections.push("# BASE DE CONHECIMENTO CORPORATIVO");
  sections.push("");
  sections.push(
    "Use as informações abaixo como fonte de referência para responder perguntas do lead. Estas foram extraídas de documentos oficiais da empresa."
  );
  sections.push("");

  documentSummaries.forEach((doc, index) => {
    sections.push(`## Documento ${index + 1}: ${doc.fileName}`);
    sections.push(doc.summary);
    sections.push("");
  });

  sections.push(
    "**IMPORTANTE:** Quando usar informações dos documentos, não mencione 'segundo o documento' — fale como se fosse conhecimento natural da empresa."
  );
  sections.push("");
}

// =====================================================
// GENERATE PROMPT (função pura — 4 camadas + knowledge base)
// =====================================================

/**
 * Gera o System Prompt completo a partir dos dados do agente.
 * Função pura — pode ser chamada em qualquer contexto (React, API, etc.)
 *
 * @param agent - Configuração do agente
 * @param faqs - Lista de FAQs
 * @param kanbanRules - Regras do Kanban
 * @param context - Contexto dinâmico (pipeline, stage, lead)
 * @param conversationContext - Contexto da última conversa (follow-up)
 * @param documentSummaries - Resumos de documentos do knowledge base (RAG)
 * @returns GeneratedPrompt
 */
export function generatePrompt(
  agent: CopilotAgent,
  faqs: CopilotAgentFaq[] = [],
  kanbanRules: CopilotAgentKanbanRule[] = [],
  context?: AgentContext,
  conversationContext?: ConversationContextSummary,
  documentSummaries?: DocumentSummary[]
): GeneratedPrompt {
  const sections: string[] = [];
  const businessContext = (agent.business_context || {}) as Record<string, any>;
  const conversationStyle = (agent.conversation_style || {}) as Record<
    string,
    any
  >;
  const qualificationRules = (agent.qualification_rules || {}) as Record<
    string,
    any
  >;
  const fewShotExamples = (agent.few_shot_examples || []) as Array<{
    lead: string;
    agent: string;
  }>;
  const availability = (agent.availability || {}) as Record<string, any>;
  const responseDelaySeconds = agent.response_delay_seconds ?? 0;
  const hideAiIdentity = conversationStyle.hideAiIdentity === true;

  // Camada 1 — Identidade
  buildIdentityLayer(sections, agent, businessContext, hideAiIdentity, conversationStyle);

  // Camada 2 — Conhecimento
  buildKnowledgeLayer(
    sections,
    agent,
    faqs,
    conversationStyle,
    qualificationRules,
    fewShotExamples,
    availability,
    responseDelaySeconds,
    businessContext
  );

  // Camada 2.5 — Base de Conhecimento (document summaries)
  if (documentSummaries && documentSummaries.length > 0) {
    buildKnowledgeBaseLayer(sections, documentSummaries);
  }

  // Camada 3 — Metodologia (template-specific)
  buildMethodologyLayer(sections, agent);

  // Contexto dinâmico (runtime)
  buildDynamicContext(sections, context, kanbanRules, conversationContext);

  // Camada 4 — Custom + Instruções finais
  buildCustomLayer(sections, agent, hideAiIdentity);

  const systemPrompt = sections.join("\n");

  return {
    systemPrompt,
    metadata: {
      agentName: agent.name,
      templateType: agent.template_type as any,
      generatedAt: new Date().toISOString(),
      version: agent.system_prompt_version || 1,
    },
  };
}

// =====================================================
// REACT HOOK
// =====================================================

/**
 * Hook para gerar System Prompt dinamicamente (memoizado).
 * Usado em componentes React para preview em tempo real.
 *
 * @param agent - Configuração do agente
 * @param faqs - Lista de FAQs do agente
 * @param kanbanRules - Regras por etapa do Kanban
 * @param context - Contexto dinâmico opcional (pipeline, stage, lead)
 * @returns GeneratedPrompt com systemPrompt e metadata
 */
export function useCopilotPromptBuilder(
  agent: CopilotAgent | null,
  faqs: CopilotAgentFaq[] | undefined,
  kanbanRules: CopilotAgentKanbanRule[] | undefined,
  context?: AgentContext
): GeneratedPrompt | null {
  const generatedPrompt = useMemo<GeneratedPrompt | null>(() => {
    if (!agent) return null;
    return generatePrompt(agent, faqs || [], kanbanRules || [], context);
  }, [agent, faqs, kanbanRules, context]);

  return generatedPrompt;
}

// =====================================================
// SAVE PROMPT
// =====================================================

/**
 * Salva o system prompt gerado e seu hash no banco de dados.
 *
 * @param agentId - ID do agente
 * @param systemPrompt - System prompt gerado
 * @param version - Versão do prompt
 * @param promptHash - Hash dos campos que geraram o prompt
 */
export async function saveCopilotSystemPrompt(
  agentId: string,
  systemPrompt: string,
  version: number,
  promptHash?: string
): Promise<void> {
  const updatePayload: Record<string, any> = {
    system_prompt: systemPrompt,
    system_prompt_version: version,
    updated_at: new Date().toISOString(),
  };

  if (promptHash) {
    updatePayload.prompt_hash = promptHash;
  }

  const { error } = await supabase
    .from("copilot_agents")
    .update(updatePayload)
    .eq("id", agentId);

  if (error) throw error;
}

// =====================================================
// REGENERATE AND SAVE (tudo-em-um)
// =====================================================

/**
 * Regenera o prompt completo a partir do agente + FAQs e salva no banco.
 * Calcula o hash e salva junto — usado nas mutations de update.
 * Inclui resumos de documentos da knowledge base quando disponíveis.
 *
 * @param agent - Agente completo do banco (com todos os campos)
 * @param faqs - FAQs do agente
 * @returns O prompt gerado e o hash calculado
 */
export async function regenerateAndSavePrompt(
  agent: CopilotAgent,
  faqs: CopilotAgentFaq[] = []
): Promise<{ systemPrompt: string; promptHash: string }> {
  const hash = computePromptHash(agent, faqs);
  const currentHash = agent.prompt_hash as string | null;

  // Se o hash não mudou, não precisa regenerar
  if (currentHash === hash) {
    return {
      systemPrompt: agent.system_prompt || "",
      promptHash: hash,
    };
  }

  // Buscar resumos de documentos da knowledge base
  let documentSummaries: DocumentSummary[] = [];
  try {
    const { data: docs } = await supabase
      .from("copilot_agent_documents")
      .select("file_name, summary")
      .eq("agent_id", agent.id)
      .eq("status", "ready")
      .not("summary", "is", null);

    if (docs && docs.length > 0) {
      documentSummaries = docs.map((d) => ({
        fileName: d.file_name,
        summary: d.summary!,
      }));
    }
  } catch (err) {
    console.warn("Failed to fetch document summaries for prompt:", err);
  }

  const result = generatePrompt(agent, faqs, [], undefined, undefined, documentSummaries);
  const newVersion = (agent.system_prompt_version || 0) + 1;

  await saveCopilotSystemPrompt(
    agent.id,
    result.systemPrompt,
    newVersion,
    hash
  );

  return {
    systemPrompt: result.systemPrompt,
    promptHash: hash,
  };
}
