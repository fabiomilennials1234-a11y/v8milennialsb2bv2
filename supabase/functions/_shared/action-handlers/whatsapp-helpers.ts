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
import {
  resolveRoutedInstance,
  isInstanceLive,
  type RoutedInstance,
  type RoutingNodeConfig,
} from "../instance-routing.ts";

/** Reexport: a definição de "instância viva" mora em `_shared/instance-routing.ts`. */
export { isInstanceLive };

// ─── WhatsApp instance resolution ──────────────────────────────────────────

/**
 * Resultado da resolução, no formato que o handler já devolve. Falha vira
 * `ActionResult` não-retentável, nunca exceção: o executor lê `retryable` para
 * decidir se reenvia, e uma exceção atravessando a fronteira do handler
 * quebraria esse contrato.
 */
export type InstanceResolution =
  | { ok: true; instanceId: string; instanceName: string; instance: RoutedInstance }
  | { ok: false; failure: ActionResult };

/**
 * Resolve a Instance de saída do nó, obedecendo a Instance Routing Policy
 * declarada nele (ADR-0025).
 *
 * Antes daqui a escolha era do banco: as Instances vivas da Organization
 * ordenadas por `last_connection_at`, e a primeira levava. Determinístico, mas
 * sem nenhuma relação com o Lead — ele escrevia para um número e recebia a
 * automação de outro, e a escolha mudava sozinha quando outro número
 * reconectava. A regra agora vive em `_shared/instance-routing.ts` e é a mesma
 * para os onze pontos de envio do Workflow.
 *
 * Toda falha é **não-retentável**: sem número resolvido, tentar de novo em 30s
 * não muda nada, e contra uma sessão morta o Uazapi responde 5xx a cada
 * `/send/text` — três retentativas viram a tempestade documentada no M1.
 */
export async function getWhatsAppInstance(
  supabase: SupabaseClient,
  organizationId: string,
  node: RoutingNodeConfig | undefined,
  leadId?: string | null,
): Promise<InstanceResolution> {
  const resolved = await resolveRoutedInstance(supabase, {
    organizationId,
    leadId: leadId ?? null,
    node: node ?? {},
  });

  if (!resolved.ok) {
    return {
      ok: false,
      failure: { success: false, error: resolved.message, retryable: false },
    };
  }

  return {
    ok: true,
    instanceId: resolved.instance.id,
    instanceName: resolved.instance.instance_name,
    instance: resolved.instance,
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
    // Uma única string literal, não concatenação: `"a, " + "b"` tem tipo `string`
    // em TypeScript (o compilador não junta literais com `+`), e o parser de
    // tipos do postgrest-js só sabe ler um literal. Com `string` ele devolve
    // `ParserError`, a linha vira `GenericStringError` e TODO acesso a coluna
    // aqui embaixo virava um TS2339. O texto enviado ao servidor é idêntico.
    .select("name, company, email, phone, pipe_whatsapp, qualification_score, rating, sdr_id, closer_id, responsible_id, organization_id, faturamento, segment, urgency, notes, origin")
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) return template;

  // ADR-0023 §10: `{estagio}` é a etapa do NEGÓCIO, não a coluna espelho do lead.
  // `leads.pipe_whatsapp` não pode ser lida aqui a partir do L2: quando o negócio
  // sai de Oportunidades por MOVE, o gatilho resolve o slug por `NEW.pipeline_id`
  // e não escreve — a coluna CONGELA na última etapa de whatsapp. A mensagem sairia
  // com uma etapa que o negócio não ocupa mais, e ninguém veria campo vazio para
  // desconfiar.
  const waEntry = await getPipeEntry(supabase, leadId, lead.organization_id as string, "whatsapp");

  let result = template;

  const vars: Record<string, string> = {
    nome:       personalizationName(lead.name),
    empresa:    lead.company || "",
    email:      lead.email || "",
    telefone:   lead.phone || "",
    estagio:    waEntry?.stage_key || "",
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
    // O parser de tipos do postgrest-js não conhece a cardinalidade do embed:
    // sem o `Database` gerado ele chuta ARRAY para `tags(name)`. A relação é
    // muitos-para-um (`lead_tags.tag_id → tags.id`) e o PostgREST devolve
    // OBJETO — é o que este código sempre leu, e o que os testes deste arquivo
    // encenam. A asserção corrige o palpite do parser; o `unknown` no meio é
    // exigência do compilador, já que os dois formatos não se sobrepõem.
    //
    // Asserção e não `.returns<>()` de propósito: `.returns()` é método DE
    // RUNTIME do builder, e chamá-lo só para ajustar tipo quebrou os três testes
    // de `{{tag.X}}` (os dublês de teste não o implementam). Num módulo que 78
    // funções importam, ajuste de tipo não deveria acrescentar chamada nenhuma.
    const tagRows = (leadTags ?? []) as unknown as Array<{ tags: { name: string | null } | null }>;
    const tagNames = new Set(
      tagRows
        .map((lt) => lt.tags?.name)
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
