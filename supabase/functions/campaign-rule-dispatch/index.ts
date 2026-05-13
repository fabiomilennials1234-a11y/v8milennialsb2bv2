/**
 * Campaign Rule Dispatch - Processa fila scheduled_campaign_messages
 *
 * Isolamento por campanha: cada campanha é processada independentemente.
 *
 * Modos de chamada:
 * - Com body { campanha_id }: processa apenas essa campanha (UI button, pg_net trigger)
 * - Sem campanha_id: descobre campanhas com mensagens pendentes e processa cada uma separadamente (pg_cron)
 *
 * Action types suportados:
 * - send_template: envia mensagem via Evolution API (texto/áudio)
 * - wait_response: transita para waiting_response; lead responde → trigger PG agenda próximos steps
 * - change_stage: move lead para outra etapa da campanha
 * - assign_sdr: atribui SDR (fixo ou round_robin)
 * - cancel_sequence: cancela todos os steps pendentes dessa regra para esse lead
 *
 * Também processa timeouts de wait_response vencidos.
 */

import { withSentry } from '../_shared/sentry.ts';
import { trackEvent } from '../_shared/track.ts';
import { logRuntime } from "../_shared/logger.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { requireAuth, AuthError } from "../_shared/user-auth.ts";
import { getTimeBasedVariables } from '../_shared/time-variables.ts';

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
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
  actions_executed: number;
  timeouts_processed: number;
  error?: string;
}

