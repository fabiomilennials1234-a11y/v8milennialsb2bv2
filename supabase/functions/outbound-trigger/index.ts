import { withSentry } from '../_shared/sentry.ts';
import { getTimeBasedVariables } from '../_shared/time-variables.ts';
/**
 * Outbound Trigger - Disparo Automático de Primeira Mensagem
 *
 * Verifica se existe agente configurado para o lead e dispara
 * a primeira mensagem de acordo com os gatilhos de ativação.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { sendOutboundDispatch } from "../_shared/outbound-sender.ts";
import { logRuntime } from "../_shared/logger.ts";

interface OutboundTriggerPayload {
  lead_id: string;
  organization_id: string;
  source: string;
  tags: string[];
}

interface ActivationTriggers {
  required: {
    tags: string[];
    origins: string[];
    hasPhone: boolean;
    hasEmail: boolean;
  };
  optional: Array<{
    field: string;
    operator: string;
    value: string;
  }>;
}

interface OutboundConfig {
  delayMinutes: number;
  firstMessageTemplate: string;
  availableVariables: string[];
  maxRetries: number;
  retryIntervalMinutes: number;
}

serve(withSentry('outbound-trigger', async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload: OutboundTriggerPayload = await req.json();
    console.log("[outbound-trigger] Received:", JSON.stringify(payload));

    // Criar cliente Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Buscar dados completos do lead
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select(`
        *,
        lead_tags(tag:tags(name)),
        lead_custom_field_values(
          value,
          field:lead_custom_fields(field_name)
        )
      `)
      .eq("id", payload.lead_id)
      .single();

    if (leadError || !lead) {
      console.error("[outbound-trigger] Lead not found:", leadError);
      return new Response(
        JSON.stringify({ error: "Lead not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[outbound-trigger] Lead loaded:", lead.name);

    // Extrair tags do lead
    const leadTags = (lead.lead_tags || []).map((lt: any) => lt.tag?.name).filter(Boolean);
    console.log("[outbound-trigger] Lead tags:", leadTags);

    // Buscar agentes outbound ativos na organização
    const { data: agents, error: agentsError } = await supabase
      .from("copilot_agents")
      .select("*")
      .eq("organization_id", payload.organization_id)
      .eq("is_active", true)
      .in("operation_mode", ["outbound", "hybrid"]);

    if (agentsError || !agents || agents.length === 0) {
      console.log("[outbound-trigger] No outbound agents found");
      return new Response(
        JSON.stringify({ success: false, reason: "No outbound agents configured" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[outbound-trigger] Found", agents.length, "outbound agents");

    // Verificar qual agente deve atuar neste lead
    let matchingAgent = null;
    let triggerReason: any = null;

    for (const agent of agents) {
      const triggers: ActivationTriggers = agent.activation_triggers || {
        required: { tags: [], origins: [], hasPhone: true, hasEmail: false },
        optional: [],
      };

      // Verificar condições obrigatórias
      let allRequiredMet = true;

      // Verificar tags obrigatórias (pelo menos uma deve estar presente)
      if (triggers.required.tags && triggers.required.tags.length > 0) {
        const hasMatchingTag = triggers.required.tags.some((tag: string) => 
          leadTags.includes(tag) || payload.tags.includes(tag)
        );
        if (!hasMatchingTag) {
          console.log("[outbound-trigger] Agent", agent.name, "- No matching tag");
          allRequiredMet = false;
        }
      }

      // Verificar origens aceitas (pelo menos uma deve estar presente)
      if (triggers.required.origins && triggers.required.origins.length > 0) {
        const hasMatchingOrigin = triggers.required.origins.includes(lead.origin) ||
          triggers.required.origins.includes(payload.source.toLowerCase());
        if (!hasMatchingOrigin) {
          console.log("[outbound-trigger] Agent", agent.name, "- Origin not accepted");
          allRequiredMet = false;
        }
      }

      // Verificar telefone
      if (triggers.required.hasPhone && !lead.phone) {
        console.log("[outbound-trigger] Agent", agent.name, "- Lead has no phone");
        allRequiredMet = false;
      }

      // Verificar email
      if (triggers.required.hasEmail && !lead.email) {
        console.log("[outbound-trigger] Agent", agent.name, "- Lead has no email");
        allRequiredMet = false;
      }

      if (!allRequiredMet) {
        continue;
      }

      // Verificar condições opcionais (pelo menos uma deve ser verdadeira, se houver)
      if (triggers.optional && triggers.optional.length > 0) {
        const customFields: Record<string, string> = {};
        (lead.lead_custom_field_values || []).forEach((cfv: any) => {
          if (cfv.field?.field_name) {
            customFields[cfv.field.field_name] = cfv.value;
          }
        });

        const anyOptionalMet = triggers.optional.some((cond) => {
          const fieldValue = customFields[cond.field] || (lead as any)[cond.field] || "";
          return evaluateCondition(fieldValue, cond.operator, cond.value);
        });

        if (!anyOptionalMet) {
          console.log("[outbound-trigger] Agent", agent.name, "- No optional condition met");
          continue;
        }
      }

      // Este agente atende os critérios!
      matchingAgent = agent;
      triggerReason = {
        agent_name: agent.name,
        matched_tags: triggers.required.tags.filter((t: string) => 
          leadTags.includes(t) || payload.tags.includes(t)
        ),
        matched_origin: lead.origin,
        source: payload.source,
      };
      console.log("[outbound-trigger] Agent matched:", agent.name);
      break;
    }

    if (!matchingAgent) {
      console.log("[outbound-trigger] No agent matched the lead criteria");
      return new Response(
        JSON.stringify({ success: false, reason: "No agent matched lead criteria" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verificar se já existe disparo agendado/enviado para este lead
    const { data: existingDispatch } = await supabase
      .from("outbound_dispatch_log")
      .select("id, status")
      .eq("lead_id", payload.lead_id)
      .eq("agent_id", matchingAgent.id)
      .in("status", ["pending", "sent"])
      .maybeSingle();

    if (existingDispatch) {
      console.log("[outbound-trigger] Dispatch already exists:", existingDispatch.status);
      return new Response(
        JSON.stringify({ success: false, reason: "Dispatch already exists", status: existingDispatch.status }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Configurar outbound
    const outboundConfig: OutboundConfig = matchingAgent.outbound_config || {
      delayMinutes: 5,
      firstMessageTemplate: "",
      maxRetries: 3,
      retryIntervalMinutes: 30,
    };

    // Gerar mensagem personalizada
    const customFields: Record<string, string> = {};
    (lead.lead_custom_field_values || []).forEach((cfv: any) => {
      if (cfv.field?.field_name) {
        customFields[cfv.field.field_name] = cfv.value;
      }
    });

    const timeVars = getTimeBasedVariables();
    const templateVars = {
      nome: lead.name || "você",
      empresa: lead.company || "",
      email: lead.email || "",
      telefone: lead.phone || "",
      origem: lead.origin || payload.source,
      interesse: customFields.interesse || customFields.Interesse || "",
      segmento: lead.segment || "",
      campanha: lead.utm_campaign || payload.source,
      saudacao: timeVars.saudacao,
      data: timeVars.data,
      hora: timeVars.hora,
      ...customFields,
    };

    let messageContent: string;

    if (outboundConfig.firstMessageTemplate?.trim()) {
      // Template definido — substituir variáveis
      messageContent = replaceVariables(outboundConfig.firstMessageTemplate, templateVars);
    } else {
      // Sem template — gerar via IA com base no system_prompt do agente
      console.log("[outbound-trigger] No template, generating first message via AI");
      messageContent = await generateFirstMessageWithAI(matchingAgent, lead, templateVars);
    }

    // Calcular horário de disparo
    const scheduledAt = new Date();
    scheduledAt.setMinutes(scheduledAt.getMinutes() + outboundConfig.delayMinutes);

    // Criar registro de disparo
    const { data: dispatch, error: dispatchError } = await supabase
      .from("outbound_dispatch_log")
      .insert({
        organization_id: payload.organization_id,
        agent_id: matchingAgent.id,
        lead_id: payload.lead_id,
        status: "pending",
        message_content: messageContent,
        scheduled_at: scheduledAt.toISOString(),
        trigger_reason: triggerReason,
      })
      .select()
      .single();

    if (dispatchError) {
      console.error("[outbound-trigger] Error creating dispatch:", dispatchError);
      return new Response(
        JSON.stringify({ error: "Failed to create dispatch" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[outbound-trigger] Dispatch created:", dispatch.id, "scheduled for:", scheduledAt);

    // Se delay é 0, enviar imediatamente
    if (outboundConfig.delayMinutes === 0) {
      console.log("[outbound-trigger] Sending immediately (no delay)");
      await sendOutboundDispatch(supabase, dispatch.id, payload.organization_id);
    }

    await logRuntime({
      organizationId: payload.organization_id,
      module: "outbound",
      action: "trigger",
      status: "success",
      entityType: "lead",
      entityId: payload.lead_id,
      payloadSnapshot: { dispatch_id: dispatch.id, agent_name: matchingAgent.name, scheduled_at: scheduledAt.toISOString() },
    });

    return new Response(
      JSON.stringify({
        success: true,
        dispatch_id: dispatch.id,
        agent_name: matchingAgent.name,
        scheduled_at: scheduledAt.toISOString(),
        message_preview: messageContent.substring(0, 100) + "...",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[outbound-trigger] Error:", error);
    await logRuntime({
      module: "outbound",
      action: "trigger",
      status: "error",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));

/**
 * Avalia uma condição de gatilho
 */
