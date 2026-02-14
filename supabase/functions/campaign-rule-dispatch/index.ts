/**
 * Campaign Rule Dispatch - Processa fila scheduled_campaign_messages
 *
 * Isolamento por campanha: cada campanha é processada independentemente.
 *
 * Modos de chamada:
 * - Com body { campanha_id }: processa apenas essa campanha (UI button, pg_net trigger)
 * - Sem campanha_id: descobre campanhas com mensagens pendentes e processa cada uma separadamente (pg_cron)
 *
 * Fluxo por campanha:
 * 1. Buscar scheduled_campaign_messages com status = 'scheduled' e scheduled_at <= NOW()
 * 2. Para cada linha: obter lead, template, instância (da linha ou fallback org)
 * 3. Enviar via Evolution API (substituir variáveis, texto/áudio)
 * 4. Atualizar scheduled_campaign_messages e outbound_dispatch_log
 * 5. Respeitar rate limit
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL") || "";
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const DEFAULT_DELAY_MIN_MS = 30000;
const DEFAULT_DELAY_MAX_MS = 90000;
const BATCH_SIZE = 50;

type SupabaseClient = ReturnType<typeof createClient>;

interface ProcessResult {
  campanha_id: string;
  processed: number;
  sent: number;
  failed: number;
  error?: string;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? req.headers.get("Origin");
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // --- Auth ---
  let authorized = false;
  const cronSecret = req.headers.get("x-cron-secret");
  if (CRON_SECRET && cronSecret === CRON_SECRET) {
    authorized = true;
  }
  if (!authorized) {
    try {
      const authHeader = req.headers.get("Authorization");
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (!error && user) {
          const { data: members } = await supabase
            .from("team_members")
            .select("role")
            .eq("user_id", user.id);
          if (members?.some((m: { role: string }) => m.role === "admin")) authorized = true;
        }
      }
    } catch (authErr) {
      console.warn("[campaign-rule-dispatch] Auth check failed:", authErr);
    }
  }
  if (!authorized) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // --- Parse body for optional campanha_id ---
  let campanhaId: string | null = null;
  try {
    const body = await req.json();
    if (body?.campanha_id && typeof body.campanha_id === "string") {
      campanhaId = body.campanha_id;
    }
  } catch {
    // No body or invalid JSON - process all campaigns
  }

  try {
    if (campanhaId) {
      // === Single campaign mode (UI button / pg_net trigger) ===
      console.log("[campaign-rule-dispatch] Single campaign mode:", campanhaId);
      const result = await processCampaignQueue(supabase, campanhaId);
      return new Response(
        JSON.stringify({ success: true, ...result }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      // === All campaigns mode (pg_cron) - isolated per campaign ===
      console.log("[campaign-rule-dispatch] Multi-campaign mode (isolated)");

      // Get distinct campaign IDs with pending messages
      const { data: pending, error: pendingErr } = await supabase
        .from("scheduled_campaign_messages")
        .select("campanha_id")
        .eq("status", "scheduled")
        .lte("scheduled_at", new Date().toISOString());

      if (pendingErr) {
        console.error("[campaign-rule-dispatch] Error fetching pending campaigns:", pendingErr);
        return new Response(
          JSON.stringify({ error: "Failed to fetch pending campaigns", details: pendingErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const uniqueCampaignIds = [...new Set((pending || []).map((r) => r.campanha_id))];

      if (uniqueCampaignIds.length === 0) {
        return new Response(
          JSON.stringify({ success: true, message: "No pending messages", campaigns: 0, processed: 0 }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("[campaign-rule-dispatch] Found", uniqueCampaignIds.length, "campaign(s) with pending messages");

      const results: ProcessResult[] = [];
      let totalSent = 0;
      let totalFailed = 0;
      let totalProcessed = 0;

      for (const cId of uniqueCampaignIds) {
        const result = await processCampaignQueue(supabase, cId);
        results.push(result);
        totalSent += result.sent;
        totalFailed += result.failed;
        totalProcessed += result.processed;
      }

      return new Response(
        JSON.stringify({
          success: true,
          campaigns: uniqueCampaignIds.length,
          processed: totalProcessed,
          sent: totalSent,
          failed: totalFailed,
          details: results,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
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

// ============================================================
// Process queue for a SINGLE campaign (isolated)
// ============================================================
async function processCampaignQueue(
  supabase: SupabaseClient,
  campanhaId: string
): Promise<ProcessResult> {
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
    .eq("campanha_id", campanhaId)
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .limit(BATCH_SIZE);

  if (fetchError) {
    console.error(`[campaign-rule-dispatch][${campanhaId}] Error fetching queue:`, fetchError);
    return { campanha_id: campanhaId, processed: 0, sent: 0, failed: 0, error: fetchError.message };
  }

  if (!rows || rows.length === 0) {
    return { campanha_id: campanhaId, processed: 0, sent: 0, failed: 0 };
  }

  console.log(`[campaign-rule-dispatch][${campanhaId}] Processing ${rows.length} message(s)`);

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    try {
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

      // --- Instance lookup with status check + fallback ---
      let instance: { id: string; instance_name: string } | null = null;
      if (row.whatsapp_instance_id) {
        const { data: inst } = await supabase
          .from("whatsapp_instances")
          .select("id, instance_name, status")
          .eq("id", row.whatsapp_instance_id)
          .single();
        if (inst && (inst.status === "connected" || inst.status === "open")) {
          instance = { id: inst.id, instance_name: inst.instance_name };
        }
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

      // --- Rate limit check ---
      const { data: rateCheck } = await supabase.rpc("check_whatsapp_rate_limit", {
        p_organization_id: campanha.organization_id,
        p_instance_id: instance.id,
      });
      if (rateCheck?.[0] && !rateCheck[0].can_send) {
        console.log(`[campaign-rule-dispatch][${campanhaId}] Rate limit exceeded, stopping campaign`);
        break;
      }

      // --- Build message ---
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

      // --- Send ---
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

        try {
          const { error: rlErr } = await supabase.rpc("increment_whatsapp_rate_limit", {
            p_organization_id: campanha.organization_id,
            p_instance_id: instance.id,
          });
          if (rlErr) console.warn("[campaign-rule-dispatch] increment_whatsapp_rate_limit failed:", rlErr);
        } catch (e) {
          console.warn("[campaign-rule-dispatch] increment_whatsapp_rate_limit error:", e);
        }

        try {
          await supabase.rpc("increment", {
            table_name: "campaign_templates",
            row_id: template.id,
            column_name: "times_used",
          });
        } catch (_) { /* ignore */ }

        try {
          const { error: histErr } = await supabase.from("lead_history").insert({
            lead_id: lead.id,
            organization_id: campanha.organization_id,
            action: "message_sent",
            description: `Mensagem enviada via campanha: ${template.name || "template"}`,
          });
          if (histErr) console.warn("[campaign-rule-dispatch] lead_history insert failed:", histErr);
        } catch (err) {
          console.warn("[campaign-rule-dispatch] lead_history error:", err);
        }

        sent++;
        console.log(`[campaign-rule-dispatch][${campanhaId}] Sent to:`, lead.name, lead.phone);
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

      // --- Delay between sends ---
      const { data: org } = await supabase.from("organizations").select("whatsapp_rate_limit").eq("id", campanha.organization_id).single();
      const rateLimit = org?.whatsapp_rate_limit || {};
      const minDelay = rateLimit.delay_min_ms ?? DEFAULT_DELAY_MIN_MS;
      const maxDelay = rateLimit.delay_max_ms ?? DEFAULT_DELAY_MAX_MS;
      await randomDelay(minDelay, maxDelay);
    } catch (rowError) {
      console.error(`[campaign-rule-dispatch][${campanhaId}] Row error:`, row.id, rowError);
      try {
        await markFailed(supabase, row.id, rowError instanceof Error ? rowError.message : String(rowError));
      } catch (_) { /* ignore */ }
      failed++;
    }
  }

  console.log(`[campaign-rule-dispatch][${campanhaId}] Done: ${sent} sent, ${failed} failed`);
  return { campanha_id: campanhaId, processed: rows.length, sent, failed };
}

// ============================================================
// Helper functions
// ============================================================

async function markFailed(supabase: SupabaseClient, id: string, errorMessage: string) {
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
