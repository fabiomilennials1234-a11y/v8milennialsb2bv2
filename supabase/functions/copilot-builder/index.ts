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
import { OpenRouterClient, type OpenRouterTool } from "../agent-message/openrouter-client.ts";
import {
  resolveOrgCapabilities,
  describeOrgCapabilities,
} from "../_shared/resolve-org-capabilities.ts";
import { requireAuth, AuthError, authErrorResponse } from "../_shared/user-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUILDER_MODEL =
  Deno.env.get("COPILOT_BUILDER_MODEL") || "anthropic/claude-sonnet-4.6";

interface SessionMessage {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM_PROMPT = `Você é o Copilot Builder do Torque CRM. Você NÃO é um chatbot de entrevista — você CONSTRÓI um agente de IA (Copilot) para WhatsApp, preenchendo os campos dele em tempo real através das suas ferramentas.

Você tem DUAS ferramentas e DEVE usá-las ativamente:
- set_prompt_section(section, text): escreve uma seção do prompt. Seções: personality (persona, tom de voz, como se apresenta), objective (missão, critério de sucesso, limites), flow (fluxo da conversa, etapas, qualificação/desqualificação), products (catálogo/serviços/preços — opcional), instructions (do's and don'ts, guardrails rígidos).
- enable_tool(tool_id, instruction): liga uma capacidade do agente com instrução de quando/como usá-la.

REGRA CENTRAL: assim que você tiver informação suficiente para uma seção ou capacidade, CHAME A FERRAMENTA IMEDIATAMENTE — não espere o fim, não apenas descreva em texto. Preencha progressivamente conforme a conversa avança. Você pode (e deve) emitir VÁRIAS chamadas de ferramenta no mesmo turno, e pode fazer uma pergunta curta junto.

Escreva o texto das seções em português, redigido para o AGENTE (segunda pessoa: "Você é...", "Seu objetivo é..."), aterrado nos fatos reais que o usuário deu — não nos exemplos genéricos. Para enable_tool, escreva instruções concretas e específicas do negócio.

Cubra, sem esquecer nenhum: identidade→personality, negócio/produto→products, objetivo→objective, fluxo+ICP→flow, guardrails→instructions, e ligue as capacidades necessárias (qualificar, preencher campos, agendar, mover card no funil, pausar em atendimento humano, transferir, etc.) conforme o que o usuário pedir.

Quando o usuário disser "monta tudo" / "pode montar" / já tiver dado contexto suficiente, EMITA TODAS as set_prompt_section e enable_tool que faltam de uma vez. Faça no máximo uma pergunta objetiva por turno, e só se faltar algo essencial — prefira preencher com o que já sabe a ficar perguntando.

Use SOMENTE etapas de funil e capacidades reais informadas no contexto da organização — nunca invente. Responda sempre em português brasileiro, tom direto.`;

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

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    let body: {
      organization_id?: string;
      agentId?: string;
      message?: string;
      toolDefs?: Array<{ name: string; description: string; input_schema: unknown }>;
    };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_body" }, 400, corsHeaders);
    }
    const { agentId, message, toolDefs } = body;
    if (!agentId || !message?.trim()) {
      return json({ error: "agentId and message are required" }, 400, corsHeaders);
    }

    // The agent is the org anchor — derive org from it, so this works whether
    // or not the client sends organization_id (older frontends don't).
    const { data: agent } = await admin
      .from("copilot_agents")
      .select("id, organization_id")
      .eq("id", agentId)
      .maybeSingle();
    if (!agent?.organization_id) {
      return json({ error: "agent_not_found" }, 404, corsHeaders);
    }
    const orgId = agent.organization_id as string;

    // Auth via the canonical helper — handles team members AND masters (shadow
    // mode). We pass the agent's org explicitly so a master operating in shadow
    // (who is NOT a team_member of that org) is authorized via the master path.
    // Pass only the agent's org (not body) so the caller can't smuggle a
    // different org_id to authorize against the wrong tenant. Token comes from
    // the Authorization header.
    let userId: string;
    try {
      const ctx = await requireAuth(req, { organizationId: orgId });
      userId = ctx.userId;
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e, corsHeaders);
      throw e;
    }

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

    // Ground the Builder in the org's real state (real funnel stages, whether
    // SZ.Chat / knowledge docs exist) so it never invents and wires only what
    // exists.
    const orgCaps = await resolveOrgCapabilities(admin, orgId, agentId);
    const systemPrompt = `${SYSTEM_PROMPT}\n\n${describeOrgCapabilities(orgCaps)}`;

    // Tool defs come from the client (derived from the capability manifest —
    // the single source — so the model can only target real tools/sections).
    const tools: OpenRouterTool[] | undefined =
      Array.isArray(toolDefs) && toolDefs.length > 0
        ? toolDefs.map((t) => ({
            type: "function" as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.input_schema as OpenRouterTool["function"]["parameters"],
            },
          }))
        : undefined;

    const openRouter = new OpenRouterClient(openRouterKey);
    const completion = await openRouter.chat({
      model: BUILDER_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: message },
      ],
      tools,
      temperature: 0.7,
      // Builder emits multiple large tool_calls (prompt sections + tools) in a
      // single turn; 1024 truncated them mid-JSON, producing invalid/empty
      // actions. Give it room to finish.
      max_tokens: 8192,
    });

    const choice = completion.choices?.[0]?.message;
    const reply = choice?.content?.trim() || "";

    // Map model tool_calls → Builder actions the client applies to the form.
    const actions = (choice?.tool_calls ?? []).map((tc) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
        args = {};
      }
      if (tc.function.name === "enable_tool") {
        return { kind: "enable_tool", toolId: args.tool_id, instruction: args.instruction };
      }
      if (tc.function.name === "set_prompt_section") {
        return { kind: "set_prompt_section", section: args.section, text: args.text };
      }
      return { kind: tc.function.name, ...args };
    });

    // If the model only emitted tool_calls (no prose), keep a short marker so
    // the transcript stays coherent across turns.
    const assistantText =
      reply || (actions.length > 0 ? "(atualizei os campos do agente)" : "");

    const nextMessages: SessionMessage[] = [
      ...history,
      { role: "user", content: message },
      { role: "assistant", content: assistantText },
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
      triggeredBy: userId,
      tokens: {
        prompt: completion.usage?.prompt_tokens,
        completion: completion.usage?.completion_tokens,
        model: BUILDER_MODEL,
      },
    });

    return json({ reply: assistantText, actions, sessionId }, 200, corsHeaders);
  }),
);