Deno.serve(withSentry('campaign-rule-dispatch', async (req) => {
  const origin = req.headers.get("origin") ?? req.headers.get("Origin");
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // --- Auth: CRON_SECRET ou JWT admin via middleware compartilhado ---
  let authorized = false;
  const cronSecret = req.headers.get("x-cron-secret");
  if (!!CRON_SECRET && cronSecret === CRON_SECRET) {
    authorized = true;
  }
  if (!authorized) {
    try {
      const authCtx = await requireAuth(req);
      if (authCtx.isAdmin || authCtx.isMaster) authorized = true;
    } catch (e) {
      if (!(e instanceof AuthError)) console.warn("[campaign-rule-dispatch] Auth check failed:", e);
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
      console.log("[campaign-rule-dispatch] Single campaign mode:", campanhaId);
      const result = await processCampaignQueue(supabase, campanhaId);
      const hasError = !!result.error;

      await logRuntime({
        module: "campaign",
        action: "dispatch",
        status: hasError ? "error" : "success",
        payloadSnapshot: { campanhaId, processed: result.processed, sent: result.sent, failed: result.failed },
        errorMessage: result.error,
        entityType: "campanha",
        entityId: campanhaId,
      });

      return new Response(
        JSON.stringify({ success: !hasError, ...result }),
        { status: hasError ? 500 : 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      console.log("[campaign-rule-dispatch] Multi-campaign mode (isolated)");

      // Get distinct campaign IDs with pending messages (scheduled OR waiting_response with expired timeout)
      const { data: pendingScheduled } = await supabase
        .from("scheduled_campaign_messages")
        .select("campanha_id")
        .eq("status", "scheduled")
        .lte("scheduled_at", new Date().toISOString());

      const { data: pendingTimeouts } = await supabase
        .from("scheduled_campaign_messages")
        .select("campanha_id")
        .eq("status", "waiting_response")
        .lte("wait_timeout_at", new Date().toISOString());

      const allPending = [...(pendingScheduled || []), ...(pendingTimeouts || [])];
      const uniqueCampaignIds = [...new Set(allPending.map((r) => r.campanha_id))];

      if (uniqueCampaignIds.length === 0) {
        return new Response(
          JSON.stringify({ success: true, message: "No pending messages", campaigns: 0, processed: 0 }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("[campaign-rule-dispatch] Found", uniqueCampaignIds.length, "campaign(s) with pending work");

      const results: ProcessResult[] = [];
      let totalSent = 0, totalFailed = 0, totalProcessed = 0;

      for (const cId of uniqueCampaignIds) {
        const result = await processCampaignQueue(supabase, cId);
        results.push(result);
        totalSent += result.sent;
        totalFailed += result.failed;
        totalProcessed += result.processed;
      }

      await logRuntime({
        module: "campaign",
        action: "dispatch",
        status: "success",
        payloadSnapshot: { campaigns: uniqueCampaignIds.length, processed: totalProcessed, sent: totalSent, failed: totalFailed },
      });

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

    await logRuntime({
      module: "campaign",
      action: "dispatch",
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

// ============================================================
// Process queue for a SINGLE campaign (isolated)
// ============================================================
async function processCampaignQueue(
  supabase: SupabaseClient,
  campanhaId: string
): Promise<ProcessResult> {
  let sent = 0, failed = 0, actionsExecuted = 0, timeoutsProcessed = 0;

  // --- 0a. Trilha 3.A A2: cancel scheduled items for rules migrated to wrappers ---
  try {
    const { data: wrapperRuleIds } = await supabase
      .from("workflows")
      .select("wrapper_source_id")
      .eq("wrapper_for", "campaign_rule");

    if (wrapperRuleIds && wrapperRuleIds.length > 0) {
      const ruleIds = (wrapperRuleIds as Array<{ wrapper_source_id: string }>).map((r) => r.wrapper_source_id);
      const { data: cancelled } = await supabase
        .from("scheduled_campaign_messages")
        .update({ status: "cancelled", error_message: "Rule migrated to workflow wrapper (Trilha 3.A)" })
        .eq("campanha_id", campanhaId)
        .eq("status", "scheduled")
        .in("rule_id", ruleIds)
        .select("id");

      if (cancelled && cancelled.length > 0) {
        console.log(`[campaign-rule-dispatch][${campanhaId}] Cancelled ${cancelled.length} item(s) — rules migrated to wrappers`);
      }
    }
  } catch (e) {
    console.warn(`[campaign-rule-dispatch][${campanhaId}] wrapper-skip check failed (non-fatal):`, e);
  }

  // --- 0. Reset stale "processing" items (stuck from crashed/timed-out runs) ---
  const STALE_MINUTES = 5;
  const staleThreshold = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString();
  const { data: staleReset } = await supabase
    .from("scheduled_campaign_messages")
    .update({ status: "scheduled", scheduled_at: new Date().toISOString() })
    .eq("campanha_id", campanhaId)
    .eq("status", "processing")
    .lt("scheduled_at", staleThreshold)
    .select("id");
  if (staleReset && staleReset.length > 0) {
    console.log(`[campaign-rule-dispatch][${campanhaId}] Reset ${staleReset.length} stale processing item(s)`);
  }

  // --- 1. Process expired wait_response timeouts ---
  timeoutsProcessed = await processExpiredTimeouts(supabase, campanhaId);

  // --- 2. Atomically claim scheduled items (prevents concurrent processing) ---
  const { data: claimedRows, error: claimError } = await supabase.rpc(
    "claim_campaign_dispatch_batch",
    { p_campanha_id: campanhaId, p_limit: BATCH_SIZE }
  );

  if (claimError) {
    console.error(`[campaign-rule-dispatch][${campanhaId}] Error claiming batch:`, claimError);
    return { campanha_id: campanhaId, processed: 0, sent: 0, failed: 0, actions_executed: 0, timeouts_processed: timeoutsProcessed, error: claimError.message };
  }

  if (!claimedRows || claimedRows.length === 0) {
    return { campanha_id: campanhaId, processed: 0, sent: 0, failed: 0, actions_executed: actionsExecuted, timeouts_processed: timeoutsProcessed };
  }

  const claimedIds = claimedRows.map((r: { claimed_id: string }) => r.claimed_id);
  console.log(`[campaign-rule-dispatch][${campanhaId}] Claimed ${claimedIds.length} item(s)`);

  // --- 3. Fetch full data for claimed rows ---
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
      action_type,
      target_stage_id,
      sdr_assignment_mode,
      target_sdr_id,
      timeout_action,
      timeout_target_stage_id,
      timeout_template_id,
      step_position,
      campanhas(id, organization_id),
      leads(id, name, company, phone, email, origin, segment),
      campaign_templates!template_id(id, name, content, message_type, audio_url, available_variables)
    `)
    .in("id", claimedIds)
    .order("scheduled_at", { ascending: true });

  if (fetchError) {
    console.error(`[campaign-rule-dispatch][${campanhaId}] Error fetching claimed rows:`, fetchError);
    // Reset claimed rows back to 'scheduled' so they can be retried
    await supabase.from("scheduled_campaign_messages")
      .update({ status: "scheduled" })
      .in("id", claimedIds);
    return { campanha_id: campanhaId, processed: 0, sent: 0, failed: 0, actions_executed: 0, timeouts_processed: timeoutsProcessed, error: fetchError.message };
  }

  if (!rows || rows.length === 0) {
    return { campanha_id: campanhaId, processed: 0, sent: 0, failed: 0, actions_executed: actionsExecuted, timeouts_processed: timeoutsProcessed };
  }

  console.log(`[campaign-rule-dispatch][${campanhaId}] Processing ${rows.length} item(s)`);

  for (const row of rows) {
    try {
      const actionType = (row as any).action_type || "send_template";
      const campanha = (row as any).campanhas as { id: string; organization_id: string } | null;
      const lead = (row as any).leads as { id: string; name?: string; company?: string; phone?: string; email?: string; origin?: string; segment?: string } | null;

      if (!campanha?.organization_id || !lead) {
        await markFailed(supabase, row.id, "Missing campanha or lead");
        failed++;
        continue;
      }

      // =========================
      // ACTION: send_template
      // =========================
      if (actionType === "send_template") {
        const template = (row as any).campaign_templates as { id: string; name?: string; content?: string; message_type?: string; audio_url?: string; image_url?: string; document_url?: string; file_name?: string } | null;
        if (!template) {
          await markFailed(supabase, row.id, "Missing template");
          failed++;
          continue;
        }
        if (!lead.phone) {
          await markFailed(supabase, row.id, "Lead has no phone");
          failed++;
          continue;
        }

        let instance: { id: string; instance_name: string } | null = null;
        try {
          instance = await resolveInstance(supabase, row.whatsapp_instance_id, campanha.organization_id, lead.id);
        } catch (e) {
          // Etapa B: flag ON + falha estrita
          await markFailed(supabase, row.id, `Strict write blocked: ${(e as Error).message}`);
          failed++;
          continue;
        }
        if (!instance) {
          await markFailed(supabase, row.id, "No active WhatsApp instance");
          failed++;
          continue;
        }

        // Rate limit check
        const { data: rateCheck } = await supabase.rpc("check_whatsapp_rate_limit", {
          p_organization_id: campanha.organization_id,
          p_instance_id: instance.id,
        });
        if (rateCheck?.[0] && !rateCheck[0].can_send) {
          console.log(`[campaign-rule-dispatch][${campanhaId}] Rate limit exceeded, stopping campaign`);
          break;
        }

        const isAudio = template.message_type === "audio" && template.audio_url && String(template.audio_url).trim().length > 0;
        const isImage = template.message_type === "image" && template.image_url && String(template.image_url).trim().length > 0;
        const isDocument = template.message_type === "document" && template.document_url && String(template.document_url).trim().length > 0;
        const isMedia = isAudio || isImage || isDocument;
        const timeVars = getTimeBasedVariables();
        const leadVars = {
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
        };
        const messageContent = isAudio ? "[Áudio]" : isImage ? (template.content ? replaceVariables(template.content, leadVars) : "") : isDocument ? (template.content ? replaceVariables(template.content, leadVars) : "") : replaceVariables(template.content || "", leadVars);

        let sendResult: { success: boolean; messageId?: string; error?: string };
        if (isAudio) {
          sendResult = await sendWhatsAppAudio(supabase, instance, lead.phone, template.audio_url!);
        } else if (isImage) {
          sendResult = await sendWhatsAppMedia(supabase, instance, lead.phone, "image", template.image_url!, { caption: messageContent || undefined });
        } else if (isDocument) {
          const resolvedFileName = template.file_name ? replaceVariables(template.file_name, leadVars) : undefined;
          sendResult = await sendWhatsAppMedia(supabase, instance, lead.phone, "document", template.document_url!, { caption: messageContent || undefined, fileName: resolvedFileName });
        } else {
          sendResult = await sendWhatsAppMessage(supabase, instance, lead.phone, messageContent);
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

          // Sync with chat
          try {
            const phone = lead.phone!.replace(/\D/g, "").replace(/^(?!55)/, "55");
            const { error: chatErr } = await supabase.from("whatsapp_messages").upsert({
              organization_id: campanha.organization_id,
              instance_id: instance.id,
              message_id: sendResult.messageId || `campaign_${row.id}_${Date.now()}`,
              remote_jid: `${phone}@s.whatsapp.net`,
              phone_number: phone,
              direction: "outgoing",
              message_type: isAudio ? "audio" : isImage ? "image" : isDocument ? "document" : "text",
              content: isMedia && !messageContent ? null : messageContent,
              media_url: isAudio ? template.audio_url : isImage ? template.image_url : isDocument ? template.document_url : null,
              status: "sent",
              lead_id: lead.id,
              timestamp: new Date().toISOString(),
              sent_by_ai: true,
              sent_source: "workflow",
            }, { onConflict: "message_id,instance_id", ignoreDuplicates: false });
            if (chatErr) {
              console.warn("[campaign-rule-dispatch] whatsapp_messages upsert failed:", chatErr);
            }
          } catch (chatSyncErr) {
            console.warn("[campaign-rule-dispatch] chat sync error:", chatSyncErr);
          }

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
            await supabase.from("lead_history").insert({
              lead_id: lead.id,
              organization_id: campanha.organization_id,
              action: "message_sent",
              description: `Mensagem enviada via campanha: ${template.name || "template"}`,
            });
          } catch (_) { /* ignore */ }

          // Track usage event (fire-and-forget)
          trackEvent({
            organizationId: campanha.organization_id,
            eventType: "message_sent",
            entityType: "lead",
            entityId: lead.id,
            metadata: { campanha_id: campanhaId, template_name: template.name, is_audio: isAudio },
          }).catch(() => {});

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

        // Delay between sends
        const { data: org } = await supabase.from("organizations").select("whatsapp_rate_limit").eq("id", campanha.organization_id).single();
        const rateLimit = org?.whatsapp_rate_limit || {};
        const minDelay = rateLimit.delay_min_ms ?? DEFAULT_DELAY_MIN_MS;
        const maxDelay = rateLimit.delay_max_ms ?? DEFAULT_DELAY_MAX_MS;
        await randomDelay(minDelay, maxDelay);

      // =========================
      // ACTION: wait_response
      // =========================
      } else if (actionType === "wait_response") {
        const waitTimeoutMinutes = (row as any).wait_timeout_minutes ?? 1440;
        const now = new Date();
        const timeoutAt = new Date(now.getTime() + waitTimeoutMinutes * 60 * 1000);

        await supabase.from("scheduled_campaign_messages").update({
          status: "waiting_response",
          waiting_since: now.toISOString(),
          wait_timeout_at: timeoutAt.toISOString(),
        }).eq("id", row.id);

        actionsExecuted++;
        console.log(`[campaign-rule-dispatch][${campanhaId}] Wait response started for lead ${lead.name}, timeout at ${timeoutAt.toISOString()}`);

        try {
          await supabase.from("lead_history").insert({
            lead_id: lead.id,
            organization_id: campanha.organization_id,
            action: "campaign_wait_response",
            description: `Aguardando resposta do lead (timeout: ${waitTimeoutMinutes}min)`,
          });
        } catch (_) { /* ignore */ }

      // =========================
      // ACTION: change_stage
      // =========================
      } else if (actionType === "change_stage") {
        const targetStageId = (row as any).target_stage_id;
        if (!targetStageId) {
          await markFailed(supabase, row.id, "No target_stage_id for change_stage action");
          failed++;
          continue;
        }

        const { error: stageErr } = await supabase
          .from("campanha_leads")
          .update({ stage_id: targetStageId })
          .eq("id", row.campanha_lead_id);

        if (stageErr) {
          await markFailed(supabase, row.id, `change_stage failed: ${stageErr.message}`);
          failed++;
        } else {
          await supabase.from("scheduled_campaign_messages").update({
            status: "executed",
            sent_at: new Date().toISOString(),
          }).eq("id", row.id);

          // Get stage name for history
          const { data: stageData } = await supabase
            .from("campanha_stages")
            .select("name")
            .eq("id", targetStageId)
            .single();

          try {
            await supabase.from("lead_history").insert({
              lead_id: lead.id,
              organization_id: campanha.organization_id,
              action: "campaign_stage_change",
              description: `Etapa alterada automaticamente para: ${stageData?.name || targetStageId}`,
            });
          } catch (_) { /* ignore */ }

          actionsExecuted++;
          console.log(`[campaign-rule-dispatch][${campanhaId}] Changed stage for lead ${lead.name} to ${stageData?.name || targetStageId}`);
        }

      // =========================
      // ACTION: assign_sdr
      // =========================
      } else if (actionType === "assign_sdr") {
        const mode = (row as any).sdr_assignment_mode || "specific";
        let sdrId: string | null = (row as any).target_sdr_id || null;

        if (mode === "round_robin") {
          // Use atomic campaign distribution RPC (unified pool + advisory lock)
          const { data: nextId } = await supabase.rpc("get_next_campaign_sdr", {
            p_campaign_id: campanhaId,
          });
          sdrId = nextId ?? null;
        } else if (mode === "random") {
          // Pick randomly from campaign members (rule-level mode, not campaign-level)
          const { data: members } = await supabase
            .from("campanha_members")
            .select("team_member_id")
            .eq("campanha_id", campanhaId);
          if (members && members.length > 0) {
            sdrId = members[Math.floor(Math.random() * members.length)].team_member_id;
          }
        }

        if (!sdrId) {
          await markFailed(supabase, row.id, "No SDR available for assignment");
          failed++;
          continue;
        }

        const { error: sdrErr } = await supabase
          .from("campanha_leads")
          .update({ sdr_id: sdrId, responsible_id: sdrId, pre_sale_responsible_id: sdrId })
          .eq("id", row.campanha_lead_id);

        if (sdrErr) {
          await markFailed(supabase, row.id, `assign_sdr failed: ${sdrErr.message}`);
          failed++;
        } else {
          await supabase.from("scheduled_campaign_messages").update({
            status: "executed",
            sent_at: new Date().toISOString(),
          }).eq("id", row.id);

          const { data: sdrData } = await supabase
            .from("team_members")
            .select("name")
            .eq("id", sdrId)
            .single();

          try {
            await supabase.from("lead_history").insert({
              lead_id: lead.id,
              organization_id: campanha.organization_id,
              action: "responsible_assigned",
              description: `Responsável atribuído automaticamente: ${sdrData?.name || sdrId} (${mode})`,
            });
          } catch (_) { /* ignore */ }

          actionsExecuted++;
          console.log(`[campaign-rule-dispatch][${campanhaId}] Assigned SDR ${sdrData?.name || sdrId} to lead ${lead.name} (${mode})`);
        }

      // =========================
      // ACTION: cancel_sequence
      // =========================
      } else if (actionType === "cancel_sequence") {
        // Cancel all remaining scheduled messages for this lead+rule
        const { data: cancelled } = await supabase
          .from("scheduled_campaign_messages")
          .update({ status: "cancelled" })
          .eq("campanha_lead_id", row.campanha_lead_id)
          .eq("rule_id", row.rule_id)
          .eq("status", "scheduled")
          .neq("id", row.id)
          .select("id");

        // Mark this action itself as executed
        await supabase.from("scheduled_campaign_messages").update({
          status: "executed",
          sent_at: new Date().toISOString(),
        }).eq("id", row.id);

        try {
          await supabase.from("lead_history").insert({
            lead_id: lead.id,
            organization_id: campanha.organization_id,
            action: "campaign_sequence_cancelled",
            description: `Sequência cancelada automaticamente (${cancelled?.length ?? 0} mensagens pendentes canceladas)`,
          });
        } catch (_) { /* ignore */ }

        actionsExecuted++;
        console.log(`[campaign-rule-dispatch][${campanhaId}] Cancelled sequence for lead ${lead.name}, ${cancelled?.length ?? 0} items cancelled`);
      }
    } catch (rowError) {
      console.error(`[campaign-rule-dispatch][${campanhaId}] Row error:`, row.id, rowError);
      try {
        await markFailed(supabase, row.id, rowError instanceof Error ? rowError.message : String(rowError));
      } catch (_) { /* ignore */ }
      failed++;
    }
  }

  const totalProcessed = rows.length;
  console.log(`[campaign-rule-dispatch][${campanhaId}] Done: ${sent} sent, ${actionsExecuted} actions, ${failed} failed, ${timeoutsProcessed} timeouts`);
  return { campanha_id: campanhaId, processed: totalProcessed, sent, failed, actions_executed: actionsExecuted, timeouts_processed: timeoutsProcessed };
}

// ============================================================
// Process expired wait_response timeouts for a campaign
// ============================================================
async function processExpiredTimeouts(
  supabase: SupabaseClient,
  campanhaId: string
): Promise<number> {
  const { data: expired, error } = await supabase
    .from("scheduled_campaign_messages")
    .select(`
      id, campanha_id, rule_id, campanha_lead_id, lead_id,
      whatsapp_instance_id, step_position,
      timeout_action, timeout_target_stage_id, timeout_template_id,
      campanhas(id, organization_id),
      leads(id, name, phone)
    `)
    .eq("campanha_id", campanhaId)
    .eq("status", "waiting_response")
    .lte("wait_timeout_at", new Date().toISOString())
    .limit(BATCH_SIZE);

  if (error || !expired || expired.length === 0) return 0;

  let count = 0;
  for (const row of expired) {
    try {
      const campanha = (row as any).campanhas as { id: string; organization_id: string } | null;
      const lead = (row as any).leads as { id: string; name?: string; phone?: string } | null;
      const timeoutAction = row.timeout_action || "continue";

      // Mark as timed_out
      await supabase.from("scheduled_campaign_messages").update({
        status: "timed_out",
        sent_at: new Date().toISOString(),
      }).eq("id", row.id);

      if (campanha && lead) {
        try {
          await supabase.from("lead_history").insert({
            lead_id: lead.id,
            organization_id: campanha.organization_id,
            action: "campaign_wait_timeout",
            description: `Timeout de espera de resposta atingido. Ação: ${timeoutAction}`,
          });
        } catch (_) { /* ignore */ }
      }

      // Execute timeout action
      if (timeoutAction === "change_stage" && row.timeout_target_stage_id) {
        await supabase
          .from("campanha_leads")
          .update({ stage_id: row.timeout_target_stage_id })
          .eq("id", row.campanha_lead_id);
        console.log(`[campaign-rule-dispatch][${campanhaId}] Timeout: changed stage for lead ${lead?.name}`);

      } else if (timeoutAction === "send_template" && row.timeout_template_id && lead?.phone) {
        // Send the timeout template
        const { data: tmpl } = await supabase
          .from("campaign_templates")
          .select("id, name, content, message_type, audio_url")
          .eq("id", row.timeout_template_id)
          .single();

        if (tmpl && campanha) {
          let instance: { id: string; instance_name: string } | null = null;
          try {
            instance = await resolveInstance(supabase, row.whatsapp_instance_id, campanha.organization_id, lead?.id ?? null);
          } catch (e) {
            // Etapa B: timeout-fallback NÃO bloqueia o pipe — log estruturado e segue.
            console.warn(
              `[campaign-rule-dispatch][${campanhaId}] Timeout strict write blocked: ${(e as Error).message}`,
            );
          }
          if (instance) {
            const isAudio = tmpl.message_type === "audio" && tmpl.audio_url;
            const timeVars = getTimeBasedVariables();
            const content = isAudio ? "[Áudio]" : replaceVariables(tmpl.content || "", {
              nome: lead.name || "você", empresa: "", email: "", telefone: lead.phone || "",
              origem: "", segmento: "", faturamento: "",
              saudacao: timeVars.saudacao, data: timeVars.data, hora: timeVars.hora,
            });

            const result = isAudio
              ? await sendWhatsAppAudio(supabase, instance, lead.phone, tmpl.audio_url!)
              : await sendWhatsAppMessage(supabase, instance, lead.phone, content);

            if (result.success) {
              // Sync with chat
              try {
                const phone = lead.phone!.replace(/\D/g, "").replace(/^(?!55)/, "55");
                await supabase.from("whatsapp_messages").upsert({
                  organization_id: campanha.organization_id,
                  instance_id: instance.id,
                  message_id: result.messageId || `timeout_${row.id}_${Date.now()}`,
                  remote_jid: `${phone}@s.whatsapp.net`,
                  phone_number: phone,
                  direction: "outgoing",
                  message_type: isAudio ? "audio" : "text",
                  content: isAudio ? null : content,
                  media_url: isAudio ? tmpl.audio_url : null,
                  status: "sent",
                  lead_id: lead.id,
                  timestamp: new Date().toISOString(),
                  sent_by_ai: true,
                  sent_source: "workflow",
                }, { onConflict: "message_id,instance_id", ignoreDuplicates: false });
              } catch (_) { /* ignore */ }
            }
            console.log(`[campaign-rule-dispatch][${campanhaId}] Timeout: sent template to lead ${lead.name}`);
          }
        }

      } else if (timeoutAction === "cancel_sequence") {
        // Cancel all remaining for this lead+rule
        await supabase
          .from("scheduled_campaign_messages")
          .update({ status: "cancelled" })
          .eq("campanha_lead_id", row.campanha_lead_id)
          .eq("rule_id", row.rule_id)
          .eq("status", "scheduled");
        console.log(`[campaign-rule-dispatch][${campanhaId}] Timeout: cancelled sequence for lead ${lead?.name}`);

      } else if (timeoutAction === "continue") {
        // Schedule next steps after the wait_response position
        const nextPos = (row.step_position ?? 0) + 1;
        const { data: whatsappInst } = await supabase
          .from("campanhas")
          .select("whatsapp_instance_id")
          .eq("id", row.campanha_id)
          .single();

        try {
          await supabase.rpc("schedule_rule_steps_from_position", {
            p_campanha_id: row.campanha_id,
            p_rule_id: row.rule_id,
            p_campanha_lead_id: row.campanha_lead_id,
            p_lead_id: row.lead_id,
            p_whatsapp_instance_id: row.whatsapp_instance_id || whatsappInst?.whatsapp_instance_id,
            p_from_position: nextPos,
          });
        } catch (rpcErr) {
          console.warn(`[campaign-rule-dispatch][${campanhaId}] schedule_rule_steps_from_position failed:`, rpcErr);
        }
        console.log(`[campaign-rule-dispatch][${campanhaId}] Timeout: continuing sequence from pos ${nextPos} for lead ${lead?.name}`);
      }

      count++;
    } catch (err) {
      console.error(`[campaign-rule-dispatch][${campanhaId}] Timeout processing error:`, err);
    }
  }
  return count;
}

// ============================================================
// Helper functions
// ============================================================

async function resolveInstance(
  supabase: SupabaseClient,
  instanceId: string | null,
  organizationId: string,
  // Etapa B: lead_id opcional. Quando flag user_write_instance_strict ON,
  // força vínculo via responsable_user_id. OFF ⇒ comportamento legado.
  leadId?: string | null,
): Promise<{ id: string; instance_name: string } | null> {
  if (leadId) {
    const { resolveStrictInstanceForCaller, StrictWriteResolutionError } = await import(
      "../_shared/instance-write-guard.ts"
    );
    try {
      const strict = await resolveStrictInstanceForCaller(
        supabase as unknown as Parameters<typeof resolveStrictInstanceForCaller>[0],
        organizationId,
        leadId,
      );
      if (strict) {
        return {
          id: strict.id as string,
          instance_name: strict.instance_name as string,
        };
      }
    } catch (err) {
      if (err instanceof StrictWriteResolutionError) {
        console.warn(
          "[campaign-rule-dispatch] strict_write_fallback lead=%s code=%s — using legacy instance resolution",
          leadId, err.errorCode,
        );
      } else {
        throw err;
      }
    }
  }

  if (instanceId) {
    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("id, instance_name, status")
      .eq("id", instanceId)
      .single();
    if (inst && (inst.status === "connected" || inst.status === "open")) {
      return { id: inst.id, instance_name: inst.instance_name };
    }
  }
  const { data: instList } = await supabase
    .from("whatsapp_instances")
    .select("id, instance_name")
    .eq("organization_id", organizationId)
    .or("status.eq.open,status.eq.connected")
    .limit(1);
  return instList?.[0] ?? null;
}

async function markFailed(supabase: SupabaseClient, id: string, errorMessage: string) {
  await supabase.from("scheduled_campaign_messages").update({
    status: "failed",
    error_message: errorMessage,
  }).eq("id", id);
}

// getTimeBasedVariables is now imported from _shared/time-variables.ts

function replaceVariables(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "gi"), value || "");
  }
  result = result.replace(/\{[^}]+\}/g, "");
  return result.trim();
}

// Legacy send shims — provider-agnostic via whatsapp-dispatch adapter.
import {
  sendTextViaInstance,
  sendAudioViaInstance,
  sendMediaViaInstance,
} from "../_shared/whatsapp-dispatch.ts";

async function sendWhatsAppMessage(
  supabase: any,
  instance: any,
  phoneNumber: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  return await sendTextViaInstance(supabase, instance, phoneNumber, message, {
    trackSource: "campaign-rule-dispatch",
  });
}

async function sendWhatsAppAudio(
  supabase: any,
  instance: any,
  phoneNumber: string,
  audioUrl: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  return await sendAudioViaInstance(supabase, instance, phoneNumber, audioUrl, {
    trackSource: "campaign-rule-dispatch",
  });
}

async function sendWhatsAppMedia(
  supabase: any,
  instance: any,
  phoneNumber: string,
  mediaType: "image" | "document",
  mediaUrl: string,
  options?: { caption?: string; fileName?: string }
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  return await sendMediaViaInstance(
    supabase,
    instance,
    phoneNumber,
    {
      type: mediaType,
      file: mediaUrl,
      filename: options?.fileName,
      caption: options?.caption,
    },
    { trackSource: "campaign-rule-dispatch" }
  );
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delayMs = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
