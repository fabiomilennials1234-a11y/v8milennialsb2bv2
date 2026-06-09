import { withSentry } from "../_shared/sentry.ts";
/**
 * Worker: situation-based Copilot Follow-up (ADR-0006).
 *
 * Replaces the trigger-blind path for the new model: reads per-org
 * copilot_followup_situation_config (enabled Situations + org-classified
 * trigger_stage_keys), sources candidates per Situation, and lets the pure
 * decideFollowup brain decide whether/which touch to send. Base text only
 * (LLM refinement is a later slice). Slice 1 handles proposal_no_reply.
 *
 * Called by pg_cron (when scheduled) or manually with x-cron-secret.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logRuntime } from "../_shared/logger.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { getNextSendTime } from "../_shared/followupSchedule.ts";
import { sendFollowupMessage } from "../_shared/followup-sender.ts";
import { isCopilotCanceled } from "../_shared/copilot/cancellation.ts";
import { getTimeBasedVariables as getTimeVars } from "../_shared/time-variables.ts";
import { decideFollowup } from "../_shared/copilot/followup-decide.ts";
import { composeBaseText } from "../_shared/copilot/followup-compose.ts";
import { getSituationDefault } from "../_shared/copilot/followup-catalog.ts";
import type { EnabledSituation, SituationLeadState } from "../_shared/copilot/followup-situations.ts";
import type { StepLogEntry } from "../_shared/copilot/followup-cadence.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const BATCH_PER_SITUATION = 20;

interface SituationConfigRow {
  id: string;
  organization_id: string;
  situation_id: string;
  delay_hours: number;
  delay_minutes: number;
  trigger_stage_keys: string[];
  send_only_business_hours: boolean;
  business_hours_start: string;
  business_hours_end: string;
  send_days: string[];
  timezone: string;
}

// deno-lint-ignore no-explicit-any
type Supa = any;

async function resolveInstance(supabase: Supa, orgId: string): Promise<{ id: string | null; name: string | null }> {
  const { data: inst } = await supabase
    .from("whatsapp_instances")
    .select("id, instance_name")
    .eq("organization_id", orgId)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();
  return { id: inst?.id ?? null, name: inst?.instance_name ?? null };
}

/** Source candidates for a Situation. Slice 1: proposal_no_reply only. */
async function sourceCandidates(
  supabase: Supa,
  cfg: SituationConfigRow,
): Promise<Array<{ lead_id: string; propostasStage: string | null; lastInboundAt: string | null; lastOutboundAt: string | null }>> {
  if (cfg.situation_id !== "proposal_no_reply") return [];
  if (!cfg.trigger_stage_keys?.length) return [];

  const { data, error } = await supabase.rpc("get_proposal_no_reply_candidates", {
    p_organization_id: cfg.organization_id,
    p_stage_keys: cfg.trigger_stage_keys,
  });
  if (error || !data) return [];
  return data.map((r: Record<string, string | null>) => ({
    lead_id: r.lead_id as string,
    propostasStage: r.propostas_stage ?? null,
    lastInboundAt: r.last_inbound_at ?? null,
    lastOutboundAt: r.last_outbound_at ?? null,
  }));
}

