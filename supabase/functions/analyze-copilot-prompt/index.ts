import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildEvaluationContext, formatEvaluationContext } from "./evaluation-context.ts";

const GEMINI_MODEL = "gemini-2.5-flash-preview-05-20";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta";
const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES_PER_CONVERSATION = 30;
const MIN_CONVERSATIONS = 5;
const LOOKBACK_DAYS = 7;
const RATE_LIMIT_HOURS = 12;
const EVAL_LOOKBACK_DAYS = 30;

interface Suggestion {
  id: string;
  section: string;
  type: "add" | "rewrite" | "remove";
  field: string;
  current_text: string | null;
  suggested_text: string;
  reason: string;
  evidence: string[];
  confidence: number;
}

function buildMetaPrompt(
  agentConfig: Record<string, unknown>,
  conversations: unknown[],
  opts?: { evaluationSection?: string; singleConversation?: boolean },
): string {
  const promptSections = (agentConfig.conversation_style as any)?.promptSections || {};
  const businessContext = agentConfig.business_context || {};
  const conversationStyle = { ...(agentConfig.conversation_style || {}) } as Record<string, unknown>;
  delete conversationStyle.promptSections;
  delete conversationStyle.toolInstructions;

  return `You are an expert WhatsApp sales conversation analyst for a B2B CRM called Torque CRM.

## Current Agent Configuration

### Agent Name
${agentConfig.name || "Unnamed"}

### Personality Section
${promptSections.personality || "(empty)"}

### Objective Section
${promptSections.objective || "(empty)"}

### Conversation Flow Section
${promptSections.flow || "(empty)"}

### Products/Services Section
${promptSections.products || "(empty)"}

### Instructions (Do's and Don'ts) Section
${promptSections.instructions || "(empty)"}

### Business Context (JSONB)
${JSON.stringify(businessContext, null, 2)}

### Conversation Style (JSONB)
${JSON.stringify(conversationStyle, null, 2)}

### Custom Instructions
${agentConfig.custom_instructions || "(empty)"}
${opts?.evaluationSection ? `\n${opts.evaluationSection}\n` : ""}
## ${opts?.singleConversation ? "Conversa Analisada" : `Recent Conversations (last ${LOOKBACK_DAYS} days)`}
${JSON.stringify(conversations, null, 2)}

## Task${opts?.singleConversation ? " (Análise de Conversa Única)" : ""}

${opts?.singleConversation
    ? "Analyze this specific conversation in depth and identify:"
    : "Analyze these conversations and identify:"}
1. **Knowledge gaps** — questions customers ask that the agent cannot answer well or at all
2. **Behavioral failures** — responses that don't match the configured personality/style/tone
3. **Flow issues** — conversations that deviate from the intended flow or get stuck
4. **Missing context** — business information the agent needs but doesn't have in its prompt

Return a JSON array of suggestions. Each suggestion MUST target a specific section and provide concrete text changes. Sort by confidence (highest first). Maximum 10 suggestions.

IMPORTANT RULES:
- Only suggest changes with confidence >= 0.5
- For prompt sections (personality, objective, flow, products, instructions): set "field" to the section key itself
- For business_context fields: set "section" to "business_context" and "field" to the exact JSONB key (e.g., "productSummary", "pricingPolicy")
- For conversation_style fields: set "section" to "conversation_style" and "field" to the exact JSONB key (e.g., "responseLength", "openingStyle")
- Provide specific, ready-to-use text (not vague advice)
- Include conversation evidence for every suggestion (quote actual messages)
- If the agent is performing well and no improvements are needed, return an empty array []

Respond ONLY with the JSON array (no markdown fences, no explanation):
[
  {
    "id": "sug_01",
    "section": "personality",
    "type": "rewrite",
    "field": "personality",
    "current_text": "current text being replaced",
    "suggested_text": "proposed new text",
    "reason": "human-readable explanation",
    "evidence": ["Conversation #3: customer asked X, agent said Y"],
    "confidence": 0.85
  }
]`;
}

function parseSuggestions(raw: string): Suggestion[] {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (s: any) =>
        s.id && s.section && s.type && s.field && s.suggested_text && s.reason &&
        typeof s.confidence === "number" && s.confidence >= 0.5,
    )
    .slice(0, 10);
}

