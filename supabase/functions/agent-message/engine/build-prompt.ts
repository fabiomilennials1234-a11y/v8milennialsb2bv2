/**
 * Constrói o system prompt dinamico do agente.
 *
 * Função pura — recebe todas as dependências via parâmetros (sem `this`).
 * Mantém o comportamento original byte-a-byte: ordem das seções, fallbacks,
 * formatos.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveActiveWindow, formatTemporalAnchor, formatDateTimeInTz, formatDateInTz } from "../../_shared/copilot/time-context.ts";
import { parseCustomInstructions } from "./utils.ts";
import { getPipeEntry, resolvePipeline, isPipelineResolutionError } from "../../_shared/pipeline-adapter.ts";
import {
  funnelRefsFromRules,
  isCampaignRule,
  isFunnelRule,
  ruleMatchesStage,
} from "../../_shared/copilot/kanban-rules.ts";

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
  sentDocuments?: Array<{ fileName: string; documentId: string }>;
}

/**
 * Gera a seção de prompt que lista documentos já enviados nesta conversa.
 * Retorna string vazia se nenhum documento foi enviado (seção omitida).
 */
export function buildSentDocumentsSection(
  sentDocuments?: { fileName: string; documentId: string }[],
): string {
  if (!sentDocuments || sentDocuments.length === 0) return "";

  const lines: string[] = [];
  lines.push("## Documentos já entregues nesta conversa");
  lines.push("");
  // A redação anterior mandava "confirme que já enviou" e proibia reenviar.
  // Como a lista era montada de `status='completed'` — que incluía os envios
  // que o dedup engoliu —, o modelo era instruído a INSISTIR com o lead que
  // mandou um arquivo que nunca saiu, e ficava proibido de corrigir. Medido em
  // prod 2026-09-01: de 20 leads que disseram "não chegou", em 12 o agente nem
  // tentou de novo. A lista agora só traz o que foi de fato entregue, e a
  // instrução deixa de forçar a insistência.
  // 🚨 2026-09-03: "pedido do lead" é motivo suficiente, e precisa estar dito
  // sem rodeio. A redação anterior abria com a proibição ("não mande de novo") e
  // só depois liberava — o modelo parava na primeira metade e respondia com
  // texto. O runtime não trava mais reenvio (o gate vitalício de
  // `send-document.ts` virou telemetria), então a única coisa entre o pedido do
  // lead e o arquivo é esta instrução.
  lines.push(
    "Os arquivos abaixo já chegaram ao lead nesta conversa. **Se ele pedir qualquer um de novo, ou disser que não recebeu, CHAME `send_document` na hora** — pedir de novo já é motivo suficiente, e reenviar nunca é erro. Nunca responda com texto no lugar do arquivo, nunca afirme que já mandou e nunca peça para ele procurar no histórico. Fora isso, não repita arquivo que ninguém pediu.",
  );
  lines.push("");
  for (const doc of sentDocuments) {
    lines.push(`- ${doc.fileName} (ID: ${doc.documentId})`);
  }
  return lines.join("\n");
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
    sentDocuments,
  } = params;

  const sections: string[] = [];

  // Fuso do agente pra exibir timestamps de eventos (reunião, venda fechada) em
  // hora local, não UTC cru — o banco guarda UTC, converte-se só na exibição.
  const agentTz =
    ((capabilities.availability || {}) as { timezone?: string }).timezone ||
    "America/Sao_Paulo";

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
        "- advance_stage: quando o lead progrediu na jornada — especifique target_stage e target_pipe (os funis e etapas disponíveis desta organização estão listados na própria ferramenta advance_stage)",
      );
      sections.push(
        "O lead pode estar em MÚLTIPLOS funis simultaneamente. Movimente no funil correto.",
      );
      sections.push(
        "Essencial: movimente o lead conforme a conversa evolui. Não deixe leads qualificados ou desqualificados sem usar a ferramenta.",
      );
      sections.push("");
    }

    if (availability.mode) {
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
      }
    }

    if (responseDelaySeconds && responseDelaySeconds > 0) {
      sections.push(`- Tempo médio de resposta: ~${responseDelaySeconds}s`);
    }
    sections.push("");

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
  // 1.3 CONTEXTO TEMPORAL (SEMPRE — inclusive p/ agentes com system_prompt custom)
  // Antes ficava só no ramo `else` (prompt gerado), então agentes de prompt
  // custom NUNCA recebiam a hora atual e podiam oferecer atendimento "ainda hoje"
  // fora do horário comercial. Causa raiz do incidente Promove/Marina (2026-06-18):
  // a IA ofereceu slot "ainda hoje" às 22h porque não sabia que horas eram.
  // =====================================================
  {
    const availabilityForTime = (capabilities.availability || {}) as { timezone?: string };
    const tz = availabilityForTime.timezone || "America/Sao_Paulo";
    const now = new Date();
    const timeContext = resolveActiveWindow(
      { behavior_windows: capabilities.behavior_windows, availability: availabilityForTime },
      now,
    );

    sections.push("");
    sections.push("# CONTEXTO TEMPORAL");
    sections.push(formatTemporalAnchor(now, tz));
    if (timeContext) {
      sections.push(
        "IMPORTANTE: Adapte sua resposta ao momento atual e ao comportamento configurado para esta janela.",
      );
      sections.push(`- Janela ativa: "${timeContext.window.name}"`);
      const trimmedBehavior = (timeContext.window.behavior || "").trim();
      if (trimmedBehavior) {
        sections.push("- Comportamento esperado nesta janela:");
        sections.push(trimmedBehavior);
      }
    }
    sections.push("");
  }

  // =====================================================
  // 1.4 GUARDRAIL DE FERRAMENTAS (anti-leak de tool-call como texto)
  // Incidente 2026-06-02 (Barulhinho Bom): gemini-3-flash-preview emitiu
  // <send_video: ...>, <qualify_lead: {...}>, <move_card: ...>,
  // <transfer_to_human: ...> como TEXTO no lugar de tool_calls nativos,
  // vazando ao cliente. Prompts de agente que ensinam ação como texto
  // (ex: "→ qualify_lead:") agravam. Este bloco reforça o uso nativo — o
  // message-sanitizer é a rede defensiva; isto ataca a causa.
  // =====================================================
  sections.push("");
  sections.push("# REGRA CRÍTICA — FERRAMENTAS (PRIORIDADE MÁXIMA)");
  sections.push(
    "Para QUALQUER ação (enviar vídeo/imagem/documento/material, qualificar ou " +
    "desqualificar lead, mover etapa do funil, transferir para humano, agendar, " +
    "atualizar CRM) use SEMPRE as ferramentas nativas (function calling) que o sistema " +
    "fornece. NUNCA escreva a ação como texto na mensagem: é PROIBIDO emitir " +
    "`<send_video: ...>`, `<qualify_lead: {...}>`, `<move_card: ...>`, `→ qualify_lead`, " +
    "JSON `{\"action\":...}` ou qualquer outra sintaxe de ferramenta. Se não existir uma " +
    "ferramenta para o que você quer fazer, apenas continue a conversa em linguagem " +
    "natural — não invente sintaxe. O cliente JAMAIS pode ver nomes de ferramentas, " +
    "tags, colchetes angulares (<>) ou JSON.",
  );
  sections.push(
    "IGUALMENTE OBRIGATÓRIO: chamar uma ferramenta NÃO substitui conversar. Em TODO " +
    "turno você DEVE escrever também uma mensagem de texto natural e engajada ao cliente " +
    "— mesmo quando enviar mídia. Contextualize o que está mandando, comente e conduza a " +
    "venda com uma pergunta. NUNCA responda apenas com a ferramenta deixando a mensagem " +
    "de texto vazia; a legenda da mídia não conta como a sua resposta.",
  );
  sections.push("");

  // =====================================================
  // 1.5 KNOWLEDGE BASE
  // =====================================================
  if (documentSummaries && documentSummaries.length > 0) {
    const docNames = documentSummaries.map((d) => d.file_name?.trim()).filter(Boolean);
    sections.push("");
    sections.push(`# BASE DE CONHECIMENTO (${documentSummaries.length} doc${documentSummaries.length > 1 ? "s" : ""}${docNames.length > 0 ? ": " + docNames.join(", ") : ""})`);
    sections.push("ANTES de responder sobre produtos, preços ou serviços: use search_knowledge. Se busca não retornar resultado, diga que vai verificar.");
    sections.push("");
  }

  // =====================================================
  // 1.51 DOCUMENTOS JÁ ENVIADOS (soft dedup — LLM awareness)
  // =====================================================
  const sentDocsSection = buildSentDocumentsSection(sentDocuments);
  if (sentDocsSection) {
    sections.push("");
    sections.push(sentDocsSection);
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
  // 2. ESTADO DA CONVERSA (compact — tools já definem capabilities)
  // =====================================================
  sections.push(`Estado: ${conversation.state} | Turno: ${conversation.turn_count}`);
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
    if (leadData.whatsapp_status) sections.push(`- Etapa no funil WhatsApp: ${leadData.whatsapp_status}`);
    if (leadData.confirmacao_status) {
      let confirmacaoInfo = `- Etapa no funil Confirmação: ${leadData.confirmacao_status}`;
      if (leadData.confirmacao_meeting_date)
        confirmacaoInfo += ` (reunião: ${formatDateTimeInTz(leadData.confirmacao_meeting_date, agentTz)})`;
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
          ? formatDateInTz(deal.closed_at, agentTz)
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
  // 4.0.1 RETENÇÃO DE CARTEIRA (Portfolio)
  // =====================================================
  if (capabilities.retention_enabled && currentLeadId) {
    const { data: portfolioClient } = await supabase
      .from("upsell_clients")
      .select("id, health_score, health_status, segment, reorder_cycle_days, days_since_last_order, last_order_at, avg_ticket")
      .eq("lead_id", currentLeadId)
      .eq("is_active", true)
      .maybeSingle();

    if (portfolioClient) {
      const { data: lastOrders } = await supabase
        .from("upsell_orders")
        .select("product_name, sale_value, sold_at")
        .eq("client_id", portfolioClient.id)
        .order("sold_at", { ascending: false })
        .limit(3);

      const { data: activeAlerts } = await supabase
        .from("client_alerts")
        .select("alert_type, severity, title")
        .eq("client_id", portfolioClient.id)
        .eq("is_resolved", false);

      const retentionConfig = (capabilities.retention_config || {}) as Record<string, any>;
      const maxFreq = retentionConfig.max_frequency_days || 7;

      sections.push("");
      sections.push("# RETENÇÃO DE CLIENTES ATIVOS");
      sections.push("");
      sections.push("Quando o contato for um cliente ativo (dados abaixo), priorize:");
      sections.push("1. Se recompra atrasada: ofereça renovação do último pedido com itens e valores.");
      sections.push("2. Se pós-entrega recente (3 dias): pergunte satisfação de 1 a 5.");
      sections.push("3. Se produto ausente detectado: sonde motivo sem ser invasivo.");
      sections.push("4. Se cliente pedir algo: interprete como pedido, confirme itens + quantidades + valores.");
      sections.push(`5. Nunca aborde retenção mais de 1x a cada ${maxFreq} dias.`);
      sections.push("");
      sections.push("DADOS DO CLIENTE:");
      sections.push(`- Health Score: ${portfolioClient.health_score}/100 (${portfolioClient.health_status})`);
      sections.push(`- Segmento: ${portfolioClient.segment}`);
      sections.push(`- Ciclo de recompra: ${portfolioClient.reorder_cycle_days || "N/A"} dias`);
      sections.push(`- Dias desde último pedido: ${portfolioClient.days_since_last_order || "N/A"}`);
      sections.push(`- Ticket médio: R$ ${portfolioClient.avg_ticket || 0}`);
      sections.push(`- Últimos pedidos: ${lastOrders?.map((o: any) => `${o.product_name} (R$${o.sale_value})`).join("; ") || "nenhum"}`);
      sections.push(`- Alertas ativos: ${activeAlerts?.map((a: any) => a.title).join("; ") || "nenhum"}`);
      sections.push("");
    }
  }

  // =====================================================
  // 4.1 REGRAS DA ETAPA ATUAL (Kanban)
  //
  // SCRUM-628: as regras deixam de casar contra a união hardcoded
  // whatsapp/confirmacao/propostas/upsell — cada regra aponta um FUNIL (uuid ou
  // slug, formato novo e legado — ver _shared/copilot/kanban-rules.ts) e a
  // posição do lead vem da entry dele em `pipeline_entries` NAQUELE funil, o
  // que cobre funil custom. Campanha segue como eixo próprio (nome da etapa da
  // campanha, comportamento histórico); Carteira saiu (não é funil).
  // =====================================================
  const kanbanRules = capabilities?.copilot_agent_kanban_rules;
  if (kanbanRules && Array.isArray(kanbanRules) && kanbanRules.length > 0 && currentLeadId) {
    const orgId: string | null =
      (leadData?.organization_id as string) ??
      (conversation?.organization_id as string) ??
      (capabilities?.organization_id as string) ??
      null;

    const matchedRules: Array<{ rule: any; pipeLabel: string; stageLabel: string }> = [];

    // Eixo funil: resolve cada ref citada pelas regras (uuid, slug ou alias —
    // refs diferentes podem apontar o MESMO funil, então agrupa-se por
    // pipeline.id: uma leitura de entry por funil, sem seção duplicada).
    if (orgId) {
      const rulesByPipelineId = new Map<
        string,
        { pipeline: { id: string; slug: string; name: string }; rules: any[] }
      >();
      for (const ref of funnelRefsFromRules(kanbanRules)) {
        try {
          const pipeline = await resolvePipeline(supabase, orgId, ref);
          const group = rulesByPipelineId.get(pipeline.id) ?? { pipeline, rules: [] };
          for (const rule of kanbanRules) {
            if (isFunnelRule(rule) && rule.pipe_type === ref) group.rules.push(rule);
          }
          rulesByPipelineId.set(pipeline.id, group);
        } catch (e) {
          if (isPipelineResolutionError(e)) {
            // Regra apontando funil que a org não tem mais — regra fica muda,
            // o prompt não pode quebrar por config órfã.
            console.warn("[engine/build-prompt] kanban rule com funil não resolvível:", e.message);
            continue;
          }
          throw e;
        }
      }

      for (const { pipeline, rules } of rulesByPipelineId.values()) {
        const entry = await getPipeEntry(supabase, currentLeadId, orgId, pipeline.id);
        if (!entry) continue;
        const entryStageId =
          ((entry as unknown as { stage_id?: string | null }).stage_id ?? null);
        for (const rule of rules) {
          if (ruleMatchesStage(rule, { id: entryStageId, key: entry.stage_key })) {
            matchedRules.push({ rule, pipeLabel: pipeline.name || pipeline.slug, stageLabel: entry.stage_key });
          }
        }
      }
    }

    // Eixo campanha (outro eixo — matching histórico por nome da etapa).
    const campanhaStage = leadData?.campanha_stage?.trim();
    if (campanhaStage) {
      for (const rule of kanbanRules) {
        if (!isCampaignRule(rule)) continue;
        if (rule.stage_name?.toLowerCase() === campanhaStage.toLowerCase()) {
          matchedRules.push({ rule, pipeLabel: "Campanhas", stageLabel: campanhaStage });
        }
      }
    }

    if (matchedRules.length > 0) {
      sections.push("# REGRAS DA ETAPA ATUAL (Kanban)");
      sections.push("");
      for (const { rule, pipeLabel, stageLabel } of matchedRules) {
        sections.push(`Você está conversando com um lead na etapa "${stageLabel}" do funil ${pipeLabel}.`);
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
  if (conversation.context && Object.keys(conversation.context).length > 0) {
    sections.push("# CONTEXTO COLETADO");
    sections.push(JSON.stringify(conversation.context, null, 2));
    sections.push("");
  }

  // =====================================================
  // FORMATO DE SAÍDA (compact)
  // =====================================================
  sections.push("Nunca escreva JSON no texto. Para ações, use tool calls nativos.");
  sections.push("Para separar mensagens WhatsApp, use exatamente ||SPLIT|| (maiúsculas).");

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
    const trigger = reasoningMode === "always" ? "Sempre" : "Antes de usar tools,";
    sections.push("");
    sections.push(`${trigger} raciocine em <thinking>...</thinking>. Resposta final em <response>...</response>.`);
    sections.push("Conteúdo de <thinking> nunca aparece pro lead.");
  }

  return sections.join("\n");
}
