/**
 * Semi-Automatic Dispatch - Disparo de Templates em Lote
 *
 * Processa batches agendados de campanhas semi-automáticas:
 * 1. Buscar batches com scheduled_at <= NOW() e status = 'scheduled'
 * 2. Para cada lead: substituir variáveis no template
 * 3. Enviar via Evolution API (respeitando rate limit)
 * 4. Registrar no outbound_dispatch_log
 * 5. Atualizar batch status
 *
 * Pode ser executado:
 * - Via pg_cron (a cada minuto)
 * - Manualmente via API
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL") || "";
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") || "";

// Delay aleatório entre mensagens para evitar detecção de disparo em massa
const DEFAULT_DELAY_MIN_MS = 30000;  // 30 segundos mínimo
const DEFAULT_DELAY_MAX_MS = 90000;  // 90 segundos (1.5 minutos) máximo

interface LeadFilter {
  stage_ids?: string[];
  sdr_ids?: string[];
  has_phone?: boolean;
  exclude_contacted?: boolean;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Verificar se é uma requisição manual com batch_id específico
    let specificBatchId: string | null = null;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        specificBatchId = body.batch_id || null;
      } catch {
        // Ignora se não houver body
      }
    }

    // Buscar batches pendentes (scheduled_at <= NOW() e status = 'scheduled')
    let batchQuery = supabase
      .from("campaign_dispatch_batches")
      .select(`
        *,
        template:campaign_templates(id, name, content, message_type, audio_url, available_variables),
        campanha:campanhas(id, name, organization_id)
      `)
      .eq("status", "scheduled")
      .lte("scheduled_at", new Date().toISOString());

    if (specificBatchId) {
      batchQuery = batchQuery.eq("id", specificBatchId);
    }

    const { data: batches, error: batchError } = await batchQuery;

    if (batchError) {
      console.error("[semi-automatic-dispatch] Error fetching batches:", batchError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch batches", details: batchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!batches || batches.length === 0) {
      console.log("[semi-automatic-dispatch] No pending batches found");
      return new Response(
        JSON.stringify({ success: true, message: "No pending batches", processed: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[semi-automatic-dispatch] Processing", batches.length, "batch(es)");

    const results = [];

    for (const batch of batches) {
      try {
        const result = await processBatch(supabase, batch);
        results.push({ batch_id: batch.id, ...result });
      } catch (error) {
        console.error("[semi-automatic-dispatch] Error processing batch:", batch.id, error);
        results.push({
          batch_id: batch.id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });

        // Marcar batch como falhou
        await supabase
          .from("campaign_dispatch_batches")
          .update({ status: "failed" })
          .eq("id", batch.id);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[semi-automatic-dispatch] Error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Processa um batch de disparo
 */
