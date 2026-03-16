import { withSentry } from '../_shared/sentry.ts';
import { logRuntime } from '../_shared/logger.ts';
import { trackEvent } from '../_shared/track.ts';
import { startJob, finishJob, failJob } from '../_shared/job-tracker.ts';
/**
 * Pipe Rule Dispatch - Processa fila scheduled_pipe_messages
 *
 * Modos de chamada:
 * - Com body { pipe_type, organization_id? }: processa esse funil (UI button, pg_net trigger)
 * - Sem body: descobre pipes com mensagens pendentes e processa cada um (pg_cron)
 *
 * Action types suportados:
 * - send_template: envia mensagem via Evolution API (texto/áudio)
 * - wait_response: transita para waiting_response; lead responde → trigger PG agenda próximos steps
 * - change_stage: move lead para outra etapa do funil (via pipeline_stages.stage_key)
 * - assign_sdr: atribui SDR (fixo ou round_robin)
 * - cancel_sequence: cancela todos os steps pendentes dessa regra para esse lead
 *
 * Também processa timeouts de wait_response vencidos.
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
  pipe_type: string;
  organization_id?: string;
  processed: number;
  sent: number;
  failed: number;
  actions_executed: number;
  timeouts_processed: number;
  error?: string;
}

Deno.serve(withSentry('pipe-rule-dispatch', async (req) => {
  const origin = req.headers.get("origin") ?? req.headers.get("Origin");
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // --- Auth ---
  let authorized = false;
  const cronSecret = req.headers.get("x-cron-secret");

  // 1. Cron secret match
  if (CRON_SECRET && cronSecret && cronSecret === CRON_SECRET) {
    authorized = true;
  }

  // CRON_SECRET must be set in env — no fallback for missing secret

  // 3. Bearer token auth (frontend calls)
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
          if (members?.some((m: { role: string }) => ["admin", "master"].includes(m.role))) authorized = true;
        }
      }
    } catch (authErr) {
      console.warn("[pipe-rule-dispatch] Auth check failed:", authErr);
    }
  }

  if (!authorized) {
    console.error("[pipe-rule-dispatch] Unauthorized request. Headers:", JSON.stringify({
      hasCronSecret: !!cronSecret,
      hasAuthHeader: !!req.headers.get("Authorization"),
      envCronSecretSet: !!CRON_SECRET,
    }));
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // --- Parse body ---
  let pipeType: string | null = null;
  try {
    const body = await req.json();
    if (body?.pipe_type && typeof body.pipe_type === "string") {
      pipeType = body.pipe_type;
    }
  } catch {
    // No body - process all
  }

  try {
    if (pipeType) {
      console.log("[pipe-rule-dispatch] Single pipe mode:", pipeType);
      const result = await processPipeQueue(supabase, pipeType);
      await logRuntime({
        organizationId: result.organization_id,
        module: 'pipe_dispatch',
        action: 'execute_rule',
        status: 'success',
        entityType: 'pipe_record',
        payloadSnapshot: { pipe_type: pipeType, processed: result.processed, sent: result.sent, failed: result.failed },
      });
      return new Response(
        JSON.stringify({ success: true, ...result }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      console.log("[pipe-rule-dispatch] Multi-pipe mode");

      // Reset stale processing items BEFORE checking for pending (prevents items stuck forever)
      const STALE_MINUTES_GLOBAL = 5;
      const staleThresholdGlobal = new Date(Date.now() - STALE_MINUTES_GLOBAL * 60 * 1000).toISOString();
      const { data: staleGlobalReset } = await supabase
        .from("scheduled_pipe_messages")
        .update({ status: "scheduled", scheduled_at: new Date().toISOString() })
        .eq("status", "processing")
        .lt("scheduled_at", staleThresholdGlobal)
        .select("id");
      if (staleGlobalReset && staleGlobalReset.length > 0) {
        console.log(`[pipe-rule-dispatch] Global stale reset: ${staleGlobalReset.length} item(s)`);
      }

      const { data: pendingScheduled } = await supabase
        .from("scheduled_pipe_messages")
        .select("pipe_type")
        .eq("status", "scheduled")
        .lte("scheduled_at", new Date().toISOString());

      const { data: pendingTimeouts } = await supabase
        .from("scheduled_pipe_messages")
        .select("pipe_type")
        .eq("status", "waiting_response")
        .lte("wait_timeout_at", new Date().toISOString());

      const allPending = [...(pendingScheduled || []), ...(pendingTimeouts || [])];
      const uniquePipeTypes = [...new Set(allPending.map((r) => r.pipe_type))];

      if (uniquePipeTypes.length === 0) {
        return new Response(
          JSON.stringify({ success: true, message: "No pending messages", pipes: 0, processed: 0 }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const results: ProcessResult[] = [];
      let totalSent = 0, totalFailed = 0, totalProcessed = 0;

      for (const pt of uniquePipeTypes) {
        const result = await processPipeQueue(supabase, pt);
        results.push(result);
        totalSent += result.sent;
        totalFailed += result.failed;
        totalProcessed += result.processed;
      }

      await logRuntime({
        module: 'pipe_dispatch',
        action: 'execute_rule',
        status: 'success',
        payloadSnapshot: { pipes: uniquePipeTypes.length, processed: totalProcessed, sent: totalSent, failed: totalFailed },
      });
      return new Response(
        JSON.stringify({
          success: true,
          pipes: uniquePipeTypes.length,
          processed: totalProcessed,
          sent: totalSent,
          failed: totalFailed,
          details: results,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("[pipe-rule-dispatch] Error:", error);
    await logRuntime({
      module: 'pipe_dispatch',
      action: 'execute_rule',
      status: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      payloadSnapshot: { pipe_type: pipeType },
    });
    throw error;
  }
}));

// ============================================================
// Process queue for a pipe_type
// ============================================================
async function processPipeQueue(
  supabase: SupabaseClient,
  pipeType: string
): Promise<ProcessResult> {
  let sent = 0, failed = 0, actionsExecuted = 0, timeoutsProcessed = 0;

  // --- 0. Reset stale "processing" items (stuck from crashed/timed-out runs) ---
  const STALE_MINUTES = 5;
  const staleThreshold = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString();
  const { data: staleReset } = await supabase
    .from("scheduled_pipe_messages")
    .update({ status: "scheduled", scheduled_at: new Date().toISOString() })
    .eq("pipe_type", pipeType)
    .eq("status", "processing")
    .lt("scheduled_at", staleThreshold)
    .select("id");
  if (staleReset && staleReset.length > 0) {
    console.log(`[pipe-rule-dispatch][${pipeType}] Reset ${staleReset.length} stale processing item(s)`);
  }

  // --- 1. Process expired wait_response timeouts ---
  timeoutsProcessed = await processExpiredTimeouts(supabase, pipeType);

  // --- 2. Atomically claim scheduled items (prevents concurrent processing) ---
  let claimedIds: string[] = [];

  // Try RPC claim first (atomic, concurrent-safe)
  const { data: claimedRows, error: claimError } = await supabase.rpc(
    "claim_pipe_dispatch_batch",
    { p_pipe_type: pipeType, p_limit: BATCH_SIZE }
  );

  if (claimError) {
    console.warn(`[pipe-rule-dispatch][${pipeType}] RPC claim failed (falling back to direct query):`, claimError.message);

    // Fallback: direct SELECT + UPDATE (less safe for concurrency but works without RPC/CHECK fix)
    const { data: fallbackRows, error: fallbackErr } = await supabase
      .from("scheduled_pipe_messages")
      .select("id")
      .eq("pipe_type", pipeType)
      .eq("status", "scheduled")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (fallbackErr || !fallbackRows || fallbackRows.length === 0) {
      console.error(`[pipe-rule-dispatch][${pipeType}] Fallback also failed:`, fallbackErr?.message);
      return { pipe_type: pipeType, processed: 0, sent: 0, failed: 0, actions_executed: 0, timeouts_processed: timeoutsProcessed, error: claimError.message };
    }

    claimedIds = fallbackRows.map((r: { id: string }) => r.id);
    console.log(`[pipe-rule-dispatch][${pipeType}] Fallback claimed ${claimedIds.length} item(s)`);
  } else if (!claimedRows || claimedRows.length === 0) {
    return { pipe_type: pipeType, processed: 0, sent: 0, failed: 0, actions_executed: actionsExecuted, timeouts_processed: timeoutsProcessed };
  } else {
    claimedIds = claimedRows.map((r: { claimed_id: string }) => r.claimed_id);
  }
  console.log(`[pipe-rule-dispatch][${pipeType}] Claimed ${claimedIds.length} item(s)`);

  // --- 3. Fetch full data for claimed rows ---
  const { data: rows, error: fetchError } = await supabase
    .from("scheduled_pipe_messages")
    .select(`
      id,
      organization_id,
      pipe_type,
      rule_id,
      pipe_record_id,
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
      leads(id, name, company, phone, email, origin, segment),
      campaign_templates!template_id(id, name, content, message_type, audio_url, available_variables)
    `)
    .in("id", claimedIds)
    .order("scheduled_at", { ascending: true });

  if (fetchError) {
    console.error(`[pipe-rule-dispatch][${pipeType}] Error fetching claimed rows:`, fetchError);
    // Reset claimed rows back to 'scheduled' so they can be retried
    await supabase.from("scheduled_pipe_messages")
      .update({ status: "scheduled" })
      .in("id", claimedIds);
    return { pipe_type: pipeType, processed: 0, sent: 0, failed: 0, actions_executed: 0, timeouts_processed: timeoutsProcessed, error: fetchError.message };
  }

  if (!rows || rows.length === 0) {
    return { pipe_type: pipeType, processed: 0, sent: 0, failed: 0, actions_executed: actionsExecuted, timeouts_processed: timeoutsProcessed };
  }

  console.log(`[pipe-rule-dispatch][${pipeType}] Processing ${rows.length} item(s)`);

  for (const row of rows) {
    let jobId: string | null = null;
    try {
      const actionType = (row as any).action_type || "send_template";
      const orgId = row.organization_id as string;
      const lead = (row as any).leads as { id: string; name?: string; company?: string; phone?: string; email?: string; origin?: string; segment?: string } | null;

      if (!orgId || !lead) {
        await markFailed(supabase, row.id, "Missing organization or lead");
        failed++;
        continue;
      }

      // Job tracking: registrar início
      jobId = await startJob(supabase, {
        organizationId: orgId,
        sourceEngine: 'pipe_dispatch',
        entityType: 'pipe_record',
        entityId: row.pipe_record_id || lead.id,
        actionType,
        sourceTable: 'scheduled_pipe_messages',
        sourceId: row.id,
        payloadSnapshot: { pipe_type: pipeType, lead_name: lead.name, lead_phone: lead.phone },
      });

      // =========================
      // ACTION: send_template
      // =========================
      if (actionType === "send_template") {
        const template = (row as any).campaign_templates as { id: string; name?: string; content?: string; message_type?: string; audio_url?: string } | null;
        if (!template) {
          await markFailed(supabase, row.id, "Missing template");
          if (jobId) await failJob(supabase, jobId, "Missing template");
          failed++;
          continue;
        }
        if (!lead.phone) {
          await markFailed(supabase, row.id, "Lead has no phone");
          if (jobId) await failJob(supabase, jobId, "Lead has no phone");
          failed++;
          continue;
        }

        const instance = await resolveInstance(supabase, row.whatsapp_instance_id, orgId);
        if (!instance) {
          await markFailed(supabase, row.id, "No active WhatsApp instance");
          if (jobId) await failJob(supabase, jobId, "No active WhatsApp instance");
          failed++;
          continue;
        }

        // Rate limit check
        const { data: rateCheck } = await supabase.rpc("check_whatsapp_rate_limit", {
          p_organization_id: orgId,
          p_instance_id: instance.id,
        });
        if (rateCheck?.[0] && !rateCheck[0].can_send) {
          console.log(`[pipe-rule-dispatch][${pipeType}] Rate limit exceeded, stopping`);
          if (jobId) await failJob(supabase, jobId, "Rate limit exceeded — reagendado automaticamente");
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
          await supabase.from("scheduled_pipe_messages").update({
            status: "sent",
            sent_at: new Date().toISOString(),
            error_message: null,
          }).eq("id", row.id);

          // Sync with chat
          try {
            const phone = lead.phone!.replace(/\D/g, "").replace(/^(?!55)/, "55");
            await supabase.from("whatsapp_messages").insert({
              organization_id: orgId,
              instance_id: instance.id,
              message_id: sendResult.messageId || `pipe_${row.id}_${Date.now()}`,
              remote_jid: `${phone}@s.whatsapp.net`,
              phone_number: phone,
              direction: "outgoing",
              message_type: isAudio ? "audio" : "text",
              content: isAudio ? null : messageContent,
              media_url: isAudio ? template.audio_url : null,
              status: "sent",
              lead_id: lead.id,
              timestamp: new Date().toISOString(),
            });
          } catch (chatSyncErr) {
            console.warn("[pipe-rule-dispatch] chat sync error:", chatSyncErr);
          }

          try {
            await supabase.rpc("increment_whatsapp_rate_limit", {
              p_organization_id: orgId,
              p_instance_id: instance.id,
            });
          } catch (_) { /* ignore */ }

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
              organization_id: orgId,
              action: "message_sent",
              description: `Mensagem enviada via funil ${pipeType}: ${template.name || "template"}`,
            });
          } catch (_) { /* ignore */ }

          // Track usage event (fire-and-forget)
          trackEvent({
            organizationId: orgId,
            eventType: "message_sent",
            entityType: "lead",
            entityId: lead.id,
            metadata: { pipe_type: pipeType, template_name: template.name, is_audio: isAudio },
          }).catch(() => {});

          sent++;
          if (jobId) await finishJob(supabase, jobId);
          console.log(`[pipe-rule-dispatch][${pipeType}] Sent to:`, lead.name, lead.phone);
        } else {
          await markFailed(supabase, row.id, sendResult.error ?? "Send failed");
          if (jobId) await failJob(supabase, jobId, sendResult.error ?? "Send failed");
          failed++;
        }

        // Delay between sends
        const { data: org } = await supabase.from("organizations").select("whatsapp_rate_limit").eq("id", orgId).single();
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

        await supabase.from("scheduled_pipe_messages").update({
          status: "waiting_response",
          waiting_since: now.toISOString(),
          wait_timeout_at: timeoutAt.toISOString(),
        }).eq("id", row.id);

        actionsExecuted++;
        if (jobId) await finishJob(supabase, jobId);
        console.log(`[pipe-rule-dispatch][${pipeType}] Wait response started for lead ${lead.name}`);

        try {
          await supabase.from("lead_history").insert({
            lead_id: lead.id,
            organization_id: orgId,
            action: "pipe_wait_response",
            description: `Aguardando resposta do lead no funil ${pipeType} (timeout: ${waitTimeoutMinutes}min)`,
          });
        } catch (_) { /* ignore */ }

      // =========================
      // ACTION: change_stage
      // =========================
      } else if (actionType === "change_stage") {
        const targetStageId = (row as any).target_stage_id;
        if (!targetStageId) {
          await markFailed(supabase, row.id, "No target_stage_id for change_stage action");
          if (jobId) await failJob(supabase, jobId, "No target_stage_id for change_stage action");
          failed++;
          continue;
        }

        // Resolve stage_key from pipeline_stages
        const { data: stageData } = await supabase
          .from("pipeline_stages")
          .select("stage_key, name")
          .eq("id", targetStageId)
          .single();

        if (!stageData?.stage_key) {
          await markFailed(supabase, row.id, "Target stage not found");
          if (jobId) await failJob(supabase, jobId, "Target stage not found");
          failed++;
          continue;
        }

        const pipeTable = `pipe_${pipeType}`;
        const { error: stageErr } = await supabase
          .from(pipeTable)
          .update({ status: stageData.stage_key })
          .eq("id", row.pipe_record_id);

        if (stageErr) {
          await markFailed(supabase, row.id, `change_stage failed: ${stageErr.message}`);
          if (jobId) await failJob(supabase, jobId, `change_stage failed: ${stageErr.message}`);
          failed++;
        } else {
          await supabase.from("scheduled_pipe_messages").update({
            status: "executed",
            sent_at: new Date().toISOString(),
          }).eq("id", row.id);

          // lead_history is registered automatically by PG trigger (trg_pipe_*_stage_change)

          actionsExecuted++;
          if (jobId) await finishJob(supabase, jobId);
          console.log(`[pipe-rule-dispatch][${pipeType}] Changed stage for lead ${lead.name} to ${stageData.name}`);
        }

      // =========================
      // ACTION: assign_sdr
      // =========================
      } else if (actionType === "assign_sdr") {
        const mode = (row as any).sdr_assignment_mode || "specific";
        let sdrId: string | null = (row as any).target_sdr_id || null;

        if (mode === "round_robin") {
          const { data: sdrs } = await supabase
            .from("team_members")
            .select("id, name")
            .eq("organization_id", orgId)
            .in("role", ["admin", "sdr", "member"]);

          if (sdrs && sdrs.length > 0) {
            const pipeTable = `pipe_${pipeType}`;
            const { data: sdrCounts } = await supabase
              .from(pipeTable)
              .select("responsible_id")
              .eq("organization_id", orgId)
              .not("responsible_id", "is", null);

            const countMap: Record<string, number> = {};
            for (const s of sdrs) countMap[s.id] = 0;
            for (const cl of sdrCounts || []) {
              if (cl.responsible_id && countMap[cl.responsible_id] !== undefined) {
                countMap[cl.responsible_id]++;
              }
            }

            let minCount = Infinity;
            for (const s of sdrs) {
              if ((countMap[s.id] ?? 0) < minCount) {
                minCount = countMap[s.id] ?? 0;
                sdrId = s.id;
              }
            }
          }
        }

        if (!sdrId) {
          await markFailed(supabase, row.id, "No SDR available for assignment");
          if (jobId) await failJob(supabase, jobId, "No SDR available for assignment");
          failed++;
          continue;
        }

        const pipeTable = `pipe_${pipeType}`;
        const { error: sdrErr } = await supabase
          .from(pipeTable)
          .update({ sdr_id: sdrId, responsible_id: sdrId })
          .eq("id", row.pipe_record_id);

        if (sdrErr) {
          await markFailed(supabase, row.id, `assign_sdr failed: ${sdrErr.message}`);
          if (jobId) await failJob(supabase, jobId, `assign_sdr failed: ${sdrErr.message}`);
          failed++;
        } else {
          await supabase.from("scheduled_pipe_messages").update({
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
              organization_id: orgId,
              action: "responsible_assigned",
              description: `Responsável atribuído automaticamente: ${sdrData?.name || sdrId} (${mode}) no funil ${pipeType}`,
            });
          } catch (_) { /* ignore */ }

          actionsExecuted++;
          if (jobId) await finishJob(supabase, jobId);
          console.log(`[pipe-rule-dispatch][${pipeType}] Assigned SDR ${sdrData?.name || sdrId} to lead ${lead.name}`);
        }

      // =========================
      // ACTION: cancel_sequence
      // =========================
      } else if (actionType === "cancel_sequence") {
        const { data: cancelled } = await supabase
          .from("scheduled_pipe_messages")
          .update({ status: "cancelled" })
          .eq("pipe_record_id", row.pipe_record_id)
          .eq("rule_id", row.rule_id)
          .eq("status", "scheduled")
          .neq("id", row.id)
          .select("id");

        await supabase.from("scheduled_pipe_messages").update({
          status: "executed",
          sent_at: new Date().toISOString(),
        }).eq("id", row.id);

        try {
          await supabase.from("lead_history").insert({
            lead_id: lead.id,
            organization_id: orgId,
            action: "pipe_sequence_cancelled",
            description: `Sequência cancelada automaticamente no funil ${pipeType} (${cancelled?.length ?? 0} pendentes canceladas)`,
          });
        } catch (_) { /* ignore */ }

        actionsExecuted++;
        if (jobId) await finishJob(supabase, jobId);
        console.log(`[pipe-rule-dispatch][${pipeType}] Cancelled sequence for lead ${lead.name}`);
      }
    } catch (rowError) {
      console.error(`[pipe-rule-dispatch][${pipeType}] Row error:`, row.id, rowError);
      try {
        await markFailed(supabase, row.id, rowError instanceof Error ? rowError.message : String(rowError));
      } catch (_) { /* ignore */ }
      if (jobId) await failJob(supabase, jobId, rowError instanceof Error ? rowError.message : String(rowError));
      failed++;
    }
  }

  const totalProcessed = rows.length;
  console.log(`[pipe-rule-dispatch][${pipeType}] Done: ${sent} sent, ${actionsExecuted} actions, ${failed} failed, ${timeoutsProcessed} timeouts`);
  return { pipe_type: pipeType, processed: totalProcessed, sent, failed, actions_executed: actionsExecuted, timeouts_processed: timeoutsProcessed };
}

