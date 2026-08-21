/**
 * Persistência de side-effects pós-resposta do LLM.
 *
 *  - createConversation:           cria row em conversations (com fallback in-memory)
 *  - saveConversationContext:      upsert em conversation_context_summary (full)
 *  - updateContextSummaryAfterTurn: upsert incremental por turno (intent/sentiment)
 *  - extractAndSaveMemories:       extrai facts/preferences via LLM e salva pgvector
 *
 * Funções puras (sem `this`) — recebem deps via parâmetros.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { OpenRouterClient } from "../openrouter-client.ts";
import { classifyIntent, detectSentiment } from "./utils.ts";

export interface ConversationContextSummary {
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

export async function createConversation(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string,
  agentId: string,
): Promise<any> {
  console.log("[engine/persist-response] Creating conversation for lead:", leadId, "agent:", agentId);

  const { data, error } = await supabase
    .from("conversations")
    .insert({
      lead_id: leadId,
      organization_id: organizationId,
      agent_id: agentId,
      state: "NEW_LEAD",
      turn_count: 0,
    })
    .select()
    .single();

  if (error) {
    console.error("[engine/persist-response] Error creating conversation:", error);
    if (error.message?.includes("does not exist") || error.code === "42P01") {
      console.warn("[engine/persist-response] Creating in-memory conversation");
      return {
        id: `temp_${leadId}`,
        lead_id: leadId,
        organization_id: organizationId,
        agent_id: agentId,
        state: "NEW_LEAD",
        turn_count: 0,
        context: {},
        short_term_memory: [],
        long_term_memory: {},
      };
    }
    throw error;
  }

  console.log("[engine/persist-response] Conversation created:", data?.id);
  return data;
}

export async function saveConversationContext(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string,
  context: ConversationContextSummary,
): Promise<void> {
  try {
    await supabase.from("conversation_context_summary").upsert(
      {
        lead_id: leadId,
        organization_id: organizationId,
        last_topic: context.lastTopic,
        last_intent: context.lastIntent,
        key_points: context.keyPoints,
        objections_raised: context.objectionsRaised,
        questions_asked: context.questionsAsked,
        next_action: context.nextAction,
        qualification_data: context.qualificationData,
        lead_temperature: context.leadTemperature,
        engagement_score: context.engagementScore,
        last_message_at: context.lastMessageAt,
        message_count: context.messageCount,
        followup_count: context.followupCount,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "lead_id" },
    );
    console.log("[engine/persist-response] Conversation context saved");
  } catch (e) {
    console.warn("[engine/persist-response] Failed to save conversation context:", e);
  }
}

const HOT_STATES = ["QUALIFIED", "SCHEDULED", "MEETING_SCHEDULED", "CLOSED_WON"];
const WARM_STATES = ["QUALIFYING", "INTERESTED", "NEGOTIATING", "WAITING_FOLLOWUP"];

const NEXT_ACTION_MAP: Record<string, string> = {
  NEW_LEAD: "Iniciar qualificação",
  QUALIFYING: "Continuar qualificação",
  QUALIFIED: "Agendar reunião",
  SCHEDULED: "Confirmar reunião",
  WAITING_HUMAN: "Transferir para atendente",
  DISQUALIFIED: "Arquivar lead",
  OPT_OUT: "Sem ação (opt-out)",
};

export async function updateContextSummaryAfterTurn(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string,
  state: string,
  userMessage: string,
  _assistantMessage: string,
  turnCount: number,
): Promise<void> {
  const intent = classifyIntent(userMessage);
  const sentiment = detectSentiment(userMessage);

  let leadTemperature: "cold" | "warm" | "hot" = "cold";
  if (HOT_STATES.includes(state)) leadTemperature = "hot";
  else if (WARM_STATES.includes(state)) leadTemperature = "warm";

  const engagementScore = Math.min(100, turnCount * 5);
  const nextAction = NEXT_ACTION_MAP[state] || "Aguardar resposta do lead";

  try {
    await supabase.from("conversation_context_summary").upsert(
      {
        lead_id: leadId,
        organization_id: organizationId,
        last_intent: intent,
        sentiment: sentiment,
        lead_temperature: leadTemperature,
        engagement_score: engagementScore,
        message_count: turnCount,
        last_message_at: new Date().toISOString(),
        next_action: nextAction,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "lead_id" },
    );

    console.log("[engine/persist-response] Context summary updated:", {
      leadId,
      intent,
      sentiment,
      leadTemperature,
      turnCount,
    });
  } catch (e) {
    console.warn("[engine/persist-response] updateContextSummaryAfterTurn failed:", e);
  }
}

export interface ExtractMemoriesParams {
  supabase: SupabaseClient;
  openRouter: OpenRouterClient;
  organizationId: string;
  leadId: string;
  agentId: string;
  conversationId: string;
  turnCount: number;
  userMessage: string;
  assistantMessage: string;
}

export async function extractAndSaveMemories(params: ExtractMemoriesParams): Promise<void> {
  const {
    supabase,
    openRouter,
    organizationId,
    leadId,
    agentId,
    conversationId,
    turnCount,
    userMessage,
    assistantMessage,
  } = params;

  // Extrair memórias apenas a cada 5 turnos para reduzir custo
  if (turnCount % 5 !== 0) return;

  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) return;

  const extractionPrompt = `Analise este trecho de conversa de vendas B2B e extraia APENAS fatos novos e relevantes sobre o lead.

Lead disse: "${userMessage}"
Agente respondeu: "${assistantMessage}"

Retorne um JSON array com até 3 memórias no formato:
[
  { "memory_type": "fact|preference|pain_point|objection|context", "content": "descrição concisa do fato", "importance": 1-10 }
]

Regras:
- Apenas fatos NOVOS que um agente de vendas precisa saber para conversas futuras
- memory_type: fact=dado objetivo, preference=preferência/gosto, pain_point=dor/problema, objection=objeção levantada, context=contexto geral
- importance: 1-10 (10=crítico para a venda, 1=pouco relevante)
- content: máximo 200 chars, direto ao ponto
- Se não há fatos novos relevantes, retorne []
- Retorne APENAS o JSON array, sem explicações`;

  try {
    const response = await openRouter.chat({
      model: "openai/gpt-4.1-mini",
      messages: [{ role: "user", content: extractionPrompt }],
      temperature: 0.1,
      max_tokens: 400,
    });

    const raw = response.choices[0]?.message?.content || "[]";
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    const extracted = JSON.parse(jsonMatch[0]) as Array<{
      memory_type: string;
      content: string;
      importance: number;
    }>;

    if (!Array.isArray(extracted) || extracted.length === 0) return;

    const contents = extracted.map((m) => m.content);
    const { generateEmbeddingsBatch } = await import("../../_shared/embeddings.ts");
    const embeddings = await generateEmbeddingsBatch(contents, geminiKey);

    for (let i = 0; i < extracted.length; i++) {
      const mem = extracted[i];
      if (!mem.content || mem.content.trim().length < 5) continue;

      await (supabase as any).from("lead_memories").insert({
        lead_id: leadId,
        organization_id: organizationId,
        agent_id: agentId,
        conversation_id: conversationId,
        turn_count: turnCount,
        memory_type: mem.memory_type || "fact",
        content: mem.content.substring(0, 500),
        importance: Math.min(10, Math.max(1, Number(mem.importance) || 5)),
        embedding: `[${embeddings[i].join(",")}]`,
      });
    }

    console.log(`[engine/persist-response] ${extracted.length} memórias salvas para lead ${leadId}`);
  } catch (e) {
    console.warn("[engine/persist-response] Memory extraction/save failed:", e);
  }
}