function evaluateCondition(fieldValue: string, operator: string, compareValue: string): boolean {
  const numField = parseFloat(fieldValue);
  const numCompare = parseFloat(compareValue);

  switch (operator) {
    case "=":
      return fieldValue.toLowerCase() === compareValue.toLowerCase();
    case "!=":
      return fieldValue.toLowerCase() !== compareValue.toLowerCase();
    case ">":
      return !isNaN(numField) && !isNaN(numCompare) && numField > numCompare;
    case "<":
      return !isNaN(numField) && !isNaN(numCompare) && numField < numCompare;
    case ">=":
      return !isNaN(numField) && !isNaN(numCompare) && numField >= numCompare;
    case "<=":
      return !isNaN(numField) && !isNaN(numCompare) && numField <= numCompare;
    case "contains":
      return fieldValue.toLowerCase().includes(compareValue.toLowerCase());
    case "not_contains":
      return !fieldValue.toLowerCase().includes(compareValue.toLowerCase());
    default:
      return false;
  }
}

// getTimeBasedVariables is now imported from _shared/time-variables.ts

/**
 * Substitui variáveis no template
 */
function replaceVariables(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "gi"), value || "");
  }
  // Limpar variáveis não substituídas
  result = result.replace(/\{[^}]+\}/g, "");
  return result.trim();
}

