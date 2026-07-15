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
import { withErrorBoundary } from '../_shared/error-boundary.ts';
import { logRuntime } from "../_shared/logger.ts";
import { sanitizeAssistantMessage, splitByDelimiter } from "../_shared/message-sanitizer.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { requireAuth, AuthError, authErrorResponse, type AuthContext } from "../_shared/user-auth.ts";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Attachment {
  base64: string;
  mimeType: string;
  fileName: string;
}

interface OpenRouterToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface DryRunToolCall {
  name: string;
  parameters: Record<string, unknown>;
  humanDescription: string;
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
  /** Dry-run tools — OpenRouter function-calling format. When present, enables tool preview. */
  tools?: OpenRouterToolDef[];
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

/**
 * Generates human-readable description from tool name + params.
 * Mirrors src/lib/copilot/dry-run-engine.ts#buildHumanDescription — keep in sync.
 */
function buildHumanDescription(name: string, params: Record<string, any>): string {
  switch (name) {
    case "advance_stage":
      return `MOVER_CARD → stage ${params.target_stage || "?"}${params.target_pipe ? ` (${params.target_pipe})` : ""}`;
    case "update_qualification_score":
      return `QUALIFICAR_LEAD → score ${params.score ?? "?"}${params.reason ? `, motivo: ${params.reason}` : ""}`;
    case "qualify_lead":
      return `QUALIFICAR_LEAD → qualificado${params.reason ? ` (${params.reason})` : ""}`;
    case "disqualify_lead":
      return `DESQUALIFICAR_LEAD → desqualificado${params.reason ? ` (${params.reason})` : ""}`;
    case "schedule_meeting":
      return `AGENDAR_REUNIAO → ${params.preferred_date || "?"}${params.preferred_time ? ` ${params.preferred_time}` : ""}`;
    case "confirm_meeting":
      return `CONFIRMAR_REUNIAO → ${params.confirmation_type || "?"}`;
    case "advance_confirmation_stage":
      return `MOVER_CONFIRMACAO → stage ${params.target_stage || "?"}`;
    case "transfer_to_human":
      return `TRANSFERIR_HUMANO → ${params.reason || "sem motivo"}`;
    case "update_lead":
      return `PREENCHER_CAMPOS → ${Object.entries(params.updates || params).map(([k, v]) => `${k}: ${v}`).join(", ") || "?"}`;
    case "create_lead":
      return `CRIAR_LEAD → ${params.name || "?"}`;
    case "search_knowledge":
      return `BUSCAR_KB → "${params.query || "?"}"`;
    case "send_document":
      return `ENVIAR_DOCUMENTO → ${params.document_id || "?"}${params.caption ? ` (${params.caption})` : ""}`;
    case "send_product_material":
      return `ENVIAR_MATERIAL → ${params.material_id || "?"}`;
    case "create_custom_field":
      return `CRIAR_CAMPO → ${params.field_name || "?"} (${params.field_type || "text"})`;
    case "transfer_sz_chat":
      return `TRANSFERIR_SETOR → ${params.target_team_name || "?"}`;
    default:
      return `${name} → ${JSON.stringify(params)}`;
  }
}

/**
 * Converts raw OpenRouter tool_calls into dry-run results.
 * ZERO side effects — intercept only.
 */
function formatToolCallsFromResponse(
  toolCalls: Array<{ function: { name: string; arguments: string } }> | undefined,
): DryRunToolCall[] {
  if (!toolCalls || toolCalls.length === 0) return [];

  return toolCalls.map((tc) => {
    const name = tc.function.name;
    let parameters: Record<string, any> = {};
    try {
      parameters = JSON.parse(tc.function.arguments);
    } catch {
      parameters = { _raw: tc.function.arguments };
    }
    return { name, parameters, humanDescription: buildHumanDescription(name, parameters) };
  });
}

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
  tools?: OpenRouterToolDef[],
): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = {
    model,
    messages: llmMessages,
    temperature,
    max_tokens: maxTokens,
  };

  if (tools && tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = "auto";
  }

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": Deno.env.get("OPENROUTER_REFERER_URL") || "https://torquecrm.com.br",
      "X-Title": "Torque CRM - Test Chat",
    },
    body: JSON.stringify(payload),
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

