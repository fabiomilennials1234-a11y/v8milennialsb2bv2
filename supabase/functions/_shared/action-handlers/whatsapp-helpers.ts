/**
 * Shared helpers for WhatsApp action handlers.
 * Extracted from workflow-action-handler.ts to be reused by all send_whatsapp_* handlers.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getTimeBasedVariables } from "../time-variables.ts";
import { getPipeEntry } from "../pipeline-adapter.ts";
import { getWhatsAppProvider } from "../whatsapp-client.ts";
import { personalizationName, isPlaceholderLeadName, tidyEmptyVarGaps } from "../lead-name.ts";
import type { ActionResult } from "./types.ts";

// ─── WhatsApp instance resolution ──────────────────────────────────────────

/**
 * A WhatsApp instance is "live" (safe to send from) when the provider webhook
 * reports it connected AND the watchdog has not recorded a dead session.
 *
 * `status` alone is unreliable: it freezes at "connected" after a remote logout
 * from another device — the real verdict is `session_dead_since`, set by
 * whatsapp-session-watchdog. This mirrors the org-default fallback filter below
 * and the frontend's deriveInstanceStatus().
 */
export function isInstanceLive(
  inst: { status?: string | null; session_dead_since?: string | null } | null | undefined,
): boolean {
  if (!inst) return false;
  const connected = inst.status === "open" || inst.status === "connected";
  return connected && inst.session_dead_since == null;
}

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
    // Only honour the pinned instance if its session is actually live. A node can
    // pin an instance that was later logged out, or (Evolution→Uazapi migration)
    // deleted at the provider — sending to it is a guaranteed 5xx/404 that the
    // executor then retries into a noisy "outage". When the pin is dead, fall
    // through to the org-default live-instance fallback below instead of using it
    // blindly. (org 163874dd: 83 failed workflow execs/7d from a node pinned to an
    // extinct Evolution instance — this routes them to the org's one live one.)
    if (data && isInstanceLive(data)) {
      resolved = data;
    } else if (data) {
      console.warn(
        "[action-handler] pinned instance %s not live (status=%s, dead_since=%s) — falling back to org-default",
        instanceId,
        (data as { status?: string }).status,
        (data as { session_dead_since?: string }).session_dead_since,
      );
    }
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

// ─── Recipient reachability (WhatsApp existence pre-flight) ─────────────────

/**
 * Verify a recipient number is on WhatsApp BEFORE an automated outbound send.
 *
 * Why: automation first-contact (e.g. Meta Ads lead-form leads) often carries
 * mistyped / non-WhatsApp Brazilian mobiles. Uazapi answers /send/text with an
 * opaque HTTP 500 for those, which the workflow executor then retries 3× over
 * ~8 min before terminal-failing — a noisy "outage"-looking failure for what is
 * really bad recipient data. A cheap /chat/check up front turns that into a
 * clean, immediate, non-retryable skip.
 *
 * Safety contract (never drop a deliverable message):
 *  - Numbers we have ANY prior WhatsApp history with are assumed valid (skip the
 *    check entirely — fast path for established conversations).
 *  - Providers without a check capability (Evolution / Meta Cloud) are never
 *    gated.
 *  - ANY failure of the check itself (instance disconnected 500, RPC/network
 *    error) is treated as UNKNOWN → reachable, so the send still proceeds.
 *  - Only an explicit `isInWhatsapp === false` gates the send.
 */
export async function assertRecipientReachable(
  supabase: SupabaseClient,
  instance: unknown,
  phone: string,
  organizationId?: string,
): Promise<{ reachable: boolean; reason?: string }> {
  try {
    if (await hasPriorWhatsAppHistory(supabase, phone, organizationId)) {
      return { reachable: true };
    }
    const provider = await getWhatsAppProvider(instance as never, supabase);
    // await INSIDE the try so a checkNumbers rejection is caught by the guard.
    return await reachabilityFromProvider(provider, phone);
  } catch {
    // Unknown — never "not reachable". Fall through to the send.
    return { reachable: true };
  }
}

/**
 * Same as {@link assertRecipientReachable} but for callers that already hold a
 * resolved provider (outbound-sender, followup-sender) — avoids a redundant
 * provider/credential resolution.
 */
