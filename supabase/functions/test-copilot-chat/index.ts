/**
 * Edge Function: test-copilot-chat
 *
 * Simula conversa com o copilot no wizard/playground.
 * Usa OpenRouter API (mesma infra do agent-message em produção).
 * Item #11: aceita agentId para buscar system_prompt, FAQs e modelo do DB em tempo real.
 *
 * Modos:
 * - generateFirstMessage=true: agente proativo gera a primeira mensagem
 * - generateFirstMessage=false: responde à mensagem do usuário (modo reativo)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from '../_shared/sentry.ts';
import { logRuntime } from "../_shared/logger.ts";
import { sanitizeAssistantMessage, splitByDelimiter } from "../_shared/message-sanitizer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-3-flash-preview";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Attachment {
  base64: string;
  mimeType: string;
  fileName: string;
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
  /** Attachment (imagem ou PDF) enviado pelo usuario */
  attachment?: Attachment;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

/**
 * Build multimodal content array when attachment is present.
 * For images: uses image_url with base64 data URL.
 */
function buildUserContent(text: string, attachment?: Attachment): string | Array<Record<string, unknown>> {
  if (!attachment) return text;

  const parts: Array<Record<string, unknown>> = [];

  if (text) {
    parts.push({ type: "text", text });
  }

  if (attachment.mimeType.startsWith("image/")) {
    parts.push({
      type: "image_url",
      image_url: {
        url: `data:${attachment.mimeType};base64,${attachment.base64}`,
        detail: "auto",
      },
    });
  } else if (attachment.mimeType === "application/pdf") {
    // Inject PDF content as text description since not all models support file type
    parts.push({
      type: "text",
      text: `[Arquivo PDF enviado: ${attachment.fileName}]`,
    });
  }

  return parts;
}

/**
 * Call OpenRouter Chat Completions API.
 * Uses the agent's configured model or falls back to default.
 */
async function callOpenRouter(
  apiKey: string,
  model: string,
  llmMessages: Array<Record<string, unknown>>,
  maxTokens: number,
  temperature: number,
): Promise<Record<string, unknown>> {
  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": Deno.env.get("OPENROUTER_REFERER_URL") || "https://torquecrm.com.br",
      "X-Title": "Torque CRM - Test Chat",
    },
    body: JSON.stringify({
      model,
      messages: llmMessages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("OpenRouter error:", model, errText);

    // If model is invalid/deprecated, retry with default model
    if (response.status === 400 && model !== DEFAULT_MODEL) {
      console.warn(`[test-copilot-chat] Model "${model}" failed with 400, retrying with ${DEFAULT_MODEL}`);
      return callOpenRouter(apiKey, DEFAULT_MODEL, llmMessages, maxTokens, temperature);
    }

    throw new Error(`OpenRouter API error: ${response.status}`);
  }

  return await response.json();
}

