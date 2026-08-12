/**
 * AI operation action handlers.
 * Extracted from workflow-action-handler.ts.
 *
 * - generateAiMessage: calls OpenRouter to generate a message via LLM
 * - summarizeConversation: invokes summarize-conversation edge function
 * - evaluateConversation: invokes evaluate-agent-conversation edge function
 * - queueScheduleMeeting: queues schedule_meeting as pending AI action
 */

import type { ActionInput, ActionResult } from "./types.ts";

// ─── generate_ai_message ──────────────────────────────────────────────────

export async function generateAiMessage(input: ActionInput): Promise<ActionResult> {
  const { params, executionContext } = input;

  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!openRouterApiKey) {
    return { success: false, error: "OPENROUTER_API_KEY not configured" };
  }

  const rawPrompt = (params.aiPrompt as string) || "";
  if (!rawPrompt) {
    return { success: false, error: "Prompt de IA not configured" };
  }

  // Prompt is expected to be pre-resolved by the caller (resolveVariables in switch case).
  // If called directly from registry, caller is responsible for resolution.
  const prompt = rawPrompt;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openRouterApiKey}`,
        "HTTP-Referer": Deno.env.get("OPENROUTER_REFERER_URL") || "https://v8millennials.com",
        "X-Title": "V8 Millennials CRM - Workflow AI Message",
      },
      body: JSON.stringify({
        model: "openai/gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content:
              "Voce e um assistente de vendas B2B. Gere uma mensagem curta, natural e adequada para WhatsApp. " +
              "Nao use saudacoes formais como 'Prezado' ou 'Caro'. Seja direto e conversacional. " +
              "Responda APENAS com o texto da mensagem, sem explicacoes.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { success: false, error: `OpenRouter API error: ${response.status} ${errText}` };
    }

    const data = await response.json();
    const generatedMessage = data.choices?.[0]?.message?.content?.trim() || "";

    if (!generatedMessage) {
      return { success: false, error: "IA retornou mensagem vazia" };
    }

    // Store in execution context so next nodes can use {{ai_message}}
    const outputVar = (params.aiOutputVariable as string) || "ai_message";
    if (executionContext) {
      executionContext[outputVar] = generatedMessage;
    }

    return {
      success: true,
      message: `Mensagem gerada com sucesso (${generatedMessage.length} chars)`,
      data: { [outputVar]: generatedMessage },
    };
  } catch (err) {
    return {
      success: false,
      error: `Erro ao gerar mensagem: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── Edge function invoker (shared by summarize + evaluate) ───────────────

async function invokeEdgeFunction(
  leadId: string | null,
  functionName: string,
): Promise<ActionResult> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (!supabaseUrl) {
    return { success: false, error: "SUPABASE_URL not configured" };
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ lead_id: leadId }),
  });

  if (!res.ok) {
    return { success: false, error: `${functionName} failed: ${await res.text()}` };
  }

  let data: Record<string, unknown> | undefined;
  try {
    data = await res.json();
  } catch {
    // response may not be JSON
  }

  return { success: true, message: `${functionName} completed`, data };
}

// ─── summarize_conversation ───────────────────────────────────────────────

export async function summarizeConversation(input: ActionInput): Promise<ActionResult> {
  return invokeEdgeFunction(input.leadId, "summarize-conversation");
}

// ─── evaluate_conversation ────────────────────────────────────────────────

export async function evaluateConversation(input: ActionInput): Promise<ActionResult> {
  return invokeEdgeFunction(input.leadId, "evaluate-agent-conversation");
}

// ─── queue_schedule_meeting (workflow-specific: queues pending AI action) ──

export async function queueScheduleMeeting(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for queueScheduleMeeting" };
  }

  const { error } = await supabase.from("pending_ai_actions").insert({
    organization_id: organizationId,
    lead_id: leadId,
    action_type: "schedule_meeting",
    payload: {
      source: "workflow",
      preferred_date: params.meetingDate || null,
      closer_id: params.meetingCloserId || null,
    },
    status: "pending",
  });

  if (error) return { success: false, error: error.message };
  return { success: true, message: "Meeting scheduling queued" };
}