/**
 * Gera a primeira mensagem de prospecção via IA quando não há template configurado.
 * Usa o system_prompt do agente + contexto do lead para gerar uma abordagem personalizada.
 */
// deno-lint-ignore no-explicit-any
async function generateFirstMessageWithAI(
  agent: any,
  lead: any,
  templateVars: Record<string, string>
): Promise<string> {
  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!openRouterApiKey) {
    console.warn("[outbound-trigger] OPENROUTER_API_KEY not configured, using fallback");
    return `Oi ${templateVars.nome}! Vi que você demonstrou interesse. Posso te ajudar?`;
  }

  // Montar contexto do lead
  const leadContext = [
    templateVars.nome !== "você" ? `Nome: ${templateVars.nome}` : null,
    templateVars.empresa ? `Empresa: ${templateVars.empresa}` : null,
    templateVars.segmento ? `Segmento: ${templateVars.segmento}` : null,
    templateVars.interesse ? `Interesse: ${templateVars.interesse}` : null,
    templateVars.origem ? `Origem: ${templateVars.origem}` : null,
    templateVars.campanha ? `Campanha: ${templateVars.campanha}` : null,
  ].filter(Boolean).join("\n");

  const systemPromptBase = agent.system_prompt || agent.main_objective || "Você é um agente de vendas B2B.";

  const generationPrompt = `Você é um copywriter de vendas B2B via WhatsApp. Sua tarefa é gerar UMA ÚNICA mensagem de primeira abordagem (prospecção outbound) para enviar a um lead.

REGRAS OBRIGATÓRIAS:
- Mensagem CURTA (2-4 frases no máximo), natural, como um humano escreve no WhatsApp
- NÃO use saudação formal ("Prezado", "Caro")
- NÃO use bloco de texto longo
- Use ${templateVars.saudacao} como saudação se apropriado
- Personalize com os dados disponíveis do lead
- Termine com uma pergunta aberta ou convite leve
- NÃO invente dados que não foram fornecidos
- Responda APENAS com a mensagem, sem aspas, sem explicação

CONTEXTO DO AGENTE:
${systemPromptBase.substring(0, 1500)}

DADOS DO LEAD:
${leadContext || "Nenhum dado adicional disponível"}`;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openRouterApiKey}`,
        "HTTP-Referer": Deno.env.get("OPENROUTER_REFERER_URL") || "https://v8millennials.com",
        "X-Title": "V8 Millennials Outbound",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-001",
        messages: [
          { role: "user", content: generationPrompt },
        ],
        temperature: 0.8,
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[outbound-trigger] AI generation failed:", response.status, errorText);
      return `Oi ${templateVars.nome}! Vi que você demonstrou interesse. Posso te ajudar?`;
    }

    const result = await response.json();
    const generatedMessage = result.choices?.[0]?.message?.content?.trim();

    if (generatedMessage && generatedMessage.length > 5) {
      console.log("[outbound-trigger] AI generated message:", generatedMessage.substring(0, 80) + "...");
      return generatedMessage;
    }

    console.warn("[outbound-trigger] AI returned empty message, using fallback");
    return `Oi ${templateVars.nome}! Vi que você demonstrou interesse. Posso te ajudar?`;
  } catch (err) {
    console.error("[outbound-trigger] AI generation error:", err);
    return `Oi ${templateVars.nome}! Vi que você demonstrou interesse. Posso te ajudar?`;
  }
}

