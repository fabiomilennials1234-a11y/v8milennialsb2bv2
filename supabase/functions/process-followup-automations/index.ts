/**
 * Worker: Processa regras de follow-up baseadas em tempo
 *
 * Tipos de gatilho:
 * - no_response_from_team: equipe não respondeu mensagem do lead
 * - no_response_from_lead: lead não respondeu mensagem da equipe
 * - not_confirmed: lead não confirmou presença na reunião
 *
 * Chamado por pg_cron a cada 5 min ou manualmente com x-cron-secret.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const BATCH_LIMIT = 50;

interface AutomationRule {
  id: string;
  trigger_type: string;
  pipe_type: string;
  title_template: string;
  description_template: string | null;
  trigger_delay_hours: number;
  trigger_delay_minutes: number;
  priority: string;
  max_triggers_per_lead: number;
  copilot_can_handle: boolean;
  organization_id: string;
  filter_stages: string[] | null;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: withSecurityHeaders(corsHeaders) });
  }

  // Verificar autenticação do cron
  const cronSecret = req.headers.get("x-cron-secret");
  if (CRON_SECRET && cronSecret !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" }),
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const stats = { processed: 0, created: 0, skipped: 0, errors: 0 };

  try {
    // Buscar todas as regras baseadas em tempo ativas
    const { data: rules, error: rulesError } = await supabase
      .from("follow_up_automations")
      .select("*")
      .neq("trigger_type", "stage_change")
      .eq("is_active", true)
      .not("organization_id", "is", null);

    if (rulesError) throw rulesError;
    if (!rules || rules.length === 0) {
      return new Response(JSON.stringify({ message: "No active time-based rules", stats }), {
        headers: withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" }),
      });
    }

    for (const rule of rules as AutomationRule[]) {
      try {
        await processRule(supabase, rule, stats);
      } catch (err) {
        console.error(`Error processing rule ${rule.id}:`, err);
        stats.errors++;
      }
    }

    return new Response(JSON.stringify({ message: "OK", stats }), {
      headers: withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" }),
    });
  } catch (err) {
    console.error("Fatal error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" }),
    });
  }
});

async function processRule(
  supabase: ReturnType<typeof createClient>,
  rule: AutomationRule,
  stats: { processed: number; created: number; skipped: number; errors: number }
) {
  let eligibleLeads: { lead_id: string }[] = [];

  if (rule.trigger_type === "no_response_from_team") {
    const { data, error } = await supabase.rpc("get_leads_team_no_response", {
      p_organization_id: rule.organization_id,
      p_delay_hours: rule.trigger_delay_hours,
      p_delay_minutes: rule.trigger_delay_minutes,
      p_pipe_type: rule.pipe_type,
      p_filter_stages: rule.filter_stages,
    });
    if (error) throw error;
    eligibleLeads = data || [];
  } else if (rule.trigger_type === "no_response_from_lead") {
    const { data, error } = await supabase.rpc("get_leads_no_response_from_lead", {
      p_organization_id: rule.organization_id,
      p_delay_hours: rule.trigger_delay_hours,
      p_delay_minutes: rule.trigger_delay_minutes,
      p_pipe_type: rule.pipe_type,
      p_filter_stages: rule.filter_stages,
    });
    if (error) throw error;
    eligibleLeads = data || [];
  } else if (rule.trigger_type === "not_confirmed") {
    const { data, error } = await supabase.rpc("get_leads_not_confirmed", {
      p_organization_id: rule.organization_id,
      p_hours_before_meeting: rule.trigger_delay_hours,
      p_minutes_before_meeting: rule.trigger_delay_minutes,
      p_filter_stages: rule.filter_stages,
    });
    if (error) throw error;
    eligibleLeads = (data || []).map((d: { lead_id: string }) => ({ lead_id: d.lead_id }));
  }

  // Limitar batch
  const batch = eligibleLeads.slice(0, BATCH_LIMIT);

  for (const candidate of batch) {
    stats.processed++;

    try {
      // Verificar se já atingiu max_triggers_per_lead
      const { count: logCount } = await supabase
        .from("followup_automation_log")
        .select("*", { count: "exact", head: true })
        .eq("lead_id", candidate.lead_id)
        .eq("automation_id", rule.id);

      if ((logCount ?? 0) >= rule.max_triggers_per_lead) {
        stats.skipped++;
        continue;
      }

      // Verificar se já existe follow_up ativo (não concluído, não arquivado) para este lead + regra
      const { data: existingActive } = await supabase
        .from("follow_ups")
        .select("id")
        .eq("lead_id", candidate.lead_id)
        .eq("organization_id", rule.organization_id)
        .eq("is_automated", true)
        .eq("title", rule.title_template)
        .is("completed_at", null)
        .is("archived_at", null)
        .limit(1);

      if (existingActive && existingActive.length > 0) {
        stats.skipped++;
        continue;
      }

      // Buscar responsável do lead
      const { data: lead } = await supabase
        .from("leads")
        .select("id, name, sdr_id, closer_id")
        .eq("id", candidate.lead_id)
        .single();

      if (!lead) {
        stats.skipped++;
        continue;
      }

      // Determinar responsável baseado no pipe
      let assignedTo: string | null = null;
      if (rule.pipe_type === "whatsapp") {
        assignedTo = lead.sdr_id;
      } else if (rule.pipe_type === "confirmacao" || rule.pipe_type === "propostas") {
        assignedTo = lead.closer_id || lead.sdr_id;
      }

      // Criar follow_up
      const dueDate = new Date();
      const { data: followUp, error: insertError } = await supabase
        .from("follow_ups")
        .insert({
          lead_id: candidate.lead_id,
          assigned_to: assignedTo,
          title: rule.title_template,
          description: rule.description_template,
          due_date: dueDate.toISOString(),
          priority: rule.priority,
          source_pipe: rule.pipe_type,
          is_automated: true,
          organization_id: rule.organization_id,
        })
        .select("id")
        .single();

      if (insertError) {
        console.error(`Error creating follow-up for lead ${candidate.lead_id}:`, insertError);
        stats.errors++;
        continue;
      }

      // Registrar no log para controle de duplicatas
      await supabase.from("followup_automation_log").insert({
        automation_id: rule.id,
        lead_id: candidate.lead_id,
        follow_up_id: followUp?.id,
        organization_id: rule.organization_id,
      });

      stats.created++;
      console.log(
        `Created follow-up for lead ${candidate.lead_id} | rule: ${rule.trigger_type} | title: ${rule.title_template}`
      );
    } catch (err) {
      console.error(`Error processing lead ${candidate.lead_id}:`, err);
      stats.errors++;
    }
  }
}
