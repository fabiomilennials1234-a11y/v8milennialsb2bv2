import { withErrorBoundary } from '../_shared/error-boundary.ts';
import { getTimeBasedVariables as getTimeVars } from '../_shared/time-variables.ts';
import { getPipeEntriesByLeads } from "../_shared/pipeline-adapter.ts";
/**
 * Worker: Processa regras de follow-up do Copilot
 *
 * Supports:
 * - Single-shot no_response rules (existing behavior, unchanged)
 * - Multi-step cadence rules (sequence_steps JSONB)
 * - New trigger types: after_qualification, after_meeting_scheduled,
 *   post_sale, proposal_no_response
 *
 * Chamado por pg_cron a cada 5 min ou manualmente com x-cron-secret.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logRuntime } from "../_shared/logger.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { getNextSendTime } from "../_shared/followupSchedule.ts";
import { sendFollowupMessage } from "../_shared/followup-sender.ts";
import { AgentEngine } from "../agent-message/agent-engine.ts";
import { OpenRouterClient } from "../agent-message/openrouter-client.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { isCopilotCanceled } from "../_shared/copilot/cancellation.ts";
import { getNextCadenceStep, type CadenceStep, type StepLogEntry } from "../_shared/copilot/followup-cadence.ts";
import { isLeadEligibleForTrigger, type TriggerLead } from "../_shared/copilot/followup-triggers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const BATCH_PER_RULE = 20;

function replaceVariables(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{${k}\\}`, "gi"), v ?? "");
  }
  return out.replace(/\{[^}]+\}/g, "").trim();
}

// getTimeVars is now imported from _shared/time-variables.ts (aliased from getTimeBasedVariables)

Deno.serve(withErrorBoundary('process-copilot-followups', async (req) => {
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

  const SUPPORTED_TRIGGERS = [
    "no_response",
    "after_qualification",
    "after_meeting_scheduled",
    "post_sale",
    "proposal_no_response",
  ];

  const { data: rules, error: rulesErr } = await supabase
    .from("copilot_agent_followup_rules")
    .select(
      `
      id,
      agent_id,
      trigger_type,
      trigger_delay_hours,
      trigger_delay_minutes,
      max_followups,
      filter_tags,
      filter_tags_exclude,
      filter_origins,
      filter_pipes,
      filter_stages,
      message_template,
      use_last_context,
      followup_style,
      send_only_business_hours,
      business_hours_start,
      business_hours_end,
      send_days,
      timezone,
      sequence_steps,
      copilot_agents(organization_id, whatsapp_instance_id)
    `
    )
    .eq("is_active", true)
    .in("trigger_type", SUPPORTED_TRIGGERS)
    .order("priority", { ascending: false });

  if (rulesErr || !rules?.length) {
    return new Response(
      JSON.stringify({ processed: 0, sent: 0, skipped: 0 }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  for (const rule of rules) {
    const agent = (rule as any).copilot_agents;
    const orgId = agent?.organization_id;
    const instanceId = agent?.whatsapp_instance_id;
    if (!orgId) continue;

    const { data: candidates, error: rpcErr } = await supabase.rpc("get_followup_eligible_leads", {
      p_organization_id: orgId,
      p_trigger_delay_hours: rule.trigger_delay_hours ?? 24,
      p_trigger_delay_minutes: rule.trigger_delay_minutes ?? 0,
    });

    if (rpcErr || !candidates?.length) continue;

    let instanceName: string | null = null;
    if (instanceId) {
      const { data: inst } = await supabase
        .from("whatsapp_instances")
        .select("instance_name")
        .eq("id", instanceId)
        .single();
      instanceName = inst?.instance_name ?? null;
    }
    if (!instanceName) {
      const { data: inst } = await supabase
        .from("whatsapp_instances")
        .select("instance_name")
        .eq("organization_id", orgId)
        // Meta isolation (cert Rule 2): never auto-pick a Meta number for a legacy send.
        .in("provider", ["uazapi", "evolution"])
        .eq("status", "open")
        .limit(1)
        .maybeSingle();
      instanceName = inst?.instance_name ?? null;
    }
    if (!instanceName) continue;

    const ruleSchedule = {
      sendOnlyBusinessHours: rule.send_only_business_hours ?? true,
      businessHoursStart: String(rule.business_hours_start || "09:00").split(".")[0],
      businessHoursEnd: String(rule.business_hours_end || "18:00").split(".")[0],
      sendDays: (rule.send_days as string[]) || ["seg", "ter", "qua", "qui", "sex"],
      timezone: rule.timezone || "America/Sao_Paulo",
    };

    const filterTags = (rule.filter_tags as string[]) || [];
    const filterTagsExclude = (rule.filter_tags_exclude as string[]) || [];
    const filterOrigins = (rule.filter_origins as string[]) || [];
    const filterPipes = (rule.filter_pipes as string[]) || [];
    const filterStages = (rule.filter_stages as string[]) || [];

    const triggerType = (rule as any).trigger_type || "no_response";
    const sequenceSteps = (rule as any).sequence_steps as CadenceStep[] | null;
    const hasCadence = Array.isArray(sequenceSteps) && sequenceSteps.length > 0;

    const candidateSlice = candidates.slice(0, BATCH_PER_RULE);
    const leadIds = candidateSlice.map((c: any) => c.lead_id);

    // Batch: buscar todos os leads, pipe entries, contagens e step logs de uma vez
    const stepLogPromise = hasCadence
      ? supabase
          .from("copilot_followup_step_log")
          .select("rule_id, lead_id, current_step, last_step_sent_at, completed")
          .eq("rule_id", rule.id)
          .in("lead_id", leadIds)
      : Promise.resolve({ data: [] });

    const [{ data: allLeads }, { data: execRows }, confEntries, propEntries, { data: stepLogs }] = await Promise.all([
      supabase
        .from("leads")
        .select(`
          id,
          name,
          company,
          phone,
          email,
          origin,
          segment,
          pipe_whatsapp,
          ai_disabled,
          lead_tags(tag:tags(name)),
          upsell_clients(tipo_cliente_tempo, gestao_stage),
          campanha_leads(stage_id, campanha_stages(name))
        `)
        .in("id", leadIds),
      supabase
        .from("copilot_followup_execution_log")
        .select("lead_id")
        .eq("rule_id", rule.id)
        .in("lead_id", leadIds),
      getPipeEntriesByLeads(supabase, leadIds, orgId, "confirmacao"),
      getPipeEntriesByLeads(supabase, leadIds, orgId, "propostas"),
      stepLogPromise,
    ]);

    // Build lookup maps for pipe entries
    const confByLead = new Map(confEntries.map(e => [e.lead_id, { status: e.stage_key }]));
    const propByLead = new Map(propEntries.map(e => [e.lead_id, { status: e.stage_key }]));

    // Attach pipe data to leads for downstream filter compatibility
    const allLeadsWithPipes = (allLeads || []).map((l: any) => ({
      ...l,
      pipe_confirmacao: confByLead.get(l.id) ? [confByLead.get(l.id)] : [],
      pipe_propostas: propByLead.get(l.id) ? [propByLead.get(l.id)] : [],
    }));

    const leadMap = new Map(allLeadsWithPipes.map((l: any) => [l.id, l]));
    const execCountMap = new Map<string, number>();
    for (const row of execRows || []) {
      execCountMap.set(row.lead_id, (execCountMap.get(row.lead_id) || 0) + 1);
    }

    // Step log map for cadence rules
    const stepLogMap = new Map<string, StepLogEntry>();
    for (const log of (stepLogs || []) as StepLogEntry[]) {
      stepLogMap.set(log.lead_id, log);
    }

    let sentThisRule = 0;
    for (const c of candidateSlice) {
      const qualifiedAt = new Date(c.last_outgoing_at);
      const sendAt = getNextSendTime(ruleSchedule, qualifiedAt);
      if (sendAt.getTime() > now.getTime()) {
        totalSkipped++;
        continue;
      }

      const lead = leadMap.get(c.lead_id) as any;

      if (!lead?.phone) {
        totalSkipped++;
        continue;
      }

      // F5c 2026-04-26: skip leads com copilot disabled via fonte canônica
      // (phone_ai_preferences > leads.ai_disabled fallback). Cobre case onde
      // user toggla via toggle_phone_ai sem lead — preference muda mas
      // lead.ai_disabled denormalizado pode estar stale.
      //
      // orgId vem da junção copilot_agents (linha 96); rule.organization_id
      // não é selecionado na query, então era undefined — isCopilotCanceled
      // com orgId undefined retorna fail-open (canceled:false), virando no-op.
      const followupCancel = await isCopilotCanceled(supabase, orgId, lead.phone);
      if (followupCancel.canceled) {
        totalSkipped++;
        continue;
      }

      const leadTagNames = (lead.lead_tags || [])
        .map((lt: any) => lt.tag?.name)
        .filter(Boolean);

      if (filterTags.length > 0) {
        const hasAll = filterTags.every((t) => leadTagNames.includes(t));
        if (!hasAll) {
          totalSkipped++;
          continue;
        }
      }
      if (filterTagsExclude.length > 0) {
        const hasExcluded = filterTagsExclude.some((t) => leadTagNames.includes(t));
        if (hasExcluded) {
          totalSkipped++;
          continue;
        }
      }
      if (filterOrigins.length > 0 && !filterOrigins.includes(lead.origin || "")) {
        totalSkipped++;
        continue;
      }
      if (filterPipes.length > 0) {
        // Verificar se o lead está em algum dos pipes filtrados (todos os funis)
        const upsellClient = (lead as any).upsell_clients?.[0] || (lead as any).upsell_clients || null;
        const confirmacao = (lead as any).pipe_confirmacao?.[0] || (lead as any).pipe_confirmacao || null;
        const propostas = (lead as any).pipe_propostas?.[0] || (lead as any).pipe_propostas || null;
        const campanhaLead = (lead as any).campanha_leads?.[0] || (lead as any).campanha_leads || null;
        const leadPipes: string[] = [];
        if (lead.pipe_whatsapp) leadPipes.push("whatsapp");
        if (upsellClient?.tipo_cliente_tempo) leadPipes.push("upsell_base");
        if (upsellClient?.gestao_stage) leadPipes.push("upsell_gestao");
        if (confirmacao?.status) leadPipes.push("confirmacao");
        if (propostas?.status) leadPipes.push("propostas");
        if (campanhaLead) leadPipes.push("campanha");
        const matchesPipe = filterPipes.some((fp: string) => leadPipes.includes(fp));
        if (!matchesPipe) {
          totalSkipped++;
          continue;
        }
      }
      if (filterStages.length > 0) {
        const upsellClient = (lead as any).upsell_clients?.[0] || (lead as any).upsell_clients || null;
        const confirmacao = (lead as any).pipe_confirmacao?.[0] || (lead as any).pipe_confirmacao || null;
        const propostas = (lead as any).pipe_propostas?.[0] || (lead as any).pipe_propostas || null;
        const campanhaLead = (lead as any).campanha_leads?.[0] || (lead as any).campanha_leads || null;
        const allStages = [
          lead.pipe_whatsapp || "",
          upsellClient?.tipo_cliente_tempo || "",
          upsellClient?.gestao_stage || "",
          confirmacao?.status || "",
          propostas?.status || "",
          (campanhaLead as any)?.campanha_stages?.name || "",
        ].filter(Boolean);
        if (!filterStages.some((fs: string) => allStages.includes(fs))) {
          totalSkipped++;
          continue;
        }
      }

      // ---- Trigger eligibility for non-no_response types ----
      if (triggerType !== "no_response") {
        const confirmacaoEntry = (lead as any).pipe_confirmacao?.[0] || (lead as any).pipe_confirmacao || null;
        const propostasEntry = (lead as any).pipe_propostas?.[0] || (lead as any).pipe_propostas || null;
        const triggerLead: TriggerLead = {
          qualification_score: (lead as any).qualification_score,
          qualified_at: (lead as any).qualified_at,
          pipe_stages: {
            ...(confirmacaoEntry?.status ? { confirmacao: confirmacaoEntry.status } : {}),
            ...(propostasEntry?.status ? { propostas: propostasEntry.status } : {}),
          },
          last_message_at: c.last_outgoing_at,
          stage_changed_at: (lead as any).stage_changed_at,
        };
        const triggerCheck = isLeadEligibleForTrigger({
          triggerType,
          lead: triggerLead,
          triggerDelayHours: rule.trigger_delay_hours ?? 24,
          triggerDelayMinutes: rule.trigger_delay_minutes ?? 0,
          now,
        });
        if (!triggerCheck.eligible) {
          totalSkipped++;
          continue;
        }
      }

      // ---- Cadence vs single-shot ----
      let activeStep: CadenceStep | null = null;
      let effectiveTemplate = rule.message_template;
      let effectiveStyle = rule.followup_style;
      let stepLogForLead: StepLogEntry | null = null;

      if (hasCadence) {
        stepLogForLead = stepLogMap.get(c.lead_id) || null;
        const cadenceResult = getNextCadenceStep({
          sequenceSteps: sequenceSteps!,
          stepLog: stepLogForLead,
          now,
        });
        if (!cadenceResult.shouldFire) {
          totalSkipped++;
          continue;
        }
        activeStep = cadenceResult.step;
        // Override template/style from cadence step if present
        if (activeStep?.message_template) {
          effectiveTemplate = activeStep.message_template;
        }
        if (activeStep?.style) {
          effectiveStyle = activeStep.style;
        }
      } else {
        // Single-shot: use execution count as guard
        const count = execCountMap.get(c.lead_id) || 0;
        if (count >= (rule.max_followups ?? 3)) {
          totalSkipped++;
          continue;
        }
      }

      const count = execCountMap.get(c.lead_id) || 0;

      // Gerar mensagem via AgentEngine ou fallback para template fixo
      let messageContent: string;
      if (OPENROUTER_API_KEY) {
        try {
          const openRouter = new OpenRouterClient(OPENROUTER_API_KEY);
          const engine = new AgentEngine(supabase, openRouter, orgId);
          messageContent = await engine.generateFollowupMessage(lead.id, {
            followupCount: count ?? 0,
            ruleTemplate: effectiveTemplate || undefined,
            followupStyle: effectiveStyle || undefined,
          });
          console.log(`[Followup] AgentEngine gerou mensagem para lead ${lead.id}: "${messageContent.substring(0, 60)}..."`);
        } catch (genErr) {
          console.warn('[Followup] AgentEngine falhou, usando template fixo:', genErr);
          const timeVars = getTimeVars(now);
          const tmpl = effectiveTemplate || "Oi {nome}! Vi que ficamos sem conversar. Posso te ajudar em algo?";
          messageContent = replaceVariables(tmpl, {
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
        }
      } else {
        const timeVars = getTimeVars(now);
        const tmpl = effectiveTemplate || "Oi {nome}! Vi que ficamos sem conversar. Posso te ajudar em algo?";
        messageContent = replaceVariables(tmpl, {
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
      }

      const result = await sendFollowupMessage(supabase, {
        organizationId: orgId,
        leadId: c.lead_id,
        ruleId: rule.id,
        phone: lead.phone,
        messageContent,
        instanceId,
        instanceName,
      });

      if (result.success) {
        totalSent++;
        sentThisRule++;

        // ---- Track cadence step progress ----
        if (hasCadence && activeStep) {
          const newStep = activeStep.order;
          const allStepsDone = newStep >= Math.max(...sequenceSteps!.map(s => s.order));

          if (!stepLogForLead) {
            // First step — insert
            await supabase
              .from("copilot_followup_step_log")
              .insert({
                rule_id: rule.id,
                lead_id: c.lead_id,
                current_step: newStep,
                last_step_sent_at: now.toISOString(),
                completed: allStepsDone,
              });
          } else {
            // Subsequent step — update
            await supabase
              .from("copilot_followup_step_log")
              .update({
                current_step: newStep,
                last_step_sent_at: now.toISOString(),
                completed: allStepsDone,
              })
              .eq("rule_id", rule.id)
              .eq("lead_id", c.lead_id);
          }
        }
      }
    }
  }

  await logRuntime({
    module: "followup",
    action: "copilot_send",
    status: "success",
    payloadSnapshot: { sent: totalSent, skipped: totalSkipped },
  });

  return new Response(
    JSON.stringify({ sent: totalSent, skipped: totalSkipped }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}));
