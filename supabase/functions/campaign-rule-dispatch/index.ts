/**
 * Campaign Rule Dispatch - Processa fila scheduled_campaign_messages
 *
 * Disparos agendados pelas regras de campanha (lead criado ou movido para etapa):
 * 1. Buscar scheduled_campaign_messages com status = 'scheduled' e scheduled_at <= NOW()
 * 2. Para cada linha: obter lead, template, instância (da linha ou fallback org)
 * 3. Enviar via Evolution API (substituir variáveis, texto/áudio)
 * 4. Atualizar scheduled_campaign_messages e outbound_dispatch_log
 * 5. Respeitar rate limit
 *
 * Pode ser executado via pg_cron (a cada minuto) ou manualmente via API.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL") || "";
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") || "";

const DEFAULT_DELAY_MIN_MS = 30000;
const DEFAULT_DELAY_MAX_MS = 90000;
const BATCH_SIZE = 50;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { data: rows, error: fetchError } = await supabase
      .from("scheduled_campaign_messages")
      .select(`
        id,
        campanha_id,
        rule_id,
        campanha_lead_id,
        lead_id,
        template_id,
        whatsapp_instance_id,
        scheduled_at,
        campanhas(id, organization_id),
        leads(id, name, company, phone, email, origin, segment),
        campaign_templates(id, name, content, message_type, audio_url, available_variables)
      `)
      .eq("status", "scheduled")
      .lte("scheduled_at", new Date().toISOString())
      .limit(BATCH_SIZE);

    if (fetchError) {
      console.error("[campaign-rule-dispatch] Error fetching queue:", fetchError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch queue", details: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!rows || rows.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No pending messages", processed: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[campaign-rule-dispatch] Processing", rows.length, "message(s)");

    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      const campanha = (row as any).campanhas as { id: string; organization_id: string } | null;
      const lead = (row as any).leads as { id: string; name?: string; company?: string; phone?: string; email?: string; origin?: string; segment?: string } | null;
      const template = (row as any).campaign_templates as { id: string; name?: string; content?: string; message_type?: string; audio_url?: string } | null;

      if (!campanha?.organization_id || !lead || !template) {
        await markFailed(supabase, row.id, "Missing campanha, lead or template");
        failed++;
        continue;
      }

      if (!lead.phone) {
        await markFailed(supabase, row.id, "Lead has no phone");
        failed++;
        continue;
      }

      let instance: { id: string; instance_name: string } | null = null;
      if (row.whatsapp_instance_id) {
        const { data: inst } = await supabase
          .from("whatsapp_instances")
          .select("id, instance_name")
          .eq("id", row.whatsapp_instance_id)
          .single();
        instance = inst ? { id: inst.id, instance_name: inst.instance_name } : null;
      }
      if (!instance) {
        const { data: instList } = await supabase
          .from("whatsapp_instances")
          .select("id, instance_name")
          .eq("organization_id", campanha.organization_id)
          .or("status.eq.open,status.eq.connected")
          .limit(1);
        instance = instList?.[0] ?? null;
      }

      if (!instance) {
        await markFailed(supabase, row.id, "No active WhatsApp instance");
        failed++;
        continue;
      }

      const { data: rateCheck } = await supabase.rpc("check_whatsapp_rate_limit", {
        p_organization_id: campanha.organization_id,
        p_instance_id: instance.id,
      });
      if (rateCheck?.[0] && !rateCheck[0].can_send) {
        console.log("[campaign-rule-dispatch] Rate limit exceeded, skipping");
        break;
      }

      const isAudio = template.message_type === "audio" && template.audio_url && String(template.audio_url).trim().length > 0;
      const timeVars = getTimeBasedVariables();
      const messageContent = isAudio ? "[Áudio]" : replaceVariables(template.content || "", {
        nome: lead.name || "você",
        empresa: lead.company || "",
        email: lead.email || "",
        telefone: lead.phone || "",
        origem: lead.origin || "",
        segmento: lead.segment || "",
        faturamento: "",
        saudacao: timeVars.saudacao,
        data: timeVars.data,
        hora: timeVars.hora,
      });

      let sendResult: { success: boolean; messageId?: string; error?: string };
      if (isAudio) {
        sendResult = await sendWhatsAppAudio(instance.instance_name, lead.phone, template.audio_url!);
      } else {
        sendResult = await sendWhatsAppMessage(instance.instance_name, lead.phone, messageContent);
      }

      if (sendResult.success) {
        await supabase.from("scheduled_campaign_messages").update({
          status: "sent",
          sent_at: new Date().toISOString(),
          error_message: null,
        }).eq("id", row.id);

        await supabase.from("outbound_dispatch_log").insert({
          organization_id: campanha.organization_id,
          lead_id: lead.id,
          campanha_id: row.campanha_id,
          template_id: row.template_id,
          status: "sent",
          message_content: messageContent,
          message_id: sendResult.messageId,
          sent_at: new Date().toISOString(),
        });

        await supabase.rpc("increment_whatsapp_rate_limit", {
          p_organization_id: campanha.organization_id,
          p_instance_id: instance.id,
        });

        await supabase.rpc("increment", {
          table_name: "campaign_templates",
          row_id: template.id,
          column_name: "times_used",
        }).catch(() => {});

        sent++;
        console.log("[campaign-rule-dispatch] Sent to:", lead.name, lead.phone);
      } else {
        await markFailed(supabase, row.id, sendResult.error ?? "Send failed");

        await supabase.from("outbound_dispatch_log").insert({
          organization_id: campanha.organization_id,
          lead_id: lead.id,
          campanha_id: row.campanha_id,
          template_id: row.template_id,
          status: "failed",
          message_content: messageContent,
          error_message: sendResult.error,
        });

        failed++;
      }

      const { data: org } = await supabase.from("organizations").select("whatsapp_rate_limit").eq("id", campanha.organization_id).single();
      const rateLimit = org?.whatsapp_rate_limit || {};
      const minDelay = rateLimit.delay_min_ms ?? DEFAULT_DELAY_MIN_MS;
      const maxDelay = rateLimit.delay_max_ms ?? DEFAULT_DELAY_MAX_MS;
      await randomDelay(minDelay, maxDelay);
    }

    return new Response(
      JSON.stringify({ success: true, processed: rows.length, sent, failed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[campaign-rule-dispatch] Error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function markFailed(supabase: ReturnType<typeof createClient>, id: string, errorMessage: string) {
  await supabase.from("scheduled_campaign_messages").update({
    status: "failed",
    error_message: errorMessage,
  }).eq("id", id);
}

function getTimeBasedVariables(now: Date = new Date()): { saudacao: string; data: string; hora: string } {
  const tz = "America/Sao_Paulo";
  const hour = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).format(now),
    10
  );
  let saudacao = "bom dia";
  if (hour >= 12 && hour < 18) saudacao = "boa tarde";
  else if (hour >= 18 || hour < 5) saudacao = "boa noite";
  const data = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric" }).format(now);
  const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  return { saudacao, data, hora };
}

function replaceVariables(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "gi"), value || "");
  }
  result = result.replace(/\{[^}]+\}/g, "");
  return result.trim();
}

async function sendWhatsAppMessage(
  instanceName: string,
  phoneNumber: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    return { success: false, error: "Evolution API not configured" };
  }
  try {
    let phone = phoneNumber.replace(/\D/g, "");
    if (!phone.startsWith("55")) phone = "55" + phone;
    const response = await fetch(`${EVOLUTION_API_URL}/message/sendText/${instanceName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY },
      body: JSON.stringify({ number: phone, text: message }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }
    const result = await response.json();
    return { success: true, messageId: result.key?.id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function sendWhatsAppAudio(
  instanceName: string,
  phoneNumber: string,
  audioUrl: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    return { success: false, error: "Evolution API not configured" };
  }
  try {
    let phone = phoneNumber.replace(/\D/g, "");
    if (!phone.startsWith("55")) phone = "55" + phone;
    const response = await fetch(`${EVOLUTION_API_URL}/message/sendWhatsAppAudio/${instanceName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY },
      body: JSON.stringify({ number: phone, audio: audioUrl }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }
    const result = await response.json();
    return { success: true, messageId: result.key?.id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delayMs = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
