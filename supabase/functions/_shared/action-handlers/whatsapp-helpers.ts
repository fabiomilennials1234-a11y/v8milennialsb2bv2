/**
 * Shared helpers for WhatsApp action handlers.
 * Extracted from workflow-action-handler.ts to be reused by all send_whatsapp_* handlers.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getTimeBasedVariables } from "../time-variables.ts";
import { getPipeEntry } from "../pipeline-adapter.ts";

// ─── WhatsApp instance resolution ──────────────────────────────────────────

export async function getWhatsAppInstance(
  supabase: SupabaseClient,
  organizationId: string,
  instanceId?: string,
  leadId?: string | null,
): Promise<{ instanceId: string; instanceName: string; instance: any } | null> {
  let resolved: any = null;

  if (leadId) {
    const { resolveStrictInstanceForCaller, StrictWriteResolutionError } = await import(
      "../instance-write-guard.ts"
    );
    try {
      const strict = await resolveStrictInstanceForCaller(
        supabase as unknown as Parameters<typeof resolveStrictInstanceForCaller>[0],
        organizationId,
        leadId,
      );
      if (strict) resolved = strict;
    } catch (err) {
      if (err instanceof StrictWriteResolutionError) {
        console.warn(
          "[action-handler] strict_write_fallback lead=%s code=%s — using legacy instance resolution",
          leadId, err.errorCode,
        );
      } else {
        throw err;
      }
    }
  }

  if (!resolved && instanceId) {
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("*")
      .eq("id", instanceId)
      .maybeSingle();
    resolved = data;
  }

  if (!resolved) {
    // Org-default fallback. `status` is the raw provider-webhook signal and stays
    // frozen at "connected" when WhatsApp is logged out from another device — the
    // watchdog records the real verdict in `session_dead_since`. Excluding dead
    // sessions here mirrors the frontend's deriveInstanceStatus() and stops sends
    // from routing to a logged-out instance (Uazapi answers /send/text with 5xx).
    // Prefer the most recently connected live instance when an org has several.
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("*")
      .eq("organization_id", organizationId)
      // Meta isolation (cert Rule 2): never auto-pick a Meta number for a legacy send.
      .in("provider", ["uazapi", "evolution"])
      .in("status", ["open", "connected"])
      .is("session_dead_since", null)
      .order("last_connection_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    resolved = data;
  }

  if (!resolved) return null;
  return {
    instanceId: resolved.id,
    instanceName: resolved.instance_name,
    instance: resolved,
  };
}

// ─── Lead phone resolution ─────────────────────────────────────────────────

export async function getLeadPhone(supabase: SupabaseClient, leadId: string): Promise<string | null> {
  const { data } = await supabase.from("leads").select("phone").eq("id", leadId).maybeSingle();
  if (!data?.phone) return null;
  let phone = String(data.phone).replace(/\D/g, "");
  if (!phone.startsWith("55")) phone = "55" + phone;
  return phone;
}

// ─── Rate limit enforcement ────────────────────────────────────────────────

export async function enforceWhatsAppRateLimit(
  supabase: SupabaseClient,
  instanceId: string,
): Promise<void> {
  const MIN_INTERVAL_MS = 3000;
  const { data: lastMsg } = await supabase
    .from("whatsapp_messages")
    .select("timestamp")
    .eq("instance_id", instanceId)
    .eq("direction", "outgoing")
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastMsg?.timestamp) {
    const elapsed = Date.now() - new Date(lastMsg.timestamp).getTime();
    if (elapsed < MIN_INTERVAL_MS) {
      await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - elapsed));
    }
  }
}

// ─── Track ID builder ──────────────────────────────────────────────────────

export function buildTrackId(params: Record<string, unknown>): string {
  const executionId = params._executionId as string | undefined;
  const nodeId = params._nodeId as string | undefined;
  return `wf-${executionId || "unknown"}-${nodeId || "action"}`;
}

// ─── Variable substitution ─────────────────────────────────────────────────

export async function resolveVariables(
  supabase: SupabaseClient,
  leadId: string,
  template: string,
  executionContext?: Record<string, unknown>,
): Promise<string> {
  if (!template || !template.includes("{{")) return template;

  // First pass: resolve execution context variables
  if (executionContext) {
    for (const [key, val] of Object.entries(executionContext)) {
      if (val !== null && val !== undefined && typeof val !== "object") {
        template = template.replaceAll(`{{${key}}}`, String(val));
      }
    }
    if (!template.includes("{{")) return template;
  }

  const { data: lead } = await supabase
    .from("leads")
    .select(
      "name, company, email, phone, pipe_whatsapp, qualification_score, rating, " +
      "sdr_id, closer_id, responsible_id, organization_id, " +
      "faturamento, segment, urgency, notes, origin",
    )
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) return template;

  let result = template;

  const vars: Record<string, string> = {
    nome:       lead.name || "",
    empresa:    lead.company || "",
    email:      lead.email || "",
    telefone:   lead.phone || "",
    estagio:    lead.pipe_whatsapp || "",
    score:      String(lead.qualification_score ?? ""),
    rating:     String(lead.rating ?? ""),
    faturamento: String(lead.faturamento ?? ""),
    segmento:   lead.segment || "",
    urgencia:   lead.urgency || "",
    observacoes: lead.notes || "",
    origem:     lead.origin || "",
  };

  if (template.includes("{{saudacao}}") || template.includes("{{data_hoje}}") || template.includes("{{hora_atual}}")) {
    const timeVars = getTimeBasedVariables();
    vars.saudacao = timeVars.saudacao;
    vars.data_hoje = timeVars.data;
    vars.hora_atual = timeVars.hora;
  }

  if (template.includes("{{sdr}}") && lead.sdr_id) {
    const { data: member } = await supabase
      .from("team_members")
      .select("name")
      .eq("id", lead.sdr_id)
      .maybeSingle();
    vars.sdr = member?.name || "";
  }

  if (template.includes("{{closer}}") && lead.closer_id) {
    const { data: member } = await supabase
      .from("team_members")
      .select("name")
      .eq("id", lead.closer_id)
      .maybeSingle();
    vars.closer = member?.name || "";
  }

  if (
    (template.includes("{{responsavel}}") ||
      template.includes("{{responsavel_telefone}}")) &&
    lead.responsible_id
  ) {
    const { data: member } = await supabase
      .from("team_members")
      .select("name, phone")
      .eq("id", lead.responsible_id)
      .maybeSingle();
    vars.responsavel = (member as { name?: string; phone?: string })?.name || "";
    vars.responsavel_telefone = (member as { name?: string; phone?: string })?.phone || "";
  }

  if (template.includes("{{nome_empresa_crm}}") && lead.organization_id) {
    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", lead.organization_id)
      .maybeSingle();
    vars.nome_empresa_crm = org?.name || "";
  }

  if (template.includes("{{data_reuniao}}")) {
    const confEntry = await getPipeEntry(supabase, leadId, lead.organization_id, "confirmacao");
    const rawDate = (confEntry?.metadata as Record<string, unknown>)?.meeting_date as string | undefined;
    vars.data_reuniao = rawDate
      ? new Date(rawDate).toLocaleDateString("pt-BR")
      : "";
  }

  if (template.includes("{{valor_proposta}}")) {
    const propEntry = await getPipeEntry(supabase, leadId, lead.organization_id, "propostas");
    const saleValue = (propEntry?.metadata as Record<string, unknown>)?.sale_value as number | undefined;
    vars.valor_proposta = saleValue != null
      ? new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: "BRL",
        }).format(saleValue)
      : "";
  }

  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, val);
  }

  // Campaign variables
  if (template.includes("{{campanha_nome}}") || template.includes("{{campanha_estagio}}")) {
    const { data: campLead } = await supabase
      .from("campanha_leads")
      .select("campanha_id, stage_id, campanhas(name), campanha_stages(name)")
      .eq("lead_id", leadId)
      .limit(1)
      .maybeSingle();
    if (campLead) {
      vars.campanha_nome = (campLead as any).campanhas?.name || "";
      vars.campanha_estagio = (campLead as any).campanha_stages?.name || "";
    }
  }

  // AI variables
  if (template.includes("{{ai_")) {
    const { data: aiSummary } = await supabase
      .from("conversation_summaries")
      .select("summary, sentiment, lead_temperature, next_action")
      .eq("lead_id", leadId)
      .maybeSingle();
    if (aiSummary) {
      vars.ai_resumo = (aiSummary as any).summary || "";
      vars.ai_sentimento = (aiSummary as any).sentiment || "";
      vars.ai_temperatura = (aiSummary as any).lead_temperature || "";
      vars.ai_proxima_acao = (aiSummary as any).next_action || "";
    }
  }

  // Second pass for late-bound vars
  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, val);
  }

  // Custom fields: {{custom.campo}}
  const customMatches = result.match(/\{\{custom\.([^}]+)\}\}/g);
  if (customMatches) {
    const orgId = lead.organization_id;
    for (const match of customMatches) {
      const fieldName = match.replace("{{custom.", "").replace("}}", "");
      let val = "";
      if (orgId) {
        const { data: field } = await supabase
          .from("lead_custom_fields")
          .select("id")
          .eq("organization_id", orgId)
          .eq("field_name", fieldName)
          .maybeSingle();
        if (field) {
          const { data: fv } = await supabase
            .from("lead_custom_field_values")
            .select("value")
            .eq("lead_id", leadId)
            .eq("field_id", field.id)
            .maybeSingle();
          val = fv?.value || "";
        }
      }
      result = result.replaceAll(match, val);
    }
  }

  // Tags: {{tag.<name>}} → echoes the tag name if the Lead carries that tag, else "".
  const tagMatches = result.match(/\{\{tag\.([^}]+)\}\}/g);
  if (tagMatches) {
    const { data: leadTags } = await supabase
      .from("lead_tags")
      .select("tags(name)")
      .eq("lead_id", leadId);
    const tagNames = new Set(
      (leadTags || [])
        .map((lt: { tags?: { name?: string } | null }) => lt.tags?.name)
        .filter((n): n is string => Boolean(n)),
    );
    for (const match of tagMatches) {
      const tagName = match.replace("{{tag.", "").replace("}}", "");
      result = result.replaceAll(match, tagNames.has(tagName) ? tagName : "");
    }
  }

  return result;
}