Deno.serve(
  withErrorBoundary("analyze-copilot-prompt", async (req) => {
    const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const geminiKey = Deno.env.get("GEMINI_API_KEY")!;

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const db = createClient(supabaseUrl, serviceKey);

    const { data: membership } = await db
      .from("team_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!membership?.organization_id) {
      return new Response(JSON.stringify({ error: "No organization" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const orgId = membership.organization_id;

    const { agent_id, conversation_id } = await req.json();
    if (!agent_id) {
      return new Response(JSON.stringify({ error: "agent_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const isSingleConversation = !!conversation_id;

    const { data: agent } = await db
      .from("copilot_agents")
      .select("id, name, business_context, conversation_style, custom_instructions, objective_composite")
      .eq("id", agent_id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (!agent) {
      return new Response(JSON.stringify({ error: "Agent not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limit: 1 full analysis per agent per 12h (skip for single-conversation quick analysis)
    if (!isSingleConversation) {
      const { data: recentAnalysis } = await db
        .from("copilot_prompt_analyses")
        .select("id, created_at")
        .eq("agent_id", agent_id)
        .gte("created_at", new Date(Date.now() - RATE_LIMIT_HOURS * 3600_000).toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentAnalysis) {
        const nextAvailable = new Date(
          new Date(recentAnalysis.created_at).getTime() + RATE_LIMIT_HOURS * 3600_000,
        ).toISOString();
        return new Response(
          JSON.stringify({ error: "rate_limited", next_available_at: nextAvailable }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Fetch conversations: single-conversation mode or full analysis
    let conversations: any[];
    if (isSingleConversation) {
      const { data: conv, error: convError } = await db
        .from("conversations")
        .select("id, state, context, turn_count, created_at")
        .eq("id", conversation_id)
        .eq("agent_id", agent_id)
        .eq("organization_id", orgId)
        .maybeSingle();

      if (convError || !conv) {
        return new Response(JSON.stringify({ error: "Conversation not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      conversations = [conv];
    } else {
      const lookbackDate = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString();
      const { data: convs, error: convError } = await db
        .from("conversations")
        .select("id, state, context, turn_count, created_at")
        .eq("agent_id", agent_id)
        .eq("organization_id", orgId)
        .gte("created_at", lookbackDate)
        .gte("turn_count", 2)
        .order("created_at", { ascending: false })
        .limit(MAX_CONVERSATIONS);

      if (convError) {
        return new Response(JSON.stringify({ error: "Failed to fetch conversations" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!convs || convs.length < MIN_CONVERSATIONS) {
        return new Response(
          JSON.stringify({
            error: "insufficient_data",
            min_required: MIN_CONVERSATIONS,
            found: convs?.length ?? 0,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      conversations = convs;
    }

    // Fetch messages for each conversation
    let totalMessages = 0;
    const conversationsWithMessages = [];
    for (const conv of conversations) {
      const { data: msgs } = await db
        .from("conversation_messages")
        .select("role, content, created_at")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: true })
        .limit(MAX_MESSAGES_PER_CONVERSATION);

      const messages = msgs ?? [];
      totalMessages += messages.length;
      conversationsWithMessages.push({
        id: conv.id,
        state: conv.state,
        turn_count: conv.turn_count,
        messages,
      });
    }

    // Fetch evaluation context (last 30 days)
    let evaluationSection = "";
    const evalLookback = new Date(Date.now() - EVAL_LOOKBACK_DAYS * 86400_000).toISOString();
    const { data: rawEvals } = await db
      .from("copilot_conversation_evaluations")
      .select("score_relevance, score_tone, score_goal_align, score_conciseness, score_overall, weaknesses, user_message, agent_response")
      .eq("agent_id", agent_id)
      .gte("created_at", evalLookback)
      .order("created_at", { ascending: false })
      .limit(200);

    if (rawEvals && rawEvals.length > 0) {
      const evalCtx = buildEvaluationContext(rawEvals);
      evaluationSection = formatEvaluationContext(evalCtx);
    }

    // Build meta-prompt and call Gemini
    const metaPrompt = buildMetaPrompt(agent, conversationsWithMessages, {
      evaluationSection,
      singleConversation: isSingleConversation,
    });

    const geminiResponse = await fetch(
      `${GEMINI_API_URL}/models/${GEMINI_MODEL}:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: metaPrompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 4096,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (!geminiResponse.ok) {
      const errBody = await geminiResponse.text();
      console.error("Gemini API error:", geminiResponse.status, errBody);
      return new Response(JSON.stringify({ error: "Gemini API error" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const geminiData = await geminiResponse.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";

    let suggestions: Suggestion[];
    try {
      suggestions = parseSuggestions(rawText);
    } catch (e) {
      console.error("Failed to parse Gemini response:", e, rawText);
      suggestions = [];
    }

    // Persist analysis
    const { data: analysis, error: insertError } = await db
      .from("copilot_prompt_analyses")
      .insert({
        agent_id,
        organization_id: orgId,
        suggestions,
        conversation_count: conversations.length,
        message_count: totalMessages,
        created_by: user.id,
      })
      .select("id, created_at")
      .single();

    if (insertError) {
      console.error("Failed to persist analysis:", insertError);
    }

    return new Response(
      JSON.stringify({
        analysis_id: analysis?.id ?? null,
        suggestions,
        conversation_count: conversations.length,
        message_count: totalMessages,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }),
);