export async function assertRecipientReachableWithProvider(
  supabase: SupabaseClient,
  provider: { checkNumbers?: (n: string[]) => Promise<Array<{ number: string; isInWhatsapp: boolean }>> },
  phone: string,
  organizationId?: string,
): Promise<{ reachable: boolean; reason?: string }> {
  try {
    if (await hasPriorWhatsAppHistory(supabase, phone, organizationId)) {
      return { reachable: true };
    }
    return await reachabilityFromProvider(provider, phone);
  } catch {
    return { reachable: true };
  }
}

/** Fast path: a number we've already exchanged messages with is known-valid. */
async function hasPriorWhatsAppHistory(
  supabase: SupabaseClient,
  phone: string,
  organizationId?: string,
): Promise<boolean> {
  let query = supabase
    .from("whatsapp_messages")
    .select("id")
    .eq("phone_number", phone);
  // Org-scope the lookup for index selectivity + defense-in-depth (RLS already
  // isolates, but the explicit filter keeps the query tenant-pinned).
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data } = await query.limit(1).maybeSingle();
  return Boolean(data);
}

function reachabilityFromProvider(
  provider: { checkNumbers?: (n: string[]) => Promise<Array<{ number: string; isInWhatsapp: boolean }>> },
  phone: string,
): { reachable: boolean; reason?: string } | Promise<{ reachable: boolean; reason?: string }> {
  if (!provider?.checkNumbers) return { reachable: true };
  const digits = (s: string) => String(s).replace(/\D/g, "");
  return provider.checkNumbers([phone]).then((results) => {
    const verdict =
      results.find((r) => digits(r.number) === digits(phone)) ?? results[0];
    if (verdict && verdict.isInWhatsapp === false) {
      return { reachable: false, reason: "Recipient number is not on WhatsApp" };
    }
    return { reachable: true };
  });
}

/**
 * Thin wrapper for action handlers: returns a terminal (non-retryable) failure
 * ActionResult when the recipient is provably not on WhatsApp, or null to let
 * the send proceed.
 */
export async function recipientGate(
  supabase: SupabaseClient,
  instance: unknown,
  phone: string,
  organizationId?: string,
): Promise<ActionResult | null> {
  const verdict = await assertRecipientReachable(supabase, instance, phone, organizationId);
  if (verdict.reachable) return null;
  return {
    success: false,
    error: verdict.reason ?? "Recipient is not on WhatsApp",
    retryable: false,
  };
}

// ─── Send-failure classification (duplicate-safety) ────────────────────────

/**
 * Decide whether a failed WhatsApp send is safe to retry.
 *
 * A WhatsApp send is NOT idempotent: Uazapi answers `/send/*` with HTTP 500 or a
 * 15s timeout for some sends that were in fact delivered. Retrying those
 * ambiguous failures re-delivers the message — the SC Beauty "4× Bom dia"
 * incident (2026-07-07). So we only allow a retry when we can be SURE the
 * message never left: the breaker blocked it, no instance was resolved, or a
 * rate/credential guard tripped BEFORE the provider call. Anything else (5xx,
 * timeout, network) is ambiguous and treated as terminal to guarantee
 * at-most-once delivery.
 */
export function isRetryableSendFailure(error: string | undefined | null): boolean {
  const e = (error ?? "").toLowerCase();
  if (!e) return false;
  // Provably NOT delivered — send was blocked before reaching WhatsApp.
  if (e.includes("circuit breaker open")) return true;
  if (e.includes("instance not available") || e.includes("no_instance") ||
      e.includes("no whatsapp instance")) return true;
  if (e.includes("rate limit") || e.includes("rate_limited")) return true;
  if (e.includes("provider error") || e.includes("token is required")) return true;
  // Ambiguous (5xx / timeout / network): the message may already be delivered.
  // Retrying would duplicate it — fail terminally instead.
  return false;
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
    nome:       personalizationName(lead.name),
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

  // A suppressed placeholder name (see personalizationName) leaves a punctuation
  // gap like "Boa tarde , tudo bem?" — clean it only when we actually blanked one.
  if (isPlaceholderLeadName(lead.name)) result = tidyEmptyVarGaps(result);

  return result;
}
