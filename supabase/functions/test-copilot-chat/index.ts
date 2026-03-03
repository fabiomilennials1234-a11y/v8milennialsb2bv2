/**
 * Edge Function: test-copilot-chat
 *
 * Simula conversa com o copilot no wizard.
 * Item #11: agora aceita agentId para buscar system_prompt e FAQs do DB em tempo real.
 *
 * Modos:
 * - generateFirstMessage=true: agente proativo gera a primeira mensagem
 * - generateFirstMessage=false: responde à mensagem do usuário (modo reativo)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface TestCopilotChatRequest {
  systemPrompt: string;
  messages: ChatMessage[];
  userMessage: string;
  /** true = agente proativo gera a primeira mensagem (followup, agendador, sdr, prospectador) */
  generateFirstMessage?: boolean;
  /** Template de primeira mensagem configurado no outbound (ex: "Oi {nome}! Vi que...") */
  firstMessageTemplate?: string;
  /** Item #11: Se fornecido, busca system_prompt + FAQs reais do banco */
  agentId?: string;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req) => {
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

    const body: TestCopilotChatRequest = await req.json();
    const { messages = [], userMessage, generateFirstMessage = false, firstMessageTemplate, agentId } = body;
    let { systemPrompt } = body;

    // Item #11: Se agentId fornecido, buscar system_prompt atualizado do banco
    if (agentId && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: agent } = await supabase
          .from("copilot_agents")
          .select("system_prompt, llm_model, llm_temperature_mode, copilot_agent_faqs(*)")
          .eq("id", agentId)
          .maybeSingle();

        if (agent?.system_prompt) {
          systemPrompt = agent.system_prompt;

          // Injetar FAQs no prompt se existirem
          if (agent.copilot_agent_faqs?.length > 0) {
            const faqBlock = agent.copilot_agent_faqs
              .map((f: any) => `P: ${f.question}\nR: ${f.answer}`)
              .join("\n\n");
            systemPrompt += `\n\n## FAQs\n${faqBlock}`;
          }
        }
      } catch (dbErr) {
        console.warn("[test-copilot-chat] DB fetch failed, using provided systemPrompt:", dbErr);
      }
    }

    if (!systemPrompt || systemPrompt.trim().length < 20) {
      return new Response(
        JSON.stringify({ error: "systemPrompt is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Modo proativo: agente gera a primeira mensagem sem input do lead
    if (generateFirstMessage) {
      let triggerInstruction =
        "[MODO TESTE — PRIMEIRA MENSAGEM]\n" +
        "Gere exatamente a primeira mensagem proativa que você enviaria para iniciar o contato com um lead, " +
        "seguindo toda a sua configuração, objetivo e personalidade. " +
        "Escreva apenas a mensagem como você a enviaria pelo WhatsApp — sem explicações, sem prefixos.";

      // Se há template de outbound, instruir o agente a usá-lo como base
      if (firstMessageTemplate) {
        triggerInstruction +=
          "\n\nIMPORTANTE: Use o template abaixo como base para a mensagem, " +
          "substituindo as variáveis ({nome}, {empresa}, etc.) por dados fictícios realistas:\n" +
          `Template: "${firstMessageTemplate}"`;
      }

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": Deno.env.get("OPENROUTER_REFERER_URL") || "https://v8millennials.com",
          "X-Title": "V8 Millennials - Test Copilot Chat (First Message)",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: triggerInstruction },
          ],
          temperature: 0.7,
          max_tokens: 400,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("OpenRouter error (first message):", errText);
        return new Response(
          JSON.stringify({ error: "Failed to generate first message" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const result = await response.json();
      const rawContent: string = result.choices?.[0]?.message?.content || "";

      const messageParts = rawContent
        .split("||SPLIT||")
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0);

      const cleanMessage = messageParts.join(" ");

      return new Response(
        JSON.stringify({
          message: cleanMessage,
          messages: messageParts.length > 1 ? messageParts : [cleanMessage],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Modo reativo: usuário envia mensagem, agente responde
    if (!userMessage || userMessage.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "userMessage is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const recentHistory = messages.slice(-12);

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": Deno.env.get("OPENROUTER_REFERER_URL") || "https://v8millennials.com",
        "X-Title": "V8 Millennials - Test Copilot Chat",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          ...recentHistory,
          { role: "user", content: userMessage },
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenRouter error:", errText);
      return new Response(
        JSON.stringify({ error: "Failed to generate response" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const rawContent: string = result.choices?.[0]?.message?.content || "";

    const messageParts = rawContent
      .split("||SPLIT||")
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);

    const cleanMessage = messageParts.join(" ");

    return new Response(
      JSON.stringify({
        message: cleanMessage,
        messages: messageParts.length > 1 ? messageParts : [cleanMessage],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
