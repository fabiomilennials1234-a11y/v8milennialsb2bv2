/**
 * Edge Function: evaluate-agent-conversation
 *
 * Item #8: LLM-as-a-judge — Avaliação automática de qualidade das respostas do agente.
 *
 * Avalia cada par (pergunta do lead → resposta do agente) em 5 dimensões:
 * - Relevância (responde ao que foi perguntado)
 * - Tom (adequado à persona configurada)
 * - Alinhamento com objetivo (contribui para o objetivo do agente)
 * - Concisão (resposta adequada em tamanho)
 * - Score geral
 *
 * Chamada em fire-and-forget após cada turno de conversa.
 *
 * Body: {
 *   conversationId: string,
 *   agentId: string,
 *   leadId: string,
 *   organizationId: string,
 *   turnCount: number,
 *   userMessage: string,
 *   agentResponse: string,
 *   systemPromptExcerpt?: string  // primeiros 500 chars do system prompt
 * }
 */

import { withSentry } from '../_shared/sentry.ts';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logRuntime } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(withSentry('evaluate-agent-conversation', async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) {
      return new Response(
        JSON.stringify({ error: "OpenRouter API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const {
      conversationId,
      agentId,
      leadId,
      organizationId,
      turnCount,
      userMessage,
      agentResponse,
      systemPromptExcerpt = "",
    } = body;

    if (!conversationId || !userMessage || !agentResponse || !organizationId) {
      return new Response(
        JSON.stringify({ error: "conversationId, userMessage, agentResponse, organizationId required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Montar prompt do juiz
    const judgePrompt = `Você é um avaliador especialista em qualidade de conversas de vendas B2B via WhatsApp.

Avalie a resposta abaixo do agente de IA em 4 dimensões (nota de 0.0 a 10.0 cada):

1. **Relevância** (0-10): A resposta aborda diretamente o que o lead perguntou ou disse?
2. **Tom** (0-10): O tom é adequado (profissional, humano, não robótico)?
3. **Alinhamento com objetivo** (0-10): A resposta avança o lead em direção ao objetivo de vendas?
4. **Concisão** (0-10): A resposta é adequada em tamanho (nem muito curta, nem muito longa para WhatsApp)?

${systemPromptExcerpt ? `**Contexto do agente (sistema):**\n${systemPromptExcerpt.substring(0, 500)}\n\n` : ""}**Lead disse:**
${userMessage}

**Agente respondeu:**
${agentResponse}

Responda APENAS com JSON válido no formato:
{
  "score_relevance": 8.5,
  "score_tone": 9.0,
  "score_goal_align": 7.5,
  "score_conciseness": 8.0,
  "score_overall": 8.2,
  "strengths": "breve descrição do que funcionou bem",
  "weaknesses": "breve descrição do que pode melhorar",
  "suggestion": "sugestão concreta de melhoria"
}`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": Deno.env.get("OPENROUTER_REFERER_URL") || "https://v8millennials.com",
        "X-Title": "V8 Millennials - LLM-as-a-Judge",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "user", content: judgePrompt },
        ],
        temperature: 0.1,
        max_tokens: 600,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("[evaluate-agent-conversation] OpenRouter error:", err);
      return new Response(
        JSON.stringify({ error: "LLM evaluation failed" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const raw = result.choices?.[0]?.message?.content || "{}";

    let evaluation: Record<string, any> = {};
    try {
      // Extrair JSON da resposta (pode ter markdown code block)
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      evaluation = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      console.warn("[evaluate-agent-conversation] Failed to parse JSON:", raw);
      return new Response(
        JSON.stringify({ error: "Failed to parse evaluation JSON" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Clampar scores entre 0 e 10
    const clamp = (v: any) => Math.min(10, Math.max(0, Number(v) || 0));

    const record = {
      conversation_id: conversationId,
      organization_id: organizationId,
      agent_id: agentId || null,
      lead_id: leadId || null,
      turn_count: turnCount || 0,
      user_message: userMessage.substring(0, 2000),
      agent_response: agentResponse.substring(0, 2000),
      score_relevance: clamp(evaluation.score_relevance),
      score_tone: clamp(evaluation.score_tone),
      score_goal_align: clamp(evaluation.score_goal_align),
      score_conciseness: clamp(evaluation.score_conciseness),
      score_overall: clamp(evaluation.score_overall),
      strengths: evaluation.strengths || null,
      weaknesses: evaluation.weaknesses || null,
      suggestion: evaluation.suggestion || null,
    };

    const { error: insertError } = await supabase
      .from("copilot_conversation_evaluations")
      .insert(record);

    if (insertError) {
      console.error("[evaluate-agent-conversation] Insert error:", insertError.message);
      return new Response(
        JSON.stringify({ error: insertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[evaluate-agent-conversation] Evaluation saved. Overall: ${record.score_overall}/10`);

    await logRuntime({
      organizationId,
      module: "copilot",
      action: "evaluate",
      status: "success",
      entityType: "conversation",
      entityId: conversationId,
      payloadSnapshot: { scoreOverall: record.score_overall, turnCount },
    });

    return new Response(
      JSON.stringify({ success: true, scores: evaluation }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[evaluate-agent-conversation] Erro:", error);
    await logRuntime({
      module: "copilot",
      action: "evaluate",
      status: "error",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