// ============================================================
// Process expired wait_response timeouts
// ============================================================
async function processExpiredTimeouts(
  supabase: SupabaseClient,
  pipeType: string
): Promise<number> {
  const { data: expired, error } = await supabase
    .from("scheduled_pipe_messages")
    .select(`
      id, organization_id, pipe_type, rule_id, pipe_record_id, lead_id,
      whatsapp_instance_id, step_position,
      timeout_action, timeout_target_stage_id, timeout_template_id,
      leads(id, name, phone)
    `)
    .eq("pipe_type", pipeType)
    .eq("status", "waiting_response")
    .lte("wait_timeout_at", new Date().toISOString())
    .limit(BATCH_SIZE);

  if (error || !expired || expired.length === 0) return 0;

  let count = 0;
  for (const row of expired) {
    try {
      const orgId = row.organization_id as string;
      const lead = (row as any).leads as { id: string; name?: string; phone?: string } | null;
      const timeoutAction = row.timeout_action || "continue";

      await supabase.from("scheduled_pipe_messages").update({
        status: "timed_out",
        sent_at: new Date().toISOString(),
      }).eq("id", row.id);

      if (orgId && lead) {
        try {
          await supabase.from("lead_history").insert({
            lead_id: lead.id,
            organization_id: orgId,
            action: "pipe_wait_timeout",
            description: `Timeout de espera no funil ${pipeType}. Ação: ${timeoutAction}`,
          });
        } catch (_) { /* ignore */ }
      }

      if (timeoutAction === "change_stage" && row.timeout_target_stage_id) {
        const { data: stageData } = await supabase
          .from("pipeline_stages")
          .select("stage_key")
          .eq("id", row.timeout_target_stage_id)
          .single();

        if (stageData?.stage_key) {
          await supabase
            .from(`pipe_${pipeType}`)
            .update({ status: stageData.stage_key })
            .eq("id", row.pipe_record_id);
        }
        console.log(`[pipe-rule-dispatch][${pipeType}] Timeout: changed stage for lead ${lead?.name}`);

      } else if (timeoutAction === "send_template" && row.timeout_template_id && lead?.phone) {
        const { data: tmpl } = await supabase
          .from("campaign_templates")
          .select("id, name, content, message_type, audio_url")
          .eq("id", row.timeout_template_id)
          .single();

        if (tmpl && orgId) {
          const instance = await resolveInstance(supabase, row.whatsapp_instance_id, orgId);
          if (instance) {
            const isAudio = tmpl.message_type === "audio" && tmpl.audio_url;
            const timeVars = getTimeBasedVariables();
            const content = isAudio ? "[Áudio]" : replaceVariables(tmpl.content || "", {
              nome: lead.name || "você", empresa: "", email: "", telefone: lead.phone || "",
              origem: "", segmento: "", faturamento: "",
              saudacao: timeVars.saudacao, data: timeVars.data, hora: timeVars.hora,
            });

            const result = isAudio
              ? await sendWhatsAppAudio(instance.instance_name, lead.phone, tmpl.audio_url!)
              : await sendWhatsAppMessage(instance.instance_name, lead.phone, content);

            if (result.success) {
              try {
                const phone = lead.phone!.replace(/\D/g, "").replace(/^(?!55)/, "55");
                await supabase.from("whatsapp_messages").insert({
                  organization_id: orgId,
                  instance_id: instance.id,
                  message_id: result.messageId || `pipe_timeout_${row.id}_${Date.now()}`,
                  remote_jid: `${phone}@s.whatsapp.net`,
                  phone_number: phone,
                  direction: "outgoing",
                  message_type: isAudio ? "audio" : "text",
                  content: isAudio ? null : content,
                  media_url: isAudio ? tmpl.audio_url : null,
                  status: "sent",
                  lead_id: lead.id,
                  timestamp: new Date().toISOString(),
                });
              } catch (_) { /* ignore */ }
            }
            console.log(`[pipe-rule-dispatch][${pipeType}] Timeout: sent template to lead ${lead.name}`);
          }
        }

      } else if (timeoutAction === "cancel_sequence") {
        await supabase
          .from("scheduled_pipe_messages")
          .update({ status: "cancelled" })
          .eq("pipe_record_id", row.pipe_record_id)
          .eq("rule_id", row.rule_id)
          .eq("status", "scheduled");
        console.log(`[pipe-rule-dispatch][${pipeType}] Timeout: cancelled sequence for lead ${lead?.name}`);

      } else if (timeoutAction === "continue") {
        const nextPos = (row.step_position ?? 0) + 1;
        try {
          await supabase.rpc("schedule_pipe_rule_steps_from_position", {
            p_organization_id: orgId,
            p_pipe_type: pipeType,
            p_rule_id: row.rule_id,
            p_pipe_record_id: row.pipe_record_id,
            p_lead_id: row.lead_id,
            p_whatsapp_instance_id: row.whatsapp_instance_id,
            p_from_position: nextPos,
          });
        } catch (rpcErr) {
          console.warn(`[pipe-rule-dispatch][${pipeType}] schedule_pipe_rule_steps_from_position failed:`, rpcErr);
        }
        console.log(`[pipe-rule-dispatch][${pipeType}] Timeout: continuing from pos ${nextPos} for lead ${lead?.name}`);
      }

      count++;
    } catch (err) {
      console.error(`[pipe-rule-dispatch][${pipeType}] Timeout processing error:`, err);
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
  organizationId: string
): Promise<{ id: string; instance_name: string } | null> {
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
  await supabase.from("scheduled_pipe_messages").update({
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
