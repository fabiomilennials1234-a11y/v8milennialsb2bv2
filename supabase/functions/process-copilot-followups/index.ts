/**
 * Worker: Processa regras de follow-up do Copilot (no_response)
 *
 * Leads que qualificam: última mensagem nossa, X tempo sem resposta,
 * filtros OK, max_followups não atingido, horário comercial OK.
 *
 * Chamado por pg_cron a cada 5 min ou manualmente com x-cron-secret.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { getNextSendTime } from "../_shared/followupSchedule.ts";
import { sendFollowupMessage } from "../_shared/followup-sender.ts";
import { AgentEngine } from "../agent-message/agent-engine.ts";
import { OpenRouterClient } from "../agent-message/openrouter-client.ts";

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

function getTimeVars(now: Date): { saudacao: string; data: string; hora: string } {
  const tz = "America/Sao_Paulo";
  const hour = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).format(now),
    10
  );
  let saudacao = "bom dia";
  if (hour >= 12 && hour < 18) saudacao = "boa tarde";
  else if (hour >= 18 || hour < 5) saudacao = "boa noite";
  const data = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(now);
  const hora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return { saudacao, data, hora };
}

Deno.serve(async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const cronSecret = req.headers.get("x-cron-secret");
  if (CRON_SECRET && cronSecret !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const now = new Date();
  let totalSent = 0;
  let totalSkipped = 0;

  const { data: rules, error: rulesErr } = await supabase
    .from("copilot_agent_followup_rules")
    .select(
      `
      id,
      agent_id,
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
      copilot_agents(organization_id, whatsapp_instance_id)
    `
    )
    .eq("is_active", true)
    .eq("trigger_type", "no_response")
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

    let sentThisRule = 0;
    for (const c of candidates.slice(0, BATCH_PER_RULE)) {
      const qualifiedAt = new Date(c.last_outgoing_at);
      const sendAt = getNextSendTime(ruleSchedule, qualifiedAt);
      if (sendAt.getTime() > now.getTime()) {
        totalSkipped++;
        continue;
      }

      const { data: lead, error: leadErr } = await supabase
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
          lead_tags(tag:tags(name))
        `)
        .eq("id", c.lead_id)
        .single();

      if (leadErr || !lead?.phone) {
        totalSkipped++;
        continue;
      }

      const leadTagNames = ((lead as any).lead_tags || [])
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
      if (filterPipes.length > 0 && !filterPipes.includes("pipe_whatsapp")) {
        totalSkipped++;
        continue;
      }
      if (filterStages.length > 0) {
        const stage = lead.pipe_whatsapp || "";
        if (!filterStages.includes(stage)) {
          totalSkipped++;
          continue;
        }
      }

      const { count, error: countErr } = await supabase
        .from("copilot_followup_execution_log")
        .select("*", { count: "exact", head: true })
        .eq("lead_id", c.lead_id)
        .eq("rule_id", rule.id);

      if (countErr || (count ?? 0) >= (rule.max_followups ?? 3)) {
        totalSkipped++;
        continue;
      }

      // Gerar mensagem via AgentEngine (item #3) ou fallback para template fixo
      let messageContent: string;
      if (OPENROUTER_API_KEY) {
        try {
          const openRouter = new OpenRouterClient(OPENROUTER_API_KEY);
          const engine = new AgentEngine(supabase, openRouter, orgId);
          messageContent = await engine.generateFollowupMessage(lead.id, {
            followupCount: count ?? 0,
            ruleTemplate: rule.message_template || undefined,
            followupStyle: rule.followup_style || undefined,
          });
          console.log(`[Followup] AgentEngine gerou mensagem para lead ${lead.id}: "${messageContent.substring(0, 60)}..."`);
        } catch (genErr) {
          console.warn('[Followup] AgentEngine falhou, usando template fixo:', genErr);
          const timeVars = getTimeVars(now);
          const tmpl = rule.message_template || "Oi {nome}! Vi que ficamos sem conversar. Posso te ajudar em algo?";
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
        const tmpl = rule.message_template || "Oi {nome}! Vi que ficamos sem conversar. Posso te ajudar em algo?";
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
      }
    }
  }

  return new Response(
    JSON.stringify({ sent: totalSent, skipped: totalSkipped }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
