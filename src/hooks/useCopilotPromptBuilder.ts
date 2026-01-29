/**
 * Hook para geração dinâmica de System Prompts
 *
 * Gera o System Prompt completo baseado na configuração do agente
 * e no contexto dinâmico da conversa (pipeline, stage, lead).
 * 
 * Inclui:
 * - Prompts específicos por template
 * - Contexto da última conversa
 * - Metodologias especializadas
 * - Anti-patterns e técnicas
 */

import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import type {
  CopilotAgent,
  CopilotAgentFaq,
  CopilotAgentKanbanRule,
  AgentContext,
  GeneratedPrompt,
  ConversationContextSummary,
} from "@/types/copilot";
import { getTemplatePromptConfig, generateTemplatePrompt } from "@/lib/copilot/template-prompts";

/**
 * Hook para gerar System Prompt dinamicamente
 *
 * @param agent - Configuração do agente
 * @param faqs - Lista de FAQs do agente
 * @param kanbanRules - Regras por etapa do Kanban
 * @param context - Contexto dinâmico opcional (pipeline, stage, lead)
 * @returns GeneratedPrompt com system

Prompt e metadata
 */
export function useCopilotPromptBuilder(
  agent: CopilotAgent | null,
  faqs: CopilotAgentFaq[] | undefined,
  kanbanRules: CopilotAgentKanbanRule[] | undefined,
  context?: AgentContext
): GeneratedPrompt | null {
  const generatedPrompt = useMemo<GeneratedPrompt | null>(() => {
    if (!agent) return null;

    const sections: string[] = [];
    // =====================================================
    // 1. IDENTIDADE DO AGENTE
    // =====================================================
    sections.push("# IDENTIDADE DO AGENTE");
    sections.push("");
    const companyName = businessContext.companyName?.trim();
    sections.push(
      `Você é ${agent.name}, assistente virtual${companyName ? ` da ${companyName}` : ""} especializado em vendas B2B.`
    );
    sections.push(`Template: ${agent.template_type}`);
    sections.push("");

    // =====================================================
    // 2. PERSONALIDADE
    // =====================================================
    sections.push("# PERSONALIDADE");
    sections.push("");
    sections.push(`Tom de voz: ${agent.personality_tone}`);
    sections.push(`Estilo de comunicação: ${agent.personality_style}`);
    sections.push(`Nível de energia: ${agent.personality_energy}`);
    sections.push("");

    const businessContext = (agent.business_context || {}) as Record<string, any>;
    const conversationStyle = (agent.conversation_style || {}) as Record<string, any>;
    const qualificationRules = (agent.qualification_rules || {}) as Record<string, any>;
    const fewShotExamples = (agent.few_shot_examples || []) as Array<{
      lead: string;
      agent: string;
    }>;
    const availability = (agent.availability || {}) as Record<string, any>;
    const responseDelaySeconds = agent.response_delay_seconds ?? 0;

    const appendIf = (label: string, value?: string) => {
      if (value && value.trim()) {
        sections.push(`- ${label}: ${value}`);
      }
    };

    // =====================================================
    // 3. OBJETIVO PRINCIPAL
    // =====================================================
    sections.push("# OBJETIVO PRINCIPAL");
    sections.push("");
    sections.push(agent.main_objective);
    sections.push("");

    // =====================================================
    // 3.1 CONTEXTO DO NEGÓCIO
    // =====================================================
    if (Object.keys(businessContext).length > 0) {
      sections.push("# CONTEXTO DO NEGÓCIO");
      sections.push("");
      appendIf("Empresa/Marca", businessContext.companyName);
      appendIf("Produto/Serviço", businessContext.productSummary);
      appendIf("Perfil de cliente ideal", businessContext.idealCustomerProfile);
      appendIf("Região/Atendimento", businessContext.serviceRegion);
      appendIf("Proposta de valor", businessContext.valueProps);
      appendIf("Dores que resolve", businessContext.customerPains);
      appendIf("Prova social", businessContext.socialProof);
      appendIf("Política de preço", businessContext.pricingPolicy);
      appendIf("Condições comerciais", businessContext.commercialTerms);
      appendIf("Horários/SLA", businessContext.businessHoursSla);
      appendIf("Próximo passo padrão", businessContext.primaryCta);
      appendIf("Compliance/Políticas", businessContext.compliancePolicy);
      sections.push("");
    }

    // =====================================================
    // 3.2 ESTILO DE CONVERSA (WhatsApp)
    // =====================================================
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
      appendIf("Abertura preferida", conversationStyle.openingStyle);
      appendIf("Fechamento preferido", conversationStyle.closingStyle);
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
      sections.push("");
    }

    // =====================================================
    // 3.3 QUALIFICAÇÃO MÍNIMA
    // =====================================================
    // =====================================================
    // 3.4 DISPONIBILIDADE
    // =====================================================
    if (availability.mode) {
      sections.push("# DISPONIBILIDADE");
      sections.push("");
      if (availability.mode === "always") {
        sections.push("- Atendimento: 24 horas");
      } else {
        const days = Array.isArray(availability.days) ? availability.days.join(", ") : "";
        appendIf("Dias", days);
        appendIf("Horário", availability.start && availability.end ? `${availability.start}–${availability.end}` : "");
        appendIf("Fuso", availability.timezone);
      }
      if (responseDelaySeconds && responseDelaySeconds > 0) {
        sections.push(`- Tempo médio de resposta: ~${responseDelaySeconds}s`);
      }
      sections.push("");
    }
    if (qualificationRules) {
      const requiredFields = (qualificationRules.requiredFields || []) as string[];
      const optionalFields = (qualificationRules.optionalFields || []) as string[];
      if (requiredFields.length > 0 || optionalFields.length > 0 || qualificationRules.notes) {
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

    // =====================================================
    // 4. HABILIDADES
    // =====================================================
    if (agent.skills && agent.skills.length > 0) {
      sections.push("# HABILIDADES");
      sections.push("");
      sections.push("Você possui as seguintes habilidades:");
      agent.skills.forEach((skill) => {
        sections.push(`- ${skill}`);
      });
      sections.push("");
    }

    // =====================================================
    // 5. TÓPICOS PERMITIDOS
    // =====================================================
    if (agent.allowed_topics && agent.allowed_topics.length > 0) {
      sections.push("# O QUE VOCÊ PODE DISCUTIR");
      sections.push("");
      sections.push("Você está autorizado a discutir sobre:");
      agent.allowed_topics.forEach((topic) => {
        sections.push(`- ${topic}`);
      });
      sections.push("");
    }

    // =====================================================
    // 6. TÓPICOS PROIBIDOS
    // =====================================================
    if (agent.forbidden_topics && agent.forbidden_topics.length > 0) {
      sections.push("# O QUE VOCÊ NÃO PODE DISCUTIR");
      sections.push("");
      sections.push(
        "⚠️ IMPORTANTE: Você NÃO DEVE, em hipótese alguma, discutir sobre:"
      );
      agent.forbidden_topics.forEach((topic) => {
        sections.push(`- ${topic}`);
      });
      sections.push("");
      sections.push(
        "Se o cliente perguntar sobre esses tópicos, redirecione educadamente para um humano."
      );
      sections.push("");
    }

    // =====================================================
    // 7. PERGUNTAS FREQUENTES
    // =====================================================
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

    // =====================================================
    // 7.1 EXEMPLOS DE CONVERSA
    // =====================================================
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

    // =====================================================
    // 8. CONTEXTO ATUAL (se fornecido)
    // =====================================================
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

      // =====================================================
      // 9. REGRAS ESPECÍFICAS DO KANBAN
      // =====================================================
      const currentRule = kanbanRules?.find(
        (rule) =>
          rule.pipe_type === context.currentPipe &&
          rule.stage_name === context.currentStage
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

    // =====================================================
    // 10. INSTRUÇÕES FINAIS
    // =====================================================
    sections.push("# INSTRUÇÕES FINAIS");
    sections.push("");
    sections.push(
      "- Sempre mantenha o tom e estilo definidos na sua personalidade"
    );
    sections.push("- Respeite rigorosamente os tópicos permitidos e proibidos");
    sections.push(
      "- Use as FAQs como base, mas adapte a resposta ao contexto específico"
    );
    sections.push(
      "- Se perguntarem, seja transparente: você é um assistente virtual da empresa"
    );
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
  }, [agent, faqs, kanbanRules, context]);

  return generatedPrompt;
}

/**
 * Função helper para salvar o system prompt gerado no banco de dados
 * Útil para cache e tracking de versões
 *
 * @param agentId - ID do agente
 * @param systemPrompt - System prompt gerado
 * @param version - Versão do prompt
 */
export async function saveCopilotSystemPrompt(
  agentId: string,
  systemPrompt: string,
  version: number
): Promise<void> {
  const { error } = await supabase
    .from("copilot_agents")
    .update({
      system_prompt: systemPrompt,
      system_prompt_version: version,
      updated_at: new Date().toISOString(),
    })
    .eq("id", agentId);

  if (error) throw error;
}

/**
 * Função helper para gerar prompt sem usar React Hook
 * Útil para uso em contextos não-React (API, background jobs, etc.)
 *
 * @param agent - Configuração do agente
 * @param faqs - Lista de FAQs
 * @param kanbanRules - Regras do Kanban
 * @param context - Contexto dinâmico
 * @param conversationContext - Contexto da última conversa (para follow-up)
 * @returns GeneratedPrompt
 */
export function generatePrompt(
  agent: CopilotAgent,
  faqs: CopilotAgentFaq[] = [],
  kanbanRules: CopilotAgentKanbanRule[] = [],
  context?: AgentContext,
  conversationContext?: ConversationContextSummary
): GeneratedPrompt {
  const sections: string[] = [];
  const businessContext = (agent.business_context || {}) as Record<string, any>;
  const conversationStyle = (agent.conversation_style || {}) as Record<string, any>;
  const qualificationRules = (agent.qualification_rules || {}) as Record<string, any>;
  const fewShotExamples = (agent.few_shot_examples || []) as Array<{
    lead: string;
    agent: string;
  }>;
  const availability = (agent.availability || {}) as Record<string, any>;
  const responseDelaySeconds = agent.response_delay_seconds ?? 0;

  const appendIf = (label: string, value?: string) => {
    if (value && value.trim()) {
      sections.push(`- ${label}: ${value}`);
    }
  };

  // =====================================================
  // 0. PROMPT ESPECÍFICO DO TEMPLATE (se existir)
  // =====================================================
  const templateConfig = getTemplatePromptConfig(agent.template_type as any);
  if (templateConfig) {
    // Adicionar prompt base do template
    sections.push("# ESPECIALIZAÇÃO DO AGENTE");
    sections.push("");
    sections.push(templateConfig.basePrompt);
    sections.push("");
    
    // Adicionar metodologia específica
    sections.push(templateConfig.methodology);
    sections.push("");
    
    // Anti-patterns
    sections.push("# O QUE VOCÊ NUNCA DEVE FAZER");
    sections.push("");
    templateConfig.antiPatterns.forEach(ap => sections.push(`- ${ap}`));
    sections.push("");
    
    // Técnicas
    sections.push("# TÉCNICAS RECOMENDADAS");
    sections.push("");
    templateConfig.techniques.forEach(t => sections.push(`- ${t}`));
    sections.push("");
    
    // Gatilhos de transferência
    sections.push("# QUANDO TRANSFERIR PARA HUMANO");
    sections.push("");
    templateConfig.humanTransferTriggers.forEach(t => sections.push(`- ${t}`));
    sections.push("");
    
    // Detecção de intenção
    sections.push("# DETECÇÃO DE INTENÇÃO DO LEAD");
    sections.push("");
    sections.push("Ao detectar estas intenções, ajuste seu comportamento:");
    sections.push("");
    templateConfig.intentDetection.forEach(intent => {
      sections.push(`## ${intent.intent.toUpperCase()}`);
      sections.push(`Keywords: ${intent.keywords.join(", ")}`);
      sections.push(`Ação: ${intent.action}`);
      sections.push("");
    });
    
    // Exemplos do template
    if (templateConfig.fewShotExamples.length > 0) {
      sections.push("# EXEMPLOS DE CONVERSA DO TEMPLATE");
      sections.push("");
      templateConfig.fewShotExamples.forEach((ex, i) => {
        sections.push(`## Exemplo ${i + 1}${ex.context ? ` (${ex.context})` : ""}`);
        sections.push(`Lead: ${ex.lead}`);
        sections.push(`Agente: ${ex.agent}`);
        sections.push("");
      });
    }
  }

  // =====================================================
  // 1. IDENTIDADE DO AGENTE
  // =====================================================
  sections.push("# IDENTIDADE DO AGENTE");
  sections.push("");
  const companyName = businessContext.companyName?.trim();
  sections.push(
    `Você é ${agent.name}, assistente virtual${companyName ? ` da ${companyName}` : ""} especializado em vendas B2B.`
  );
  sections.push(`Template: ${agent.template_type}`);
  sections.push("");

  // 2. PERSONALIDADE
  sections.push("# PERSONALIDADE");
  sections.push("");
  sections.push(`Tom de voz: ${agent.personality_tone}`);
  sections.push(`Estilo de comunicação: ${agent.personality_style}`);
  sections.push(`Nível de energia: ${agent.personality_energy}`);
  sections.push("");

  // 3. OBJETIVO PRINCIPAL
  sections.push("# OBJETIVO PRINCIPAL");
  sections.push("");
  sections.push(agent.main_objective);
  sections.push("");

  // 3.1 CONTEXTO DO NEGÓCIO
  if (Object.keys(businessContext).length > 0) {
    sections.push("# CONTEXTO DO NEGÓCIO");
    sections.push("");
    appendIf("Empresa/Marca", businessContext.companyName);
    appendIf("Produto/Serviço", businessContext.productSummary);
    appendIf("Perfil de cliente ideal", businessContext.idealCustomerProfile);
    appendIf("Região/Atendimento", businessContext.serviceRegion);
    appendIf("Proposta de valor", businessContext.valueProps);
    appendIf("Dores que resolve", businessContext.customerPains);
    appendIf("Prova social", businessContext.socialProof);
    appendIf("Política de preço", businessContext.pricingPolicy);
    appendIf("Condições comerciais", businessContext.commercialTerms);
    appendIf("Horários/SLA", businessContext.businessHoursSla);
    appendIf("Próximo passo padrão", businessContext.primaryCta);
    appendIf("Compliance/Políticas", businessContext.compliancePolicy);
    sections.push("");
  }

  // 3.2 ESTILO DE CONVERSA (WhatsApp)
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
    appendIf("Abertura preferida", conversationStyle.openingStyle);
    appendIf("Fechamento preferido", conversationStyle.closingStyle);
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
    sections.push("");
  }

  // 3.3 QUALIFICAÇÃO MÍNIMA
  if (qualificationRules) {
    const requiredFields = (qualificationRules.requiredFields || []) as string[];
    const optionalFields = (qualificationRules.optionalFields || []) as string[];
    if (requiredFields.length > 0 || optionalFields.length > 0 || qualificationRules.notes) {
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

  // 3.4 DISPONIBILIDADE
  if (availability.mode) {
    sections.push("# DISPONIBILIDADE");
    sections.push("");
    if (availability.mode === "always") {
      sections.push("- Atendimento: 24 horas");
    } else {
      const days = Array.isArray(availability.days) ? availability.days.join(", ") : "";
      appendIf("Dias", days);
      appendIf("Horário", availability.start && availability.end ? `${availability.start}–${availability.end}` : "");
      appendIf("Fuso", availability.timezone);
    }
    if (responseDelaySeconds && responseDelaySeconds > 0) {
      sections.push(`- Tempo médio de resposta: ~${responseDelaySeconds}s`);
    }
    sections.push("");
  }

  // 4. HABILIDADES
  if (agent.skills && agent.skills.length > 0) {
    sections.push("# HABILIDADES");
    sections.push("");
    sections.push("Você possui as seguintes habilidades:");
    agent.skills.forEach((skill) => {
      sections.push(`- ${skill}`);
    });
    sections.push("");
  }

  // 5. TÓPICOS PERMITIDOS
  if (agent.allowed_topics && agent.allowed_topics.length > 0) {
    sections.push("# O QUE VOCÊ PODE DISCUTIR");
    sections.push("");
    sections.push("Você está autorizado a discutir sobre:");
    agent.allowed_topics.forEach((topic) => {
      sections.push(`- ${topic}`);
    });
    sections.push("");
  }

  // 6. TÓPICOS PROIBIDOS
  if (agent.forbidden_topics && agent.forbidden_topics.length > 0) {
    sections.push("# O QUE VOCÊ NÃO PODE DISCUTIR");
    sections.push("");
    sections.push(
      "⚠️ IMPORTANTE: Você NÃO DEVE, em hipótese alguma, discutir sobre:"
    );
    agent.forbidden_topics.forEach((topic) => {
      sections.push(`- ${topic}`);
    });
    sections.push("");
    sections.push(
      "Se o cliente perguntar sobre esses tópicos, redirecione educadamente para um humano."
    );
    sections.push("");
  }

  // 7. PERGUNTAS FREQUENTES
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

  // 7.1 EXEMPLOS DE CONVERSA
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

  // 8. CONTEXTO DA ÚLTIMA CONVERSA (para follow-up inteligente)
  if (conversationContext && conversationContext.messageCount > 0) {
    sections.push("# CONTEXTO DA ÚLTIMA CONVERSA");
    sections.push("");
    sections.push("⚠️ IMPORTANTE: Use estas informações para continuar a conversa de forma natural e contextualizada.");
    sections.push("");
    
    if (conversationContext.lastTopic) {
      sections.push(`**Último assunto discutido:** ${conversationContext.lastTopic}`);
    }
    if (conversationContext.lastIntent) {
      sections.push(`**Última intenção detectada:** ${conversationContext.lastIntent}`);
    }
    sections.push(`**Temperatura do lead:** ${conversationContext.leadTemperature.toUpperCase()}`);
    sections.push(`**Score de engajamento:** ${conversationContext.engagementScore}/100`);
    sections.push(`**Total de mensagens trocadas:** ${conversationContext.messageCount}`);
    
    if (conversationContext.lastMessageAt) {
      const lastDate = new Date(conversationContext.lastMessageAt);
      const now = new Date();
      const diffMs = now.getTime() - lastDate.getTime();
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffHours / 24);
      
      if (diffDays > 0) {
        sections.push(`**Tempo desde última mensagem:** ${diffDays} dia(s)`);
      } else if (diffHours > 0) {
        sections.push(`**Tempo desde última mensagem:** ${diffHours} hora(s)`);
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
      sections.push("→ Se estas objeções surgirem novamente, aborde-as diretamente.");
    }
    
    if (conversationContext.questionsAsked.length > 0) {
      sections.push("");
      sections.push("**Perguntas feitas pelo lead:**");
      conversationContext.questionsAsked.forEach((q, i) => {
        sections.push(`${i + 1}. "${q}"`);
      });
      sections.push("");
      sections.push("→ Se alguma pergunta não foi respondida, priorize respondê-la.");
    }
    
    sections.push("");
    sections.push("**COMO USAR ESTE CONTEXTO:**");
    sections.push("- Retome o último assunto naturalmente ('Na nossa última conversa você mencionou...')");
    sections.push("- Se lead estava interessado: avance para próximo passo");
    sections.push("- Se lead tinha objeção: endereça antes de avançar");
    sections.push("- Se lead fez pergunta não respondida: responda primeiro");
    sections.push("");
  }

  // 9. CONTEXTO ATUAL (se fornecido)
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

    // 9. REGRAS ESPECÍFICAS DO KANBAN
    const currentRule = kanbanRules?.find(
      (rule) =>
        rule.pipe_type === context.currentPipe &&
        rule.stage_name === context.currentStage
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

  // 10. INSTRUÇÕES FINAIS
  sections.push("# INSTRUÇÕES FINAIS");
  sections.push("");
  sections.push(
    "- Sempre mantenha o tom e estilo definidos na sua personalidade"
  );
  sections.push("- Respeite rigorosamente os tópicos permitidos e proibidos");
  sections.push(
    "- Use as FAQs como base, mas adapte a resposta ao contexto específico"
  );
  sections.push(
    "- Se perguntarem, seja transparente: você é um assistente virtual da empresa"
  );
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
