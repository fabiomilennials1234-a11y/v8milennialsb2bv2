/**
 * copilot-builder
 *
 * Backend turn of the Copilot Builder (PRD #544 / Slice #545). An authenticated
 * org member sends a message; the Builder (Claude Sonnet via OpenRouter) replies
 * in Portuguese and the exchange is persisted to the agent's Builder Session.
 *
 * Phase 1 is gated to orgs with feature_flags.copilot_builder = true
 * (Milennials only) — enforced here server-side, not trusting the client.
 *
 * This slice is the skeleton round-trip: no tool-calls / live-fill yet — that
 * arrives when the capability manifest + form reducer are wired in (#546/#547).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withSentry } from "../_shared/sentry.ts";
import { logRuntime } from "../_shared/logger.ts";
import { OpenRouterClient } from "../agent-message/openrouter-client.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const BUILDER_MODEL =
  Deno.env.get("COPILOT_BUILDER_MODEL") || "anthropic/claude-sonnet-4.6";

interface SessionMessage {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM_PROMPT = `Você é o Copilot Builder do Torque CRM — um assistente que entrevista o usuário e o ajuda a construir um agente de IA (Copilot) para WhatsApp do zero.

Conduza uma entrevista guiada, cobrindo nesta ordem, sem deixar nenhum tópico para trás: identidade do agente, negócio/produto da empresa, perfil de cliente ideal (ICP), objetivo e critério de sucesso, fluxo de atendimento, ferramentas necessárias, regras e guardrails, e funil/etapas.

Dentro de cada tópico, aprofunde com perguntas de follow-up naturais e pule o que o usuário já deixou claro. Faça UMA pergunta objetiva por vez. Responda sempre em português brasileiro, tom direto e profissional. Não invente capacidades que não existem no sistema.`;

function json(body: unknown, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

Deno.serve(
  withSentry("copilot-builder", async (req) => {
    const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401, corsHeaders);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "unauthenticated" }, 401, corsHeaders);

    // Caller's org.
    const { data: member } = await admin
      .from("team_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .maybeSingle();
    const orgId = member?.organization_id;
    if (!orgId) return json({ error: "no_organization" }, 403, corsHeaders);

    // Phase-1 feature gate — server-side, never trust the client.
    const { data: org } = await admin
      .from("organizations")
      .select("feature_flags")
      .eq("id", orgId)
      .maybeSingle();
    const flags = (org?.feature_flags ?? {}) as Record<string, unknown>;
    if (flags.copilot_builder !== true) {
      return json({ error: "feature_disabled" }, 403, corsHeaders);
    }

    let body: { agentId?: string; message?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_body" }, 400, corsHeaders);
    }
    const { agentId, message } = body;
    if (!agentId || !message?.trim()) {
      return json({ error: "agentId and message are required" }, 400, corsHeaders);
    }

    // The draft agent must exist and belong to the caller's org.
    const { data: agent } = await admin
      .from("copilot_agents")
      .select("id, organization_id")
      .eq("id", agentId)
      .maybeSingle();
    if (!agent || agent.organization_id !== orgId) {
      return json({ error: "agent_not_found" }, 404, corsHeaders);
    }

    // Load or create the agent's Builder Session.
    const { data: existing } = await admin
      .from("builder_sessions")
      .select("id, messages")
      .eq("agent_id", agentId)
      .maybeSingle();

    const history: SessionMessage[] = Array.isArray(existing?.messages)
      ? (existing!.messages as SessionMessage[])
      : [];

    const openRouterKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!openRouterKey) return json({ error: "OPENROUTER_API_KEY not set" }, 500, corsHeaders);

    const openRouter = new OpenRouterClient(openRouterKey);
    const completion = await openRouter.chat({
      model: BUILDER_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: message },
      ],
      temperature: 0.7,
      max_tokens: 1024,
    });

    const reply = completion.choices?.[0]?.message?.content?.trim() || "";

    const nextMessages: SessionMessage[] = [
      ...history,
      { role: "user", content: message },
      { role: "assistant", content: reply },
    ];

    let sessionId = existing?.id;
    if (existing) {
      await admin
        .from("builder_sessions")
        .update({ messages: nextMessages, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      const { data: created } = await admin
        .from("builder_sessions")
        .insert({ organization_id: orgId, agent_id: agentId, messages: nextMessages })
        .select("id")
        .single();
      sessionId = created?.id;
    }

    await logRuntime({
      organizationId: orgId,
      module: "copilot-builder",
      action: "turn",
      status: "success",
      entityType: "copilot_agent",
      entityId: agentId,
      triggeredBy: user.id,
      tokens: {
        prompt: completion.usage?.prompt_tokens,
        completion: completion.usage?.completion_tokens,
        model: BUILDER_MODEL,
      },
    });

    return json({ reply, sessionId }, 200, corsHeaders);
  }),
);