Deno.serve(withSentry('test-copilot-chat', async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) {
      return new Response(
        JSON.stringify({ error: "OPENROUTER_API_KEY não configurada. Configure em Supabase > Edge Functions > Secrets." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: TestCopilotChatRequest = await req.json();
    const { messages = [], userMessage, generateFirstMessage = false, firstMessageTemplate, agentId, attachment } = body;
    let { systemPrompt } = body;

    // Modelo e temperatura padrão — podem ser sobrescritos pelo agente do DB
    let model = Deno.env.get("OPENROUTER_DEFAULT_MODEL") || DEFAULT_MODEL;
    let temperature = 0.7;

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

          // Usar modelo e temperatura do agente
          if (agent.llm_model) model = agent.llm_model;
          const temperatureModeMap: Record<string, number> = { criativo: 0.9, balanceado: 0.7, preciso: 0.2 };
          temperature = temperatureModeMap[agent.llm_temperature_mode ?? "balanceado"] ?? 0.7;

          // Injetar FAQs no prompt se existirem
          if (agent.copilot_agent_faqs?.length > 0) {
            const faqBlock = agent.copilot_agent_faqs
              .map((f: any) => `P: ${f.question}\nR: ${f.answer}`)
              .join("\n\n");
            systemPrompt += `\n\n## FAQs\n${faqBlock}`;
          }

          // Injetar Knowledge Base — conteudo COMPLETO dos documentos
          let kbContent = "";
          try {
            const kbRes = await fetch(
              `${SUPABASE_URL}/rest/v1/copilot_agent_documents?agent_id=eq.${agentId}&status=eq.ready&select=content,summary`,
              { headers: { "apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
            );
            if (kbRes.ok) {
              const kbDocs = await kbRes.json();
              kbContent = (kbDocs || [])
                .map((d: any) => (d.content || d.summary || "").substring(0, 30000))
                .filter((t: string) => t.length > 10)
                .join("\n\n");
            }
          } catch { /* fallback below */ }

          // Fallback se REST nao retornou content
          if (!kbContent) {
            const { data: docs } = await supabase
              .from("copilot_agent_documents")
              .select("summary")
              .eq("agent_id", agentId)
              .eq("status", "ready")
              .not("summary", "is", null);
            if (docs && docs.length > 0) {
              kbContent = docs.map((d: any) => d.summary).join("\n\n");
            }
          }

          if (kbContent) {
            systemPrompt += `\n\n# BASE DE CONHECIMENTO (preview)\n\nNo ambiente real, voce usaria a ferramenta search_knowledge para consultar estas informacoes. Neste preview, elas ja estao disponiveis:\n\n${kbContent}\n\n---\nUse estas informacoes para responder com precisao. Cite nomes de produtos e detalhes exatamente como estao acima. Se nao encontrar, diga que vai verificar. NUNCA invente. Fale naturalmente.`;
          }
        }
      } catch (dbErr) {
        console.warn("[test-copilot-chat] DB fetch failed, using provided systemPrompt:", dbErr);
      }
    }

    if (!systemPrompt || systemPrompt.trim().length < 20) {
      return new Response(
        JSON.stringify({ error: "systemPrompt is required" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Modo proativo: agente gera a primeira mensagem sem input do lead
    if (generateFirstMessage) {
      let triggerInstruction =
        "[MODO TESTE — PRIMEIRA MENSAGEM]\n" +
        "Gere exatamente a primeira mensagem proativa que você enviaria para iniciar o contato com um lead, " +
        "seguindo toda a sua configuração, objetivo e personalidade. " +
        "Escreva apenas a mensagem como você a enviaria pelo WhatsApp — sem explicações, sem prefixos.";

      if (firstMessageTemplate) {
        triggerInstruction +=
          "\n\nIMPORTANTE: Use o template abaixo como base para a mensagem, " +
          "substituindo as variáveis ({nome}, {empresa}, etc.) por dados fictícios realistas:\n" +
          `Template: "${firstMessageTemplate}"`;
      }

      const result = await callOpenRouter(
        OPENROUTER_API_KEY,
        model,
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: triggerInstruction },
        ],
        400,
        temperature,
      );

      const rawContent: string = (result as any).choices?.[0]?.message?.content || "";

      const sanitizedContent = sanitizeAssistantMessage(rawContent, false).text;
      const messageParts = splitByDelimiter(sanitizedContent);

      const cleanMessage = messageParts.join(" ");

      await logRuntime({
        module: "copilot",
        action: "test_chat",
        status: "success",
        payloadSnapshot: { mode: "proactive", model, hasTemplate: !!firstMessageTemplate },
      });

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
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const recentHistory = messages.slice(-12);
    const hasAttachment = !!attachment;

    const userContent = buildUserContent(userMessage, attachment);

    const llmMessages: Array<Record<string, unknown>> = [
      { role: "system", content: systemPrompt },
      ...recentHistory,
      { role: "user", content: userContent },
    ];

    const result = await callOpenRouter(OPENROUTER_API_KEY, model, llmMessages, 500, temperature);

    const rawContent: string = (result as any).choices?.[0]?.message?.content || "";

    const sanitizedContent = sanitizeAssistantMessage(rawContent, false).text;
    const messageParts = splitByDelimiter(sanitizedContent);

    const cleanMessage = messageParts.join(" ");

    await logRuntime({
      module: "copilot",
      action: "test_chat",
      status: "success",
      payloadSnapshot: { mode: "reactive", model, historyLength: recentHistory.length, hasAttachment },
    });

    return new Response(
      JSON.stringify({
        message: cleanMessage,
        messages: messageParts.length > 1 ? messageParts : [cleanMessage],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    await logRuntime({
      module: "copilot",
      action: "test_chat",
      status: "error",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