Deno.serve(withErrorBoundary('test-copilot-chat', async (req) => {
  const origin = req.headers.get("Origin") ?? undefined;
  const corsHeaders = withSecurityHeaders(getCorsHeaders(origin));

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
    const { messages = [], userMessage, generateFirstMessage = false, firstMessageTemplate, agentId, attachment, tools: dryRunTools } = body;
    let { systemPrompt } = body;

    // AUTH: require an authenticated user (also closes the anon denial-of-wallet on the
    // shared OpenRouter key). The per-agent org check runs below when agentId is provided.
    let auth: AuthContext;
    try {
      auth = await requireAuth(req, { body: body as unknown as Record<string, unknown> });
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e, corsHeaders);
      throw e;
    }

    // Modelo e temperatura padrão — podem ser sobrescritos pelo agente do DB
    let model = Deno.env.get("OPENROUTER_DEFAULT_MODEL") || DEFAULT_MODEL;
    let temperature = 0.7;

    // Item #11: Se agentId fornecido, buscar system_prompt atualizado do banco
    if (agentId && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: agent } = await supabase
          .from("copilot_agents")
          .select("organization_id, system_prompt, llm_model, llm_temperature_mode, copilot_agent_faqs(*)")
          .eq("id", agentId)
          .maybeSingle();

        // AUTHORIZE: caller must belong to the agent's org (prevents cross-tenant
        // extraction of another org's prompt / FAQs / knowledge base).
        if (agent && !auth.isMaster) {
          const { data: membership } = await supabase
            .from("team_members")
            .select("id")
            .eq("user_id", auth.userId)
            .eq("organization_id", agent.organization_id)
            .eq("is_active", true)
            .maybeSingle();
          if (!membership) {
            return new Response(
              JSON.stringify({ error: "Forbidden: agent belongs to another organization" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        }

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

    // Mantém as últimas 20 mensagens — alinhado a HISTORY_KEEP_RECENT do agent-message
    // (produção), pra o preview refletir a memória real do agente em conversas longas.
    const recentHistory = messages.slice(-20);
    const hasAttachment = !!attachment;

    const userContent = buildUserContent(userMessage, attachment);

    const llmMessages: Array<Record<string, unknown>> = [
      { role: "system", content: systemPrompt },
      ...recentHistory,
      { role: "user", content: userContent },
    ];

    const result = await callOpenRouter(OPENROUTER_API_KEY, model, llmMessages, 500, temperature, dryRunTools);

    const choice = (result as any).choices?.[0]?.message;
    const rawContent: string = choice?.content || "";
    const rawToolCalls = choice?.tool_calls;

    // Parse dry-run tool calls (zero execution)
    const toolCalls = formatToolCallsFromResponse(rawToolCalls);

    // If LLM returned tool_calls WITHOUT text, do a second call to get the text
    // response the agent would send after "executing" the tools. We simulate
    // tool results so the LLM generates the natural language response.
    let finalContent = rawContent;
    if (toolCalls.length > 0 && !rawContent.trim()) {
      try {
        const simulatedToolResults = rawToolCalls.map((tc: any) => ({
          role: "tool",
          tool_call_id: tc.id || `sim_${tc.function.name}`,
          content: JSON.stringify({ success: true, dry_run: true }),
        }));

        const followUpMessages = [
          ...llmMessages,
          choice,
          ...simulatedToolResults,
        ];

        const followUp = await callOpenRouter(OPENROUTER_API_KEY, model, followUpMessages, 500, temperature);
        finalContent = (followUp as any).choices?.[0]?.message?.content || "";
      } catch (followUpErr) {
        console.warn("[test-copilot-chat] Follow-up call after tool_calls failed:", followUpErr);
      }
    }

    const sanitizedContent = sanitizeAssistantMessage(finalContent, false).text;
    let messageParts = splitByDelimiter(sanitizedContent);
    let cleanMessage = messageParts.join(" ");

    // Guard anti-balão-vazio: se o modelo só devolveu tool_calls e nenhum texto
    // (mesmo após o follow-up), força uma última geração em português pedindo a
    // mensagem ao cliente. Se ainda assim vier vazio, usa um fallback neutro —
    // nunca retorna uma bolha em branco (bug visto no preview: cliente diz
    // "me interessei pelo produto" e recebe mensagem vazia).
    if (cleanMessage.trim().length === 0) {
      try {
        const forced = await callOpenRouter(
          OPENROUTER_API_KEY,
          model,
          [
            { role: "system", content: systemPrompt },
            ...recentHistory,
            { role: "user", content: userContent },
            { role: "user", content: "[SISTEMA] Escreva AGORA, em português e de forma natural, a mensagem que você enviaria ao cliente neste ponto da conversa. Responda SOMENTE com a mensagem ao cliente, sem chamar ferramentas e sem explicações." },
          ],
          400,
          temperature,
        );
        const forcedText = sanitizeAssistantMessage((forced as any).choices?.[0]?.message?.content || "", false).text;
        const forcedParts = splitByDelimiter(forcedText);
        if (forcedParts.length > 0) {
          messageParts = forcedParts;
          cleanMessage = forcedParts.join(" ");
        }
      } catch (forcedErr) {
        console.warn("[test-copilot-chat] Forced text regen after empty content failed:", forcedErr);
      }
    }
    if (cleanMessage.trim().length === 0) {
      cleanMessage = "Perfeito, já anotei aqui! Como posso seguir te ajudando?";
      messageParts = [cleanMessage];
    }

    await logRuntime({
      module: "copilot",
      action: "test_chat",
      status: "success",
      payloadSnapshot: { mode: "reactive", model, historyLength: recentHistory.length, hasAttachment, toolCallCount: toolCalls.length },
    });

    return new Response(
      JSON.stringify({
        message: cleanMessage,
        messages: messageParts.length > 1 ? messageParts : [cleanMessage],
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
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