async function processBatch(
  supabase: ReturnType<typeof createClient>,
  batch: any
): Promise<{ success: boolean; sent: number; failed: number; skipped: number }> {
  const organizationId = batch.campanha?.organization_id || batch.organization_id;
  const template = batch.template;
  const filter: LeadFilter = batch.lead_filter || {};

  console.log("[semi-automatic-dispatch] Processing batch:", batch.id, "template:", template?.name);

  // Marcar batch como processando
  await supabase
    .from("campaign_dispatch_batches")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .eq("id", batch.id);

  // Buscar instância WhatsApp ativa da organização
  const { data: whatsappInstance } = await supabase
    .from("whatsapp_instances")
    .select("id, instance_name")
    .eq("organization_id", organizationId)
    .eq("status", "open")
    .limit(1)
    .single();

  if (!whatsappInstance) {
    console.error("[semi-automatic-dispatch] No active WhatsApp instance");
    await supabase
      .from("campaign_dispatch_batches")
      .update({ status: "failed" })
      .eq("id", batch.id);
    throw new Error("No active WhatsApp instance for organization");
  }

  // Buscar rate limit da organização
  const { data: org } = await supabase
    .from("organizations")
    .select("whatsapp_rate_limit")
    .eq("id", organizationId)
    .single();

  const rateLimit = org?.whatsapp_rate_limit || {
    max_per_hour: 100,
    max_per_day: 500,
    delay_min_ms: DEFAULT_DELAY_MIN_MS,
    delay_max_ms: DEFAULT_DELAY_MAX_MS,
  };

  // Buscar leads da campanha com filtros
  let leadsQuery = supabase
    .from("campanha_leads")
    .select(`
      id,
      lead_id,
      stage_id,
      sdr_id,
      lead:leads(id, name, company, email, phone, origin, segment)
    `)
    .eq("campanha_id", batch.campanha_id);

  // Aplicar filtros
  if (filter.stage_ids && filter.stage_ids.length > 0) {
    leadsQuery = leadsQuery.in("stage_id", filter.stage_ids);
  }

  if (filter.sdr_ids && filter.sdr_ids.length > 0) {
    leadsQuery = leadsQuery.in("sdr_id", filter.sdr_ids);
  }

  const { data: campanhaLeads, error: leadsError } = await leadsQuery;

  if (leadsError) {
    console.error("[semi-automatic-dispatch] Error fetching leads:", leadsError);
    throw new Error("Failed to fetch campaign leads");
  }

  // Filtrar leads com telefone se necessário
  let filteredLeads = campanhaLeads || [];

  if (filter.has_phone !== false) {
    filteredLeads = filteredLeads.filter((cl: any) => cl.lead?.phone);
  }

  // Filtrar leads já contatados nesta campanha se necessário
  if (filter.exclude_contacted) {
    const { data: contactedLeadIds } = await supabase
      .from("outbound_dispatch_log")
      .select("lead_id")
      .eq("campanha_id", batch.campanha_id)
      .eq("status", "sent");

    const contactedSet = new Set((contactedLeadIds || []).map((l: any) => l.lead_id));
    filteredLeads = filteredLeads.filter((cl: any) => !contactedSet.has(cl.lead_id));
  }

  console.log("[semi-automatic-dispatch] Found", filteredLeads.length, "leads to dispatch");

  // Verificar rate limit
  const { data: rateLimitCheck } = await supabase.rpc("check_whatsapp_rate_limit", {
    p_organization_id: organizationId,
    p_instance_id: whatsappInstance.id,
  });

  if (rateLimitCheck && !rateLimitCheck[0]?.can_send) {
    console.log("[semi-automatic-dispatch] Rate limit exceeded, rescheduling batch");
    // Reagendar para próxima hora
    const nextSchedule = new Date();
    nextSchedule.setHours(nextSchedule.getHours() + 1, 0, 0, 0);

    await supabase
      .from("campaign_dispatch_batches")
      .update({
        status: "scheduled",
        scheduled_at: nextSchedule.toISOString(),
        started_at: null,
      })
      .eq("id", batch.id);

    return { success: false, sent: 0, failed: 0, skipped: filteredLeads.length };
  }

  // Processar leads
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const campanhaLead of filteredLeads) {
    const lead = campanhaLead.lead;

    if (!lead || !lead.phone) {
      skipped++;
      continue;
    }

    try {
      const isAudioTemplate =
        template.message_type === "audio" &&
        template.audio_url &&
        String(template.audio_url).trim().length > 0;

      let sendResult: { success: boolean; messageId?: string; error?: string };

      if (isAudioTemplate) {
        sendResult = await sendWhatsAppAudio(
          whatsappInstance.instance_name,
          lead.phone,
          template.audio_url
        );
      } else {
        const messageContent = replaceVariables(template.content || "", {
          nome: lead.name || "você",
          empresa: lead.company || "",
          email: lead.email || "",
          telefone: lead.phone || "",
          origem: lead.origin || "",
          segmento: lead.segment || "",
          faturamento: "",
        });
        sendResult = await sendWhatsAppMessage(
          whatsappInstance.instance_name,
          lead.phone,
          messageContent
        );
      }

      const messageContent = isAudioTemplate ? "[Áudio]" : replaceVariables(template.content || "", {
        nome: lead.name || "você",
        empresa: lead.company || "",
        email: lead.email || "",
        telefone: lead.phone || "",
        origem: lead.origin || "",
        segmento: lead.segment || "",
        faturamento: "",
      });

      if (sendResult.success) {
        // Registrar no dispatch log
        await supabase.from("outbound_dispatch_log").insert({
          organization_id: organizationId,
          lead_id: lead.id,
          campanha_id: batch.campanha_id,
          template_id: template.id,
          batch_id: batch.id,
          status: "sent",
          message_content: messageContent,
          message_id: sendResult.messageId,
          sent_at: new Date().toISOString(),
        });

        // Incrementar rate limit
        await supabase.rpc("increment_whatsapp_rate_limit", {
          p_organization_id: organizationId,
          p_instance_id: whatsappInstance.id,
        });

        // Incrementar times_used do template
        await supabase.rpc("increment", {
          table_name: "campaign_templates",
          row_id: template.id,
          column_name: "times_used",
        }).catch(() => {
          // Ignora se a função não existir
        });

        sent++;
        console.log("[semi-automatic-dispatch] Sent to:", lead.name, lead.phone);
      } else {
        // Registrar falha
        await supabase.from("outbound_dispatch_log").insert({
          organization_id: organizationId,
          lead_id: lead.id,
          campanha_id: batch.campanha_id,
          template_id: template.id,
          batch_id: batch.id,
          status: "failed",
          message_content: messageContent,
          error_message: sendResult.error,
          created_at: new Date().toISOString(),
        });

        failed++;
        console.error("[semi-automatic-dispatch] Failed to send to:", lead.name, sendResult.error);
      }

      // Delay aleatório entre mensagens para evitar detecção de disparo em massa
      const minDelay = rateLimit.delay_min_ms || DEFAULT_DELAY_MIN_MS;
      const maxDelay = rateLimit.delay_max_ms || DEFAULT_DELAY_MAX_MS;
      await randomDelay(minDelay, maxDelay);
    } catch (error) {
      console.error("[semi-automatic-dispatch] Error processing lead:", lead.id, error);
      failed++;
    }
  }

  // Atualizar batch como concluído
  await supabase
    .from("campaign_dispatch_batches")
    .update({
      status: "completed",
      sent_count: sent,
      failed_count: failed,
      completed_at: new Date().toISOString(),
    })
    .eq("id", batch.id);

  console.log("[semi-automatic-dispatch] Batch completed:", {
    batch_id: batch.id,
    sent,
    failed,
    skipped,
  });

  return { success: true, sent, failed, skipped };
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
 * Envia mensagem de texto via Evolution API
 */
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
      headers: {
        "Content-Type": "application/json",
        apikey: EVOLUTION_API_KEY,
      },
      body: JSON.stringify({ number: phone, text: message }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }
    const result = await response.json();
    return { success: true, messageId: result.key?.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Envia áudio via Evolution API (sendWhatsAppAudio)
 * audioUrl: URL pública do áudio (ex.: Supabase Storage public URL)
 */
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

    const response = await fetch(
      `${EVOLUTION_API_URL}/message/sendWhatsAppAudio/${instanceName}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: EVOLUTION_API_KEY,
        },
        body: JSON.stringify({
          number: phone,
          audio: audioUrl,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }
    const result = await response.json();
    return { success: true, messageId: result.key?.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Gera um delay aleatório entre min e max milissegundos
 * Isso ajuda a evitar detecção de disparo em massa pelo WhatsApp
 */
function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delayMs = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  console.log(`[semi-automatic-dispatch] Aguardando ${(delayMs / 1000).toFixed(1)}s antes da próxima mensagem`);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
