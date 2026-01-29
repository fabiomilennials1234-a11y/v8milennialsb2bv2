/**
 * Outbound Trigger - Disparo Automático de Primeira Mensagem
 * 
 * Verifica se existe agente configurado para o lead e dispara
 * a primeira mensagem de acordo com os gatilhos de ativação.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

serve(async (req) => {
  // CORS
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
      firstMessageTemplate: "Oi {nome}! 👋 Vi que você demonstrou interesse. Posso te ajudar?",
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

    const messageContent = replaceVariables(outboundConfig.firstMessageTemplate, {
      nome: lead.name || "você",
      empresa: lead.company || "",
      email: lead.email || "",
      telefone: lead.phone || "",
      origem: lead.origin || payload.source,
      interesse: customFields.interesse || customFields.Interesse || "",
      segmento: lead.segment || "",
      campanha: lead.utm_campaign || payload.source,
      ...customFields,
    });

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
      await sendOutboundMessage(supabase, dispatch.id, payload.organization_id);
    }

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
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

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
 * Envia a mensagem de outbound via WhatsApp
 */
async function sendOutboundMessage(supabase: any, dispatchId: string, organizationId: string) {
  try {
    // Buscar dispatch com dados relacionados
    const { data: dispatch, error: fetchError } = await supabase
      .from("outbound_dispatch_log")
      .select(`
        *,
        lead:leads(phone, name),
        agent:copilot_agents(whatsapp_instance_id)
      `)
      .eq("id", dispatchId)
      .single();

    if (fetchError || !dispatch) {
      console.error("[outbound-trigger] Dispatch not found:", fetchError);
      return;
    }

    if (!dispatch.lead?.phone) {
      console.error("[outbound-trigger] Lead has no phone");
      await supabase
        .from("outbound_dispatch_log")
        .update({ status: "failed", error_message: "Lead has no phone" })
        .eq("id", dispatchId);
      return;
    }

    // Buscar instância WhatsApp
    let instanceName = null;
    
    if (dispatch.agent?.whatsapp_instance_id) {
      const { data: instance } = await supabase
        .from("whatsapp_instances")
        .select("instance_name")
        .eq("id", dispatch.agent.whatsapp_instance_id)
        .single();
      instanceName = instance?.instance_name;
    }

    if (!instanceName) {
      // Buscar primeira instância ativa da organização
      const { data: instance } = await supabase
        .from("whatsapp_instances")
        .select("instance_name")
        .eq("organization_id", organizationId)
        .eq("status", "open")
        .limit(1)
        .single();
      instanceName = instance?.instance_name;
    }

    if (!instanceName) {
      console.error("[outbound-trigger] No WhatsApp instance found");
      await supabase
        .from("outbound_dispatch_log")
        .update({ status: "failed", error_message: "No WhatsApp instance available" })
        .eq("id", dispatchId);
      return;
    }

    // Enviar mensagem via Evolution API
    const evolutionUrl = Deno.env.get("EVOLUTION_API_URL");
    const evolutionKey = Deno.env.get("EVOLUTION_API_KEY");

    if (!evolutionUrl || !evolutionKey) {
      console.error("[outbound-trigger] Evolution API not configured");
      await supabase
        .from("outbound_dispatch_log")
        .update({ status: "failed", error_message: "Evolution API not configured" })
        .eq("id", dispatchId);
      return;
    }

    // Formatar telefone
    let phone = dispatch.lead.phone.replace(/\D/g, "");
    if (!phone.startsWith("55")) {
      phone = "55" + phone;
    }

    const sendResponse = await fetch(`${evolutionUrl}/message/sendText/${instanceName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": evolutionKey,
      },
      body: JSON.stringify({
        number: phone,
        text: dispatch.message_content,
      }),
    });

    if (!sendResponse.ok) {
      const errorText = await sendResponse.text();
      console.error("[outbound-trigger] Failed to send message:", errorText);
      await supabase
        .from("outbound_dispatch_log")
        .update({ status: "failed", error_message: errorText })
        .eq("id", dispatchId);
      return;
    }

    const sendResult = await sendResponse.json();
    console.log("[outbound-trigger] Message sent successfully:", sendResult);

    // Atualizar dispatch como enviado
    await supabase
      .from("outbound_dispatch_log")
      .update({
        status: "sent",
        message_id: sendResult.key?.id,
        sent_at: new Date().toISOString(),
      })
      .eq("id", dispatchId);

    // Atualizar estágio do lead para "abordado"
    await supabase
      .from("leads")
      .update({ pipe_whatsapp: "abordado" })
      .eq("id", dispatch.lead_id);

    // Salvar mensagem no histórico de conversa
    await supabase
      .from("whatsapp_messages")
      .insert({
        organization_id: organizationId,
        instance_name: instanceName,
        remote_jid: phone + "@s.whatsapp.net",
        from_me: true,
        message_type: "conversation",
        content: dispatch.message_content,
        timestamp: new Date().toISOString(),
        status: "sent",
      });

    console.log("[outbound-trigger] Outbound message sent to:", dispatch.lead.name);

  } catch (error) {
    console.error("[outbound-trigger] Error sending message:", error);
    await supabase
      .from("outbound_dispatch_log")
      .update({ status: "failed", error_message: String(error) })
      .eq("id", dispatchId);
  }
}
