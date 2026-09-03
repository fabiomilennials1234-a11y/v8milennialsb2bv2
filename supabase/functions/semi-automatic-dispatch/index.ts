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
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from '../_shared/error-boundary.ts';
import { logRuntime } from "../_shared/logger.ts";
import { persistOutboundMessage } from "../_shared/action-handlers/whatsapp-helpers.ts";
import { getTimeBasedVariables } from '../_shared/time-variables.ts';
import { personalizationFirstName } from "../_shared/lead-name.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Delay aleatório entre mensagens para evitar detecção de disparo em massa
const DEFAULT_DELAY_MIN_MS = 30000;  // 30 segundos mínimo
const DEFAULT_DELAY_MAX_MS = 90000;  // 90 segundos (1.5 minutos) máximo

interface LeadFilter {
  stage_ids?: string[];
  sdr_ids?: string[];
  has_phone?: boolean;
  exclude_contacted?: boolean;
}

Deno.serve(withErrorBoundary('semi-automatic-dispatch', async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));

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
        campanha:campanhas(id, name, organization_id, whatsapp_instance_id)
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

    await logRuntime({
      module: "campaign",
      action: "semi_auto_dispatch",
      status: "success",
      payloadSnapshot: { processed: results.length, results },
    });

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

    await logRuntime({
      module: "campaign",
      action: "semi_auto_dispatch",
      status: "error",
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));

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

  // Instância WhatsApp: usar a vinculada à campanha se existir; senão primeira ativa da organização
  //
  // Etapa B / arquitetura: semi-automatic-dispatch é um broadcaster por campanha
  // (admin escolhe uma única instância e dispara para N leads). Mantém o
  // comportamento legado mesmo com flag user_write_instance_strict ON — paralelo
  // a mass-send-create. O vínculo user-instância é enforced em fluxos
  // 1:1 (outbound copilot, followup copilot, pipe rules, scheduled user msgs,
  // workflow actions, ai-action send-document). Cobertura aqui exigiria
  // reagrupar leads por responsável → backlog Etapa F.
  let whatsappInstance: { id: string; instance_name: string } | null = null;
  const campaignInstanceId = batch.campanha?.whatsapp_instance_id;

  if (campaignInstanceId) {
    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("id, instance_name")
      .eq("id", campaignInstanceId)
      .single();
    whatsappInstance = inst ? { id: inst.id, instance_name: inst.instance_name } : null;
  }

  if (!whatsappInstance) {
    const { data: instList } = await supabase
      .from("whatsapp_instances")
      .select("id, instance_name")
      .eq("organization_id", organizationId)
      // Meta isolation (cert Rule 2): never auto-pick a Meta number for a legacy send.
      .in("provider", ["uazapi", "evolution"])
      .or("status.eq.open,status.eq.connected")
      .limit(1);
    whatsappInstance = instList?.[0] ?? null;
  }

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

  // Throttle/reputação: Send Governor (#1156) governa TODO envio via
  // sendTextViaInstance->governSend. O pré-check check_whatsapp_rate_limit
  // (contador hora/dia) chamava RPC inexistente em prod — data null -> a
  // condição `rateLimitCheck && ...` era falsa -> NUNCA reagendava, sempre
  // seguia. Ou seja o reschedule-de-batch já era morto na prática. Removido
  // (Lanterna #diag; confirmado vs #1243); o governor gateia cada send.

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
          supabase,
          whatsappInstance,
          lead.phone,
          template.audio_url
        );
      } else {
        const timeVars = getTimeBasedVariables();
        const messageContent = replaceVariables(template.content || "", {
          nome: lead.name || "você",
          primeiro_nome: personalizationFirstName(lead.name) || "você",
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
        sendResult = await sendWhatsAppMessage(
          supabase,
          whatsappInstance,
          lead.phone,
          messageContent
        );
      }

      const timeVarsForLog = getTimeBasedVariables();
      const messageContent = isAudioTemplate ? "[Áudio]" : replaceVariables(template.content || "", {
        nome: lead.name || "você",
        primeiro_nome: personalizationFirstName(lead.name) || "você",
        empresa: lead.company || "",
        email: lead.email || "",
        telefone: lead.phone || "",
        origem: lead.origin || "",
        segmento: lead.segment || "",
        faturamento: "",
        saudacao: timeVarsForLog.saudacao,
        data: timeVarsForLog.data,
        hora: timeVarsForLog.hora,
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

        // `outbound_dispatch_log` acima é registro da CAMPANHA; o chat lê
        // `whatsapp_messages`. Sem esta linha o disparo some da conversa do lead
        // e o eco `fromMe` volta rotulado `manual`, fazendo o
        // `trg_human_pause_on_manual_send` pausar o Copilot de cada lead do lote
        // — logo depois de a campanha ter falado com ele.
        await persistOutboundMessage(supabase, {
          organizationId,
          instanceId: whatsappInstance.id,
          providerMessageId: sendResult.messageId,
          phone: lead.phone,
          messageType: isAudioTemplate ? "audio" : "conversation",
          content: messageContent,
          leadId: lead.id,
          sentSource: "workflow",
          fallbackIdPrefix: "semiauto",
        });

        // increment_whatsapp_rate_limit removido: RPC ausente em prod, só
        // alimentava o contador do check redundante. Governor não usa.

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

// Provider-agnostic shims via whatsapp-dispatch adapter.
import {
  sendTextViaInstance,
  sendAudioViaInstance,
} from "../_shared/whatsapp-dispatch.ts";

async function sendWhatsAppMessage(
  supabase: any,
  instance: any,
  phoneNumber: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  return await sendTextViaInstance(supabase, instance, phoneNumber, message, {
    trackSource: "semi-automatic-dispatch",
  });
}

async function sendWhatsAppAudio(
  supabase: any,
  instance: any,
  phoneNumber: string,
  audioUrl: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  return await sendAudioViaInstance(supabase, instance, phoneNumber, audioUrl, {
    trackSource: "semi-automatic-dispatch",
  });
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