Deno.serve(withSentry("process-followup-situations", async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const cronSecret = req.headers.get("x-cron-secret");
  if (!CRON_SECRET || !cronSecret || !timingSafeCompare(cronSecret, CRON_SECRET)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const now = new Date();
  let totalSent = 0;
  let totalSkipped = 0;

  const { data: configs, error: cfgErr } = await supabase
    .from("copilot_followup_situation_config")
    .select(
      "id, organization_id, situation_id, delay_hours, delay_minutes, trigger_stage_keys, send_only_business_hours, business_hours_start, business_hours_end, send_days, timezone",
    )
    .eq("is_active", true);

  if (cfgErr || !configs?.length) {
    return new Response(JSON.stringify({ sent: 0, skipped: 0 }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  for (const cfg of configs as SituationConfigRow[]) {
    const candidates = await sourceCandidates(supabase, cfg);
    if (!candidates.length) continue;

    const instance = await resolveInstance(supabase, cfg.organization_id);
    if (!instance.name) continue;

    const enabled: EnabledSituation[] = [{
      situationId: cfg.situation_id as EnabledSituation["situationId"],
      delayHours: cfg.delay_hours ?? 24,
      delayMinutes: cfg.delay_minutes ?? 0,
      triggerStageKeys: cfg.trigger_stage_keys ?? [],
    }];

    const ruleSchedule = {
      sendOnlyBusinessHours: cfg.send_only_business_hours ?? true,
      businessHoursStart: String(cfg.business_hours_start || "09:00").split(".")[0],
      businessHoursEnd: String(cfg.business_hours_end || "18:00").split(".")[0],
      sendDays: (cfg.send_days as string[]) || ["seg", "ter", "qua", "qui", "sex"],
      timezone: cfg.timezone || "America/Sao_Paulo",
    };

    const slice = candidates.slice(0, BATCH_PER_SITUATION);
    const leadIds = slice.map((c) => c.lead_id);

    const [{ data: leads }, { data: stepLogs }] = await Promise.all([
      supabase.from("leads").select("id, name, company, phone, email, origin, segment").in("id", leadIds),
      supabase
        .from("copilot_followup_step_log")
        .select("situation_config_id, lead_id, current_step, last_step_sent_at, completed")
        .eq("situation_config_id", cfg.id)
        .in("lead_id", leadIds),
    ]);

    const leadMap = new Map((leads || []).map((l: Record<string, unknown>) => [l.id, l]));
    const stepLogMap = new Map<string, StepLogEntry>();
    for (const log of (stepLogs || []) as StepLogEntry[]) stepLogMap.set(log.lead_id, log);

    for (const c of slice) {
      const lead = leadMap.get(c.lead_id) as Record<string, string | null> | undefined;
      if (!lead?.phone) {
        totalSkipped++;
        continue;
      }

      const leadState: SituationLeadState = {
        propostasStage: c.propostasStage,
        lastInboundAt: c.lastInboundAt,
        lastOutboundAt: c.lastOutboundAt,
      };
      const stepLog = stepLogMap.get(c.lead_id) ?? null;

      const decision = decideFollowup({ enabled, lead: leadState, stepLog, now });
      if (!decision.send) {
        totalSkipped++;
        continue;
      }

      // Defer outside business hours to the next window.
      const anchor = c.lastOutboundAt ? new Date(c.lastOutboundAt) : now;
      if (getNextSendTime(ruleSchedule, anchor).getTime() > now.getTime()) {
        totalSkipped++;
        continue;
      }

      // Honor the phone-keyed cancel / AI-disabled / human-pause gate (fail-closed).
      const cancel = await isCopilotCanceled(supabase, cfg.organization_id, lead.phone);
      if (cancel.canceled) {
        totalSkipped++;
        continue;
      }

      const timeVars = getTimeVars(now);
      const messageContent = composeBaseText(decision.step.message_template ?? "", {
        nome: lead.name || "você",
        empresa: lead.company || "",
        email: lead.email || "",
        telefone: lead.phone || "",
        origem: lead.origin || "",
        segmento: lead.segment || "",
        saudacao: timeVars.saudacao,
        data: timeVars.data,
        hora: timeVars.hora,
      });
      if (!messageContent.trim()) {
        totalSkipped++;
        continue;
      }

      const result = await sendFollowupMessage(supabase, {
        organizationId: cfg.organization_id,
        leadId: c.lead_id,
        ruleId: cfg.id, // telemetry trackId; situation config id
        phone: lead.phone,
        messageContent,
        instanceId: instance.id,
        instanceName: instance.name ?? undefined,
      });

      if (!result.success) {
        totalSkipped++;
        continue;
      }

      totalSent++;

      const maxOrder = Math.max(...getSituationDefault(cfg.situation_id as EnabledSituation["situationId"]).steps.map((s) => s.order));
      const completed = decision.step.order >= maxOrder;

      if (!stepLog) {
        await supabase.from("copilot_followup_step_log").insert({
          situation_config_id: cfg.id,
          lead_id: c.lead_id,
          organization_id: cfg.organization_id,
          current_step: decision.step.order,
          last_step_sent_at: now.toISOString(),
          completed,
          completed_reason: completed ? "all_steps_done" : null,
        });
      } else {
        await supabase
          .from("copilot_followup_step_log")
          .update({
            current_step: decision.step.order,
            last_step_sent_at: now.toISOString(),
            completed,
            completed_reason: completed ? "all_steps_done" : null,
          })
          .eq("situation_config_id", cfg.id)
          .eq("lead_id", c.lead_id);
      }
    }
  }

  await logRuntime({
    module: "followup",
    action: "situation_send",
    status: "success",
    payloadSnapshot: { sent: totalSent, skipped: totalSkipped },
  });

  return new Response(JSON.stringify({ sent: totalSent, skipped: totalSkipped }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}));
