/**
 * Constrói o system prompt dinamico do agente.
 *
 * Função pura — recebe todas as dependências via parâmetros (sem `this`).
 * Mantém o comportamento original byte-a-byte: ordem das seções, fallbacks,
 * formatos.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveActiveWindow } from "../../_shared/copilot/time-context.ts";
import { parseCustomInstructions } from "./utils.ts";

interface ConversationContextSummary {
  lastTopic?: string;
  lastIntent?: string;
  keyPoints: string[];
  objectionsRaised: string[];
  questionsAsked: string[];
  nextAction?: string;
  qualificationData: Record<string, any>;
  leadTemperature: "cold" | "warm" | "hot";
  engagementScore: number;
  lastMessageAt?: string;
  messageCount: number;
  followupCount: number;
}

export interface BuildPromptParams {
  supabase: SupabaseClient;
  capabilities: any;
  conversation: any;
  leadData?: any;
  documentSummaries?: Array<{ file_name: string; summary: string }>;
  semanticContext?: string;
  longTermMemories?: string;
  productCatalog?: string;
  currentLeadId: string | null;
  conversationContext: ConversationContextSummary | null;
  incomingMessageType: string;
}

export async function buildDynamicPrompt(params: BuildPromptParams): Promise<string> {
  const {
    supabase,
    capabilities,
    conversation,
    leadData,
    documentSummaries,
    longTermMemories,
    productCatalog,
    currentLeadId,
    conversationContext,
    incomingMessageType,
  } = params;

  const sections: string[] = [];

  // =====================================================
  // 1. USAR PROMPT DO QUIZ (se existir) OU GERAR COMPLETO
  // =====================================================
  if (capabilities.system_prompt) {
    sections.push(capabilities.system_prompt);
  } else {
    const businessContext = (capabilities.business_context || {}) as Record<string, any>;
    const conversationStyle = (capabilities.conversation_style || {}) as Record<string, any>;
    const qualificationRules = (capabilities.qualification_rules || {}) as Record<string, any>;
    const fewShotExamples = (capabilities.few_shot_examples || []) as Array<{
      lead: string;
      agent: string;
    }>;
    const availability = (capabilities.availability || {}) as Record<string, any>;
    const responseDelaySeconds = capabilities.response_delay_seconds ?? 0;

    const appendIf = (label: string, value?: string) => {
      if (value && value.trim()) {
        sections.push(`- ${label}: ${value}`);
      }
    };

    sections.push("# IDENTIDADE DO AGENTE");
    sections.push("");
    const companyName = businessContext.companyName?.trim();
    sections.push(
      `Você é ${capabilities.name || "Assistente de Vendas"}, assistente virtual${companyName ? ` da ${companyName}` : ""} especializado em vendas B2B.`,
    );
    sections.push(`Template: ${capabilities.template_type || "custom"}`);
    sections.push("");

    sections.push("# PERSONALIDADE");
    sections.push("");
    sections.push(`Tom de voz: ${capabilities.personality_tone || "profissional"}`);
    sections.push(`Estilo de comunicação: ${capabilities.personality_style || "consultivo"}`);
    sections.push(`Nível de energia: ${capabilities.personality_energy || "moderada"}`);
    sections.push("");

    sections.push("# OBJETIVO PRINCIPAL");
    sections.push("");
    const objectiveComposite = capabilities.objective_composite as
      | { mission?: string; success_criteria?: string; limits?: string }
      | null;
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
      sections.push(capabilities.main_objective || "Qualificar leads e agendar reuniões");
      sections.push("");
    }

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

    if (capabilities.can_qualify_lead) {
      sections.push("# MOVIMENTAÇÃO DE FUNIL (FERRAMENTAS)");
      sections.push("");
      sections.push(
        "Use as ferramentas qualify_lead, disqualify_lead e advance_stage para mover o lead no funil:",
      );
      sections.push(
        "- qualify_lead: quando o lead reuniu os critérios obrigatórios e está pronto (ex: agendou ou demonstrou fit)",
      );
      sections.push(
        "- disqualify_lead: quando o lead não se encaixa (sem necessidade, fora do perfil, sem orçamento, desistiu)",
      );
      sections.push(
        "- advance_stage: quando o lead progrediu na jornada — especifique target_stage e target_pipe (whatsapp, confirmacao, propostas, upsell_base, upsell_gestao, campanha)",
      );
      sections.push(
        "O lead pode estar em MÚLTIPLOS funis simultaneamente (WhatsApp + Carteira + Confirmação etc). Movimente no funil correto.",
      );
      sections.push(
        "Essencial: movimente o lead conforme a conversa evolui. Não deixe leads qualificados ou desqualificados sem usar a ferramenta.",
      );
      sections.push("");
    }

    // Time-Aware Behavior — janela ativa + comportamento contextual.
    const timeContext = resolveActiveWindow({
      behavior_windows: capabilities.behavior_windows,
      availability: availability as { timezone?: string },
    });
    if (timeContext) {
      sections.push("# CONTEXTO TEMPORAL");
      sections.push("");
      sections.push(
        "IMPORTANTE: Adapte sua resposta ao momento atual e ao comportamento configurado para esta janela.",
      );
      sections.push("");
      sections.push(timeContext.formatted);
      if (responseDelaySeconds && responseDelaySeconds > 0) {
        sections.push(`- Tempo médio de resposta: ~${responseDelaySeconds}s`);
      }
      sections.push("");
    } else if (availability.mode) {
      sections.push("# DISPONIBILIDADE");
      sections.push("");
      if (availability.mode === "always") {
        sections.push("- Atendimento: 24 horas");
      } else {
        const days = Array.isArray(availability.days) ? availability.days.join(", ") : "";
        appendIf("Dias", days);
        appendIf(
          "Horário",
          availability.start && availability.end
            ? `${availability.start}–${availability.end}`
            : "",
        );
        appendIf("Fuso", availability.timezone);
      }
      if (responseDelaySeconds && responseDelaySeconds > 0) {
        sections.push(`- Tempo médio de resposta: ~${responseDelaySeconds}s`);
      }
      sections.push("");
    }

    // Habilidades
    if (capabilities.skills && capabilities.skills.length > 0) {
      sections.push("# HABILIDADES");
      sections.push("");
      sections.push("Você possui as seguintes habilidades:");
      capabilities.skills.forEach((skill: string) => {
        sections.push(`- ${skill}`);
      });
      sections.push("");
    }

    // Tópicos Permitidos
    if (capabilities.allowed_topics && capabilities.allowed_topics.length > 0) {
      sections.push("# O QUE VOCÊ PODE DISCUTIR");
      sections.push("");
      sections.push("Você está autorizado a discutir sobre:");
      capabilities.allowed_topics.forEach((topic: string) => {
        sections.push(`- ${topic}`);
      });
      sections.push("");
    }

    // Tópicos Proibidos
    if (capabilities.forbidden_topics && capabilities.forbidden_topics.length > 0) {
      sections.push("# O QUE VOCÊ NÃO PODE DISCUTIR");
      sections.push("");
      sections.push("⚠️ IMPORTANTE: Você NÃO DEVE, em hipótese alguma, discutir sobre:");
      capabilities.forbidden_topics.forEach((topic: string) => {
        sections.push(`- ${topic}`);
      });
      sections.push("");
      sections.push("Se o cliente perguntar sobre esses tópicos, redirecione educadamente para um humano.");
      sections.push("");
    }

    // FAQs
    if (capabilities.copilot_agent_faqs && capabilities.copilot_agent_faqs.length > 0) {
      sections.push("# PERGUNTAS FREQUENTES");
      sections.push("");
      sections.push(
        "Se o cliente fizer perguntas similares a estas, use as respostas abaixo como base:",
      );
      sections.push("");

      capabilities.copilot_agent_faqs
        .sort((a: any, b: any) => (a.position || 0) - (b.position || 0))
        .forEach((faq: any, index: number) => {
          sections.push(`## FAQ ${index + 1}`);
          sections.push(`**Pergunta:** ${faq.question}`);
          sections.push(`**Resposta:** ${faq.answer}`);
          sections.push("");
        });
    }

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

    // Instruções personalizadas do usuário (Do's & Don'ts)
    const rawCustom = (capabilities.custom_instructions as string) || "";
    if (rawCustom.trim()) {
      const parsed = parseCustomInstructions(rawCustom);
      if (parsed.dos.trim()) {
        sections.push("# O QUE VOCÊ DEVE FAZER");
        sections.push("");
        sections.push(parsed.dos.trim());
        sections.push("");
      }
      if (parsed.donts.trim()) {
        sections.push("# O QUE VOCÊ NUNCA DEVE FAZER (INSTRUÇÕES DO OPERADOR)");
        sections.push("");
        sections.push("⚠️ As regras abaixo têm PRIORIDADE MÁXIMA e sobrepõem qualquer outra instrução:");
        sections.push("");
        sections.push(parsed.donts.trim());
        sections.push("");
      }
    }
  }

  // =====================================================
  // 1.5 KNOWLEDGE BASE
  // =====================================================
  if (documentSummaries && documentSummaries.length > 0) {
    const docNames = documentSummaries.map((d) => d.file_name?.trim()).filter(Boolean);
    sections.push("");
    sections.push("# BASE DE CONHECIMENTO");
    sections.push("");
    sections.push(
      `Voce tem acesso a uma base de conhecimento com ${documentSummaries.length} documento(s)${docNames.length > 0 ? ": " + docNames.join(", ") : ""}.`,
    );
    sections.push("");
    sections.push("REGRA CRITICA — CONSULTA OBRIGATORIA:");
    sections.push(
      "- Antes de responder QUALQUER pergunta sobre produtos, precos, servicos, especificacoes, politicas, catalogo ou informacoes comerciais, voce DEVE chamar a ferramenta search_knowledge.",
    );
    sections.push("- NAO responda de memoria. NAO improvise. SEMPRE consulte a base primeiro.");
    sections.push("- Use os dados retornados pela busca para formular sua resposta com precisao.");
    sections.push(
      "- Se a busca nao retornar informacoes relevantes, diga honestamente: 'Vou verificar essa informacao e te retorno em breve.'",
    );
    sections.push("- Se o lead pedir um documento, catalogo ou arquivo, use a ferramenta send_document.");
    sections.push(
      "- Fale naturalmente — nunca mencione 'base de conhecimento', 'documento' ou 'ferramenta de busca'.",
    );
    sections.push("");
  }

  // =====================================================
  // 1.52 CATÁLOGO DE PRODUTOS
  // =====================================================
  if (productCatalog && productCatalog.trim().length > 0) {
    sections.push("");
    sections.push("# CATÁLOGO DE PRODUTOS");
    sections.push("");
    sections.push(
      "Abaixo estão os produtos da empresa com detalhes reais. Use ESTES dados para responder sobre produtos, preços e condições:",
    );
    sections.push("");
    sections.push(productCatalog);
    sections.push("");
    sections.push("REGRAS SOBRE PRODUTOS:");
    sections.push(
      "- Use EXATAMENTE os valores de ticket e condições listados acima. Não invente preços.",
    );
    sections.push("- Se o lead perguntar sobre um produto que não está na lista, diga que vai verificar.");
    sections.push(
      "- Se um produto tem materiais disponíveis (PDF, imagem, catálogo), ofereça enviar quando fizer sentido comercial.",
    );
    sections.push("- Para enviar material de produto, use a ferramenta send_product_material com o ID do material.");
    sections.push("- Não envie materiais sem contexto. Acompanhe com mensagem explicativa.");
    sections.push("");
  }

  // =====================================================
  // 1.55 LONG-TERM MEMORIES
  // =====================================================
  if (longTermMemories && longTermMemories.trim().length > 0) {
    sections.push("");
    sections.push("# MEMÓRIA DE LONGO PRAZO DO LEAD");
    sections.push("Informações importantes sobre este lead de conversas anteriores:");
    sections.push(longTermMemories);
    sections.push("**Use este contexto para personalizar a conversa. Não mencione que tem memória prévia.**");
    sections.push("");
  }

  // =====================================================
  // 1.5 CONTEXTO DE INTERVENÇÃO HUMANA RECENTE
  // =====================================================
  try {
    const { data: recentTransfer } = await supabase
      .from("lead_history")
      .select("metadata, created_at")
      .eq("lead_id", currentLeadId)
      .eq("action", "ai_toggled")
      .not("metadata", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentTransfer) {
      const transferTime = new Date(recentTransfer.created_at);
      const minutesAgo = Math.round((Date.now() - transferTime.getTime()) / 60_000);
      const metadata = recentTransfer.metadata as Record<string, unknown>;
      const reason = metadata?.reason as string;

      if (minutesAgo < 1440 && reason) {
        sections.push("");
        sections.push("# CONTEXTO IMPORTANTE");
        sections.push(`Esta conversa foi transferida para um vendedor humano há ${minutesAgo} minutos.`);
        sections.push(`Motivo original da transferência: ${reason}`);
        sections.push("O vendedor interveio e devolveu a conversa para você.");
        sections.push("Continue naturalmente, sem repetir perguntas já feitas.");
        sections.push("");
      }
    }
  } catch (e) {
    console.warn("[engine/build-prompt] Failed to check recent handoff (non-fatal):", e);
  }

  // =====================================================
  // 2. CAPABILITIES DINÂMICAS
  // =====================================================
  sections.push("# CAPABILITIES DINÂMICAS");
  sections.push("");
  sections.push("Estado atual da conversa: " + conversation.state);
  sections.push("Turno: " + conversation.turn_count);
  sections.push("");

  sections.push("## CAPABILITIES ATIVAS (você PODE fazer):");
  if (capabilities.can_qualify_lead) {
    sections.push("- Qualificar leads fazendo perguntas sobre tamanho da empresa, urgência, orçamento");
  }
  if (capabilities.can_schedule_meeting) {
    sections.push("- Agendar reuniões usando a ferramenta schedule_meeting");
  }
  if (capabilities.can_send_followup) {
    sections.push("- Criar follow-ups automáticos");
  }
  if (capabilities.can_update_crm) {
    sections.push("- Atualizar CRM externo do cliente");
  }
  if (capabilities.can_update_lead) {
    sections.push(
      "- Atualizar informações do lead no CRM (empresa, segmento, campos personalizados, notas) usando update_lead",
    );
  }
  if (capabilities.can_create_lead) {
    sections.push("- Criar novos leads no sistema");
  }
  if (capabilities.can_transfer_human) {
    sections.push("- Transferir para atendimento humano se necessário");
  }
  sections.push("");

  sections.push("## CAPABILITIES DESATIVADAS (você NÃO PODE fazer):");
  if (!capabilities.can_qualify_lead) sections.push("- Qualificar leads");
  if (!capabilities.can_schedule_meeting) sections.push("- Agendar reuniões");
  if (!capabilities.can_update_crm) sections.push("- Atualizar CRM");
  if (!capabilities.can_update_lead) sections.push("- Atualizar lead no CRM");
  if (!capabilities.can_create_lead) sections.push("- Criar novos leads");
  sections.push("");

  // =====================================================
  // 3. CONTEXTO DA ÚLTIMA CONVERSA
  // =====================================================
  if (conversationContext && conversationContext.messageCount > 0) {
    sections.push("# CONTEXTO DA ÚLTIMA CONVERSA");
    sections.push("");
    sections.push(
      "⚠️ IMPORTANTE: Use estas informações para continuar a conversa de forma natural e contextualizada.",
    );
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

  // =====================================================
  // 4. DADOS DO LEAD
  // =====================================================
  if (leadData) {
    sections.push("# INFORMAÇÕES DO LEAD");
    sections.push("");
    sections.push(
      "IMPORTANTE: Use estas informações para personalizar sua conversa. Chame o lead pelo nome quando apropriado.",
    );
    sections.push("");

    if (leadData.name) sections.push(`- Nome: ${leadData.name}`);
    if (leadData.phone) sections.push(`- Telefone: ${leadData.phone}`);
    if (leadData.email) sections.push(`- Email: ${leadData.email}`);
    if (leadData.company) sections.push(`- Empresa: ${leadData.company}`);
    if (leadData.segment) sections.push(`- Segmento: ${leadData.segment}`);
    if (leadData.faturamento) sections.push(`- Faturamento: ${leadData.faturamento}`);
    if (leadData.urgency) sections.push(`- Urgência: ${leadData.urgency}`);
    if (leadData.rating) sections.push(`- Rating/Score: ${leadData.rating}/10`);
    if (leadData.origin) sections.push(`- Origem: ${leadData.origin}`);
    if (leadData.pipe_whatsapp) sections.push(`- Etapa no funil WhatsApp: ${leadData.pipe_whatsapp}`);
    if (leadData.confirmacao_status) {
      let confirmacaoInfo = `- Etapa no funil Confirmação: ${leadData.confirmacao_status}`;
      if (leadData.confirmacao_meeting_date)
        confirmacaoInfo += ` (reunião: ${leadData.confirmacao_meeting_date})`;
      if (leadData.confirmacao_is_confirmed) confirmacaoInfo += " [CONFIRMADO]";
      sections.push(confirmacaoInfo);
    }
    if (leadData.propostas_status) {
      let propostasInfo = `- Etapa no funil Propostas: ${leadData.propostas_status}`;
      if (leadData.propostas_sale_value) propostasInfo += ` (valor: R$${leadData.propostas_sale_value})`;
      if (leadData.propostas_product_type) propostasInfo += ` (produto: ${leadData.propostas_product_type})`;
      sections.push(propostasInfo);
    }
    if (leadData.upsell_base_stage) sections.push(`- Etapa na Carteira Base: ${leadData.upsell_base_stage}`);
    if (leadData.upsell_gestao_stage) sections.push(`- Etapa na Carteira Gestão: ${leadData.upsell_gestao_stage}`);
    if (leadData.upsell_potencial) sections.push(`- Potencial do cliente: ${leadData.upsell_potencial}`);
    if (leadData.upsell_is_active === false) sections.push(`- ⚠️ Cliente INATIVO na carteira (possível churn)`);
    if (leadData.campanha_stage) sections.push(`- Etapa na Campanha: ${leadData.campanha_stage}`);
    if (leadData.notes) sections.push(`- Observações: ${leadData.notes}`);

    if (leadData.customFields && Object.keys(leadData.customFields).length > 0) {
      sections.push("");
      sections.push("## Campos Personalizados:");
      for (const [fieldName, value] of Object.entries(leadData.customFields)) {
        sections.push(`- ${fieldName}: ${value}`);
      }
    }

    sections.push("");
  }

  // =====================================================
  // 4.05 HISTÓRICO DE RELACIONAMENTO (vendas anteriores)
  // =====================================================
  const closedDeals = (leadData?.closed_deals ?? []) as Array<{
    status: string;
    sale_value: number | null;
    product_type: string | null;
    closed_at: string | null;
    created_at: string;
    product: { name: string } | null;
  }>;
  const activeProposals = (leadData?.active_proposals ?? []) as Array<{
    status: string;
    sale_value: number | null;
    product_type: string | null;
    product: { name: string } | null;
  }>;
  const isExistingClient = closedDeals.length > 0;

  if (isExistingClient || activeProposals.length > 1) {
    sections.push("# HISTÓRICO DE RELACIONAMENTO");
    sections.push("");

    if (isExistingClient) {
      const totalRevenue = closedDeals.reduce((sum, d) => sum + (d.sale_value ?? 0), 0);
      sections.push(`⚠️ ESTE LEAD JÁ É CLIENTE. Possui ${closedDeals.length} venda(s) fechada(s) (total: R$${totalRevenue.toLocaleString("pt-BR")}).`);
      sections.push("");
      sections.push("Vendas anteriores:");
      for (const deal of closedDeals) {
        const productName = deal.product?.name || deal.product_type || "Produto";
        const value = deal.sale_value ? `R$${deal.sale_value.toLocaleString("pt-BR")}` : "valor N/A";
        const closedDate = deal.closed_at
          ? new Date(deal.closed_at).toLocaleDateString("pt-BR")
          : "data N/A";
        sections.push(`- ${productName}: ${value} (fechado em ${closedDate})`);
      }
      sections.push("");
    }

    if (activeProposals.length > 1) {
      sections.push(`Propostas ativas no momento: ${activeProposals.length}`);
      for (const prop of activeProposals) {
        const productName = prop.product?.name || prop.product_type || "Produto";
        const value = prop.sale_value ? `R$${prop.sale_value.toLocaleString("pt-BR")}` : "";
        sections.push(`- ${productName} (${prop.status})${value ? ` — ${value}` : ""}`);
      }
      sections.push("");
    }

    sections.push("## REGRAS PARA CLIENTES EXISTENTES (PÓS-VENDA)");
    sections.push("");
    sections.push("IMPORTANTE — siga estas regras quando o lead já é cliente:");
    sections.push("1. NUNCA trate como lead novo. Reconheça que já é cliente e personalize o atendimento.");
    sections.push("2. Se entrar em contato novamente, identifique primeiro o motivo: suporte, upsell, cross-sell, renovação ou nova oportunidade.");
    sections.push("3. NÃO mova cards de oportunidades anteriores. Se for nova venda, deve ser criada uma NOVA proposta.");
    sections.push("4. Pergunte especificamente: 'Vi que você já é nosso cliente com [produto]. Esse novo interesse é sobre o mesmo serviço ou algo diferente?'");
    sections.push("5. Se for upsell/cross-sell, avance direto para proposta — não refaça qualificação completa.");
    sections.push("6. Se for suporte ou dúvida sobre produto já contratado, resolva ou transfira para o time responsável.");
    sections.push("7. Use o histórico para criar urgência positiva: 'Como já conhece nosso trabalho com [produto anterior]...'");
    sections.push("");
  }

  // =====================================================
  // 4.1 REGRAS DA ETAPA ATUAL (Kanban)
  // =====================================================
  const kanbanRules = capabilities?.copilot_agent_kanban_rules;
  if (kanbanRules && Array.isArray(kanbanRules) && kanbanRules.length > 0) {
    const pipeLabels: Record<string, string> = {
      whatsapp: "WhatsApp",
      confirmacao: "Confirmação",
      propostas: "Propostas",
      upsell_base: "Carteira Base",
      upsell_gestao: "Carteira Gestão",
      campanha: "Campanhas",
    };
    const currentStages: Array<{ pipe: string; stage: string }> = [];
    if (leadData?.pipe_whatsapp?.trim())
      currentStages.push({ pipe: "whatsapp", stage: leadData.pipe_whatsapp.trim() });
    if (leadData?.confirmacao_status?.trim())
      currentStages.push({ pipe: "confirmacao", stage: leadData.confirmacao_status.trim() });
    if (leadData?.propostas_status?.trim())
      currentStages.push({ pipe: "propostas", stage: leadData.propostas_status.trim() });
    if (leadData?.upsell_base_stage?.trim())
      currentStages.push({ pipe: "upsell_base", stage: leadData.upsell_base_stage.trim() });
    if (leadData?.upsell_gestao_stage?.trim())
      currentStages.push({ pipe: "upsell_gestao", stage: leadData.upsell_gestao_stage.trim() });
    if (leadData?.campanha_stage?.trim())
      currentStages.push({ pipe: "campanha", stage: leadData.campanha_stage.trim() });

    const matchedRules: Array<{ rule: any; pipe: string; stage: string }> = [];
    for (const cs of currentStages) {
      const rule = kanbanRules.find(
        (r: { pipe_type?: string; stage_name?: string }) =>
          r?.pipe_type === cs.pipe && r?.stage_name?.toLowerCase() === cs.stage.toLowerCase(),
      );
      if (rule) matchedRules.push({ rule, pipe: cs.pipe, stage: cs.stage });
    }

    if (matchedRules.length > 0) {
      sections.push("# REGRAS DA ETAPA ATUAL (Kanban)");
      sections.push("");
      for (const { rule, pipe } of matchedRules) {
        const pipeLabel = pipeLabels[pipe] || pipe;
        sections.push(`Você está conversando com um lead na etapa "${rule.stage_name}" do funil ${pipeLabel}.`);
        sections.push("");
        if (rule.goal) sections.push(`**Objetivo desta etapa:** ${rule.goal}`);
        if (rule.behavior) sections.push(`**Comportamento esperado:** ${rule.behavior}`);
        if (
          rule.allowed_actions &&
          Array.isArray(rule.allowed_actions) &&
          rule.allowed_actions.length > 0
        ) {
          sections.push(`**Ações permitidas:** ${rule.allowed_actions.join(", ")}`);
        }
        if (
          rule.forbidden_actions &&
          Array.isArray(rule.forbidden_actions) &&
          rule.forbidden_actions.length > 0
        ) {
          sections.push(`**Ações proibidas:** ${rule.forbidden_actions.join(", ")}`);
        }
        sections.push("");
      }
      sections.push("Siga rigorosamente estas regras ao decidir sua próxima resposta.");
      sections.push("");
    }
  }

  // =====================================================
  // 5. CONTEXTO DA CONVERSA
  // =====================================================
  sections.push("# CONTEXTO DA CONVERSA");
  sections.push("");
  if (conversation.context && Object.keys(conversation.context).length > 0) {
    sections.push("Informações adicionais coletadas durante a conversa:");
    sections.push(JSON.stringify(conversation.context, null, 2));
    sections.push("");
  }
  sections.push(
    "Baseado no estado atual, nas capabilities ativas, nos dados do lead e no contexto coletado, decida a próxima melhor ação.",
  );

  // =====================================================
  // 6. INSTRUÇÕES FINAIS
  // =====================================================
  sections.push("");
  sections.push("# INSTRUÇÕES FINAIS");
  sections.push("");
  sections.push("- Sempre mantenha o tom e estilo definidos na sua personalidade");
  sections.push("- Respeite rigorosamente os tópicos permitidos e proibidos");
  sections.push("- Use as FAQs como base, mas adapte a resposta ao contexto específico");
  sections.push("- Se perguntarem, seja transparente: você é um assistente virtual da empresa");
  sections.push("- Evite linguagem de IA; responda de forma natural");
  sections.push("- Seja sempre ético, transparente e profissional");
  sections.push("- Em caso de dúvida ou situação complexa, transfira para um humano");
  sections.push("- Nunca invente informações - se não souber, admita e ofereça alternativa");
  sections.push("- Mantenha o foco no objetivo principal sem ser insistente ou agressivo");

  // =====================================================
  // FORMATO DE SAÍDA
  // =====================================================
  sections.push("");
  sections.push("# FORMATO DE SAÍDA (OBRIGATÓRIO)");
  sections.push("");
  sections.push(
    '- NUNCA escreva blocos JSON ou código no seu conteúdo de resposta. NUNCA escreva {"action":...} ou {"action_input":...} no texto.',
  );
  sections.push(
    "- Para executar qualquer ação (agendar, enviar material, qualificar, transferir etc), use EXCLUSIVAMENTE o mecanismo nativo de tool/function call do modelo — nunca descreva a ação em texto.",
  );
  sections.push(
    "- Para enviar um material, use a tool `send_product_material` (com `material_id` UUID). NÃO existe tool `send_media` — não invente nomes.",
  );
  sections.push(
    "- Use o delimitador `||SPLIT||` em MAIÚSCULAS exatas para separar mensagens. Nunca use `||split||` ou variações.",
  );
  sections.push("- Se não for separar, apenas escreva o texto direto, sem delimitador.");

  // =====================================================
  // AUDIO MODE
  // =====================================================
  if (capabilities.tts_config) {
    const ttsConfig = capabilities.tts_config as { mode: string; max_chars: number };
    const shouldAddAudioInstructions =
      ttsConfig.mode === "always" ||
      (ttsConfig.mode === "mirror" &&
        (incomingMessageType === "audio" || incomingMessageType === "ptt"));

    if (shouldAddAudioInstructions) {
      sections.push("");
      sections.push("# [MODO ÁUDIO ATIVO]");
      sections.push("Suas respostas serão convertidas em áudio (voice note). Por isso:");
      sections.push(
        `- Mantenha respostas curtas e diretas (máximo ${ttsConfig.max_chars} caracteres)`,
      );
      sections.push("- Use linguagem falada, natural, como se estivesse gravando um áudio");
      sections.push("- Evite listas, bullet points, formatação markdown — nada disso aparece em áudio");
      sections.push("- Evite siglas ou abreviações que não soam bem quando faladas");
      sections.push("- Não use emojis");
    }
  }

  // =====================================================
  // REASONING CHAIN
  // =====================================================
  const reasoningMode = (capabilities.reasoning_mode ?? "always") as "always" | "actions_only" | "off";
  if (reasoningMode !== "off") {
    const trigger =
      reasoningMode === "always"
        ? "SEMPRE"
        : "QUANDO usar tools (schedule_meeting, qualify_lead, transfer_to_human, advance_stage, send_product_material, etc)";
    sections.push("");
    sections.push("# FORMATO DE RESPOSTA OBRIGATÓRIO");
    sections.push("");
    sections.push(`${trigger} responda EXATAMENTE neste formato:`);
    sections.push("");
    sections.push("<thinking>");
    sections.push("Pense passo-a-passo:");
    sections.push("1. O que o lead realmente quer?");
    sections.push("2. Qual contexto da conversa importa?");
    sections.push("3. Qual é a melhor ação? (responder texto OU usar tool)");
    sections.push("4. Se vou usar tool: pré-condições atendidas? (lead tem telefone? agenda livre? stage correto?)");
    sections.push("5. Riscos da ação?");
    sections.push("</thinking>");
    sections.push("<response>");
    sections.push("[mensagem que vai pro lead — texto puro, pode usar ||SPLIT||]");
    sections.push("</response>");
    sections.push("");
    sections.push("CRÍTICO: conteúdo de <thinking> NUNCA aparece pro lead. Apenas <response> é entregue.");
    sections.push("Se for usar tool, ainda assim feche o <thinking> antes de invocar a tool.");
  }

  return sections.join("\n");
}
