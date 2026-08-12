/**
 * Carregamento, extração e compressão de histórico de mensagens.
 *
 *  - getConversationHistory:    busca conversation_messages, fallback whatsapp_messages
 *  - getWhatsAppMessageHistory: fallback puro via whatsapp_messages do lead
 *  - compressHistoryIfNeeded:   resume historico antigo via LLM e mantem N recentes
 *  - extractContextFromMessages: monta ConversationContextSummary das ultimas msgs
 *  - loadConversationContext:   wrapper sobre context-loader externo + fallback
 *
 * Funções puras — recebem deps via parâmetros.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { OpenRouterClient } from "../openrouter-client.ts";
import {
  loadConversationContextSummary as loadConversationContextSummaryExternal,
  getDefaultContext as getDefaultContextExternal,
} from "../../_shared/copilot/context-loader.ts";
import {
  extractTopicFromMessage,
  detectIntentFromMessage,
  calculateLeadTemperature,
  calculateEngagementScore,
} from "./utils.ts";
import {
  saveConversationContext as saveConversationContextExternal,
} from "./persist-response.ts";

const HISTORY_COMPRESS_THRESHOLD = 35;
const HISTORY_KEEP_RECENT = 20;

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

export async function loadConversationContext(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string,
): Promise<ConversationContextSummary | null> {
  const cached = await loadConversationContextSummaryExternal(supabase, leadId);
  if (cached) return cached;

  try {
    const { data: messages, error: msgError } = await supabase
      .from("whatsapp_messages")
      .select("direction, content, created_at")
      .eq("organization_id", organizationId)
      .eq("lead_id", leadId)
      .not("content", "is", null)
      .order("created_at", { ascending: false })
      .limit(20);

    if (msgError || !messages || messages.length === 0) {
      return getDefaultContextExternal();
    }

    const context = await extractContextFromMessages(messages);
    await saveConversationContextExternal(supabase, organizationId, leadId, context);
    return context;
  } catch (e) {
    console.warn("[engine/history] loadConversationContext fallback failed:", e);
    return getDefaultContextExternal();
  }
}

export async function extractContextFromMessages(
  messages: any[],
): Promise<ConversationContextSummary> {
  const context = getDefaultContextExternal();

  if (!messages || messages.length === 0) return context;

  const sortedMessages = [...messages].reverse();

  context.messageCount = sortedMessages.length;

  const lastLeadMessage = sortedMessages.filter((m) => m.direction === "incoming").pop();

  if (lastLeadMessage) {
    context.lastMessageAt = lastLeadMessage.created_at;
    context.lastTopic = extractTopicFromMessage(lastLeadMessage.content);
    context.lastIntent = detectIntentFromMessage(lastLeadMessage.content);
  }

  const leadMessages = sortedMessages.filter((m) => m.direction === "incoming");

  context.questionsAsked = leadMessages
    .filter((m) => m.content && m.content.includes("?"))
    .map((m) => m.content.trim())
    .slice(-5);

  const objectionKeywords = [
    "caro",
    "preço",
    "não tenho",
    "sem verba",
    "orçamento",
    "não preciso",
    "já tenho",
    "não é o momento",
    "depois",
    "sem tempo",
    "muito ocupado",
    "não sei",
  ];

  leadMessages.forEach((m) => {
    if (m.content) {
      const lowerContent = m.content.toLowerCase();
      objectionKeywords.forEach((kw) => {
        if (lowerContent.includes(kw)) {
          context.objectionsRaised.push(m.content.substring(0, 100));
        }
      });
    }
  });
  context.objectionsRaised = [...new Set(context.objectionsRaised)].slice(-5);

  context.leadTemperature = calculateLeadTemperature(leadMessages);
  context.engagementScore = calculateEngagementScore(sortedMessages);

  context.keyPoints = leadMessages
    .filter((m) => m.content && m.content.length > 50)
    .map((m) => m.content.substring(0, 150))
    .slice(-3);

  return context;
}

export async function getWhatsAppMessageHistory(
  supabase: SupabaseClient,
  organizationId: string,
  currentLeadId: string | null,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  if (!currentLeadId) {
    console.log("[engine/history] No currentLeadId, returning empty history");
    return [];
  }

  try {
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("phone")
      .eq("id", currentLeadId)
      .single();

    if (leadError || !lead?.phone) {
      console.warn("[engine/history] Could not get lead phone for history");
      return [];
    }

    const { data: messages, error: msgError } = await supabase
      .from("whatsapp_messages")
      .select("direction, content, created_at")
      .eq("organization_id", organizationId)
      .ilike("phone_number", `%${lead.phone.slice(-8)}%`)
      .not("content", "is", null)
      .order("created_at", { ascending: true })
      .limit(50);

    if (msgError) {
      console.warn("[engine/history] Error getting whatsapp_messages:", msgError.message);
      return [];
    }

    console.log("[engine/history] Found", messages?.length || 0, "whatsapp messages for history");

    return (messages || [])
      .filter((m: any) => m.content && m.content.trim())
      .map((m: any) => ({
        role: (m.direction === "incoming" ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      }));
  } catch (e) {
    console.warn("[engine/history] Failed to get whatsapp message history:", e);
    return [];
  }
}

export async function compressHistoryIfNeeded(
  supabase: SupabaseClient,
  openRouter: OpenRouterClient,
  conversationId: string,
  messages: any[],
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const firstMsg = messages[0];
  if (firstMsg?.content?.startsWith("[RESUMO HISTÓRICO]")) {
    const recentMessages = messages.slice(-HISTORY_KEEP_RECENT);
    return [
      { role: "user" as const, content: firstMsg.content },
      { role: "assistant" as const, content: messages[1]?.content || "Entendido." },
      ...recentMessages.map((m: any) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];
  }

  const oldMessages = messages.slice(0, -HISTORY_KEEP_RECENT);
  const recentMessages = messages.slice(-HISTORY_KEEP_RECENT);

  try {
    const conversationText = oldMessages
      .filter((m: any) => !m.content?.startsWith("[RESUMO HISTÓRICO]"))
      .map((m: any) => `${m.role === "user" ? "Lead" : "Agente"}: ${m.content}`)
      .join("\n");

    const summaryResponse = await openRouter.chat({
      model: "openai/gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "Você é um assistente de CRM. Resuma a conversa abaixo em 4-6 frases incluindo: tópicos discutidos, nível de interesse, objeções levantadas, informações coletadas do lead, e estado atual. Seja objetivo. Retorne apenas o resumo em português.",
        },
        { role: "user", content: `Histórico de ${oldMessages.length} mensagens:\n\n${conversationText}` },
      ],
      temperature: 0.2,
      max_tokens: 400,
    });

    const summary = summaryResponse.choices[0]?.message?.content?.trim() || "";

    if (summary) {
      const summaryContent = `[RESUMO HISTÓRICO]\n${summary}`;
      const ackContent = "Entendido. Continuarei com base no histórico resumido.";

      const oldIds = oldMessages.map((m: any) => m.id).filter(Boolean);
      if (oldIds.length > 0) {
        await supabase.from("conversation_messages").delete().in("id", oldIds);
      }

      const earliestDate =
        oldMessages[0]?.created_at || new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const secondDate = new Date(new Date(earliestDate).getTime() + 1000).toISOString();

      await supabase.from("conversation_messages").insert([
        { conversation_id: conversationId, role: "user", content: summaryContent, created_at: earliestDate },
        { conversation_id: conversationId, role: "assistant", content: ackContent, created_at: secondDate },
      ]);

      console.log(`[engine/history] History compressed: ${oldMessages.length} msgs → 1 summary`);

      return [
        { role: "user" as const, content: summaryContent },
        { role: "assistant" as const, content: ackContent },
        ...recentMessages.map((m: any) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ];
    }
  } catch (err) {
    console.warn("[engine/history] History compression failed (non-fatal):", err);
  }

  return recentMessages.map((m: any) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
}

export interface GetConversationHistoryParams {
  supabase: SupabaseClient;
  openRouter: OpenRouterClient;
  organizationId: string;
  currentLeadId: string | null;
  conversationId: string;
}

export async function getConversationHistory(
  params: GetConversationHistoryParams,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const { supabase, openRouter, organizationId, currentLeadId, conversationId } = params;

  try {
    if (conversationId.startsWith("temp_")) {
      console.log("[engine/history] Temporary conversation, using whatsapp_messages as history");
      return await getWhatsAppMessageHistory(supabase, organizationId, currentLeadId);
    }

    const { data: messages, error } = await supabase
      .from("conversation_messages")
      .select("id, conversation_id, role, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(100);

    if (error) {
      console.warn(
        "[engine/history] Error getting conversation history, falling back to whatsapp_messages:",
        error.message,
      );
      return await getWhatsAppMessageHistory(supabase, organizationId, currentLeadId);
    }

    if (!messages || messages.length === 0) {
      console.log("[engine/history] No conversation_messages found, using whatsapp_messages");
      return await getWhatsAppMessageHistory(supabase, organizationId, currentLeadId);
    }

    if (messages.length > HISTORY_COMPRESS_THRESHOLD) {
      console.log(
        `[engine/history] History has ${messages.length} messages — scheduling background compression`,
      );

      const firstMsg = messages[0];
      if (firstMsg?.content?.startsWith("[RESUMO HISTÓRICO]")) {
        const recentMessages = messages.slice(-HISTORY_KEEP_RECENT);
        return [
          { role: "user" as const, content: firstMsg.content },
          { role: "assistant" as const, content: messages[1]?.content || "Entendido." },
          ...recentMessages.map((m: any) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        ];
      }

      // Fire-and-forget compressão em background, retornar recentes imediatamente
      compressHistoryIfNeeded(supabase, openRouter, conversationId, messages).catch((e) =>
        console.warn("[engine/history] Background history compression failed (non-fatal):", e),
      );

      const recentMessages = messages.slice(-HISTORY_KEEP_RECENT);
      return recentMessages.map((m: any) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
    }

    return messages.map((msg: any) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    }));
  } catch (e) {
    console.warn("[engine/history] Failed to get conversation history:", e);
    return await getWhatsAppMessageHistory(supabase, organizationId, currentLeadId);
  }
}
