/**
 * send_to_number action handler — sends a WhatsApp message to ONE OR MORE FIXED
 * numbers (NOT the lead's number).
 *
 * Use case: an operator runs a reactivation dispatch from a shared/default
 * number; when a lead replies, the workflow notifies a salesperson's number with
 * the lead's conversation summary + the lead's phone, so the salesperson can take
 * over.
 *
 * Design notes:
 *  - The message template is resolved against the LEAD (same variable resolver as
 *    send_whatsapp: {{nome}}, {{telefone}}, {{empresa}}, {{custom.x}}, ...).
 *  - When `includeConversationSummary` is true, the existing summarize_conversation
 *    logic is reused (no duplicated LLM call) and the summary + the lead's phone are
 *    appended.
 *  - We send via `sendTextViaInstance` (the provider adapter) — deliberately NOT the
 *    lead-scoped gateway — because the recipients are fixed operator/salesperson
 *    numbers, not the lead. We do write an OUTGOING whatsapp_messages row, but keyed
 *    to the RECIPIENT's number with lead_id NULL (see persistChatHistory) so the
 *    notification shows up as the salesperson's own chat thread and never pollutes the
 *    lead's thread.
 *  - The FROM instance is the operator-selected one (params.whatsappInstanceId).
 *    leadId is intentionally NOT passed to instance resolution: the recipients are
 *    fixed numbers, so following the lead's conversation would be meaningless. With
 *    no instance declared, only an org with a single live one resolves (ADR-0025);
 *    two or more and the node fails instead of picking a number on its own.
 *
 * Retry-storm guard (review M1+L1): permanent failures are detected UP FRONT and
 * returned non-retryable so the executor doesn't hammer Uazapi with 5xx for ~6.5min
 * (the documented dead-session storm). Only a genuine transient blip (live instance,
 * reachable recipients, yet send failed) is left retryable.
 *   - dead / logged-out FROM instance  → retryable:false, NO send attempted.
 *   - every recipient not on WhatsApp   → retryable:false, NO send attempted.
 *   - all sends fail after those gates  → transient (retryable default).
 */

import type { ActionInput, ActionResult } from "./types.ts";
import {
  getWhatsAppInstance,
  getLeadPhone,
  resolveVariables,
  buildTrackId,
  recipientGate,
  providerPersistsOwnMessages,
} from "./whatsapp-helpers.ts";
import { sendTextViaInstance, normalizeBrazilianPhone } from "../whatsapp-dispatch.ts";
import { LEGACY_PROVIDERS } from "../instance-routing.ts";
import { summarizeConversation } from "./ai-operations.ts";
import { reserveSendOrSkip } from "../send-dedup.ts";

/** Parse + normalize + dedupe the configured destination numbers. */
function resolveDestinations(raw: unknown): { valid: string[]; invalid: string[] } {
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const asString = typeof entry === "string" ? entry : String(entry ?? "");
    if (!asString.trim()) continue; // empty rows from the UI are ignored, not errors
    const normalized = normalizeBrazilianPhone(asString);
    if (!normalized) {
      invalid.push(asString.trim());
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    valid.push(normalized);
  }
  return { valid, invalid };
}

/**
 * Persist the sent notification as an OUTGOING whatsapp_messages row so it surfaces
 * in the chat inbox as a thread with the RECIPIENT's number (the salesperson) — NOT
 * the lead's thread. Mirrors outbound-sender's row shape.
 *
 *  - message_id = the provider id so the Uazapi fromMe echo UPSERTs THIS row instead
 *    of inserting a duplicate (onConflict message_id,instance_id).
 *  - direction 'outgoing' + message_type 'conversation' → renders as a sent bubble.
 *  - sent_source 'workflow' satisfies BOTH constraints on this column:
 *    (a) `whatsapp_messages_sent_source_check` only accepts manual|copilot|workflow;
 *    (b) fn_human_pause_on_manual_send early-returns unless sent_source = 'manual',
 *    so this write does NOT pause the AI. The "which workflow action sent this"
 *    detail lives in raw_payload.track_source ('workflow-send-to-number'), which
 *    has no CHECK. It used to be in sent_source — violating (a), so every upsert
 *    failed 23514 into the best-effort catch below and the notification never
 *    reached the chat. Measured in PROD: 0 rows in 2.3M messages.
 *  - lead_id is left NULL on purpose. The BEFORE trigger resolve_message_lead_id() only
 *    attaches a lead if the RECIPIENT's own number matches one — so a normal salesperson
 *    number yields a standalone thread and the lead's chat is never polluted.
 *
 * Best-effort: the WhatsApp message already went out, so a history-write failure must
 * never fail the notification nor flip the action to retryable.
 */
async function persistChatHistory(
  supabase: ActionInput["supabase"],
  organizationId: string,
  instance: { id: string; provider?: string | null },
  phone: string,
  content: string,
  messageId?: string,
): Promise<void> {
  // Ver `providerPersistsOwnMessages`: o canal oficial já gravou a linha.
  if (providerPersistsOwnMessages(instance.provider)) return;

  try {
    const { error } = await supabase
      .from("whatsapp_messages")
      .upsert({
        organization_id: organizationId,
        instance_id: instance.id,
        message_id: messageId || `wf_${crypto.randomUUID()}`,
        remote_jid: `${phone}@s.whatsapp.net`,
        phone_number: phone,
        direction: "outgoing",
        message_type: "conversation",
        content,
        // `whatsapp_messages_sent_source_check` só aceita manual|copilot|workflow.
        // Qualquer outro valor viola a CHECK, o upsert devolve 23514 e o catch
        // best-effort abaixo engole — a notificação some do chat em silêncio.
        // A granularidade "veio do send_to_number" vive em `raw_payload.track_source`
        // (trackSource abaixo), que não tem constraint.
        sent_source: "workflow",
        lead_id: null,
        timestamp: new Date().toISOString(),
      }, { onConflict: "message_id,instance_id", ignoreDuplicates: true });
    if (error) {
      console.warn("[send-to-number] chat history upsert failed (non-fatal):", error.message);
    }
  } catch (err) {
    console.warn("[send-to-number] chat history upsert threw (non-fatal):", err);
  }
}

export async function sendToNumber(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params, executionContext } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for sendToNumber" };
  }

  // 1) Destination numbers (config). All-invalid / empty is a permanent config
  //    error — never retry, retrying won't make a bad number deliverable.
  const { valid: phones, invalid } = resolveDestinations(params.notifyPhones);
  if (phones.length === 0) {
    return {
      success: false,
      error: invalid.length
        ? `send_to_number: no valid destination number (invalid: ${invalid.join(", ")})`
        : "send_to_number requires at least one destination number (notifyPhones)",
      retryable: false,
    };
  }

  // 2) FROM instance. leadId NÃO é passado de propósito: os destinatários são
  //    números fixos, não o lead — seguir a conversa dele não faria sentido aqui.
  //    O dead-session guard (M1) agora vive dentro da resolução: instância
  //    deslogada devolve falha não-retentável, sem tentativa de envio.
  //
  //    `LEGACY_PROVIDERS` estreita o universo de propósito (issue #1700): estes
  //    destinatários são vendedores e gestores, não leads. Nunca escreveram
  //    para a organização, então a janela de 24 horas da Meta está fechada por
  //    definição e o canal oficial recusaria o texto livre — por callback,
  //    depois de a tela dizer "enviado". O painel deste nó já recusa a opção;
  //    isto é a mesma recusa do lado do executor.
  const wa = await getWhatsAppInstance(
    supabase,
    organizationId,
    params,
    null,
    LEGACY_PROVIDERS,
  );
  if (!wa.ok) return wa.failure;

  // 3) Resolve the message template against the lead.
  const template = (params.messageTemplate as string) || "";
  let message = await resolveVariables(supabase, leadId, template, executionContext);
  if (!message) return { success: false, error: "Empty message template", retryable: false };

  // 4) Recipient pre-flight (L1): mirror send-whatsapp's recipientGate / /chat/check.
  //    A valid-format number that is NOT on WhatsApp makes Uazapi 5xx too — skip it
  //    instead of feeding the storm. The gate is conservative: prior-history numbers
  //    and any check error resolve to reachable, so legitimate numbers never drop.
  const reachable: string[] = [];
  const skipped: string[] = []; // valid format but provably not on WhatsApp
  for (const phone of phones) {
    const block = await recipientGate(supabase, wa.instance, phone, organizationId);
    if (block) skipped.push(phone);
    else reachable.push(phone);
  }

  // Every destination is undeliverable (not on WhatsApp) → permanent, do not retry
  // and do not attempt a single send.
  if (reachable.length === 0) {
    const undeliverable = [...invalid, ...skipped];
    return {
      success: false,
      retryable: false,
      error: `send_to_number: nenhum destino acessível no WhatsApp (ignorados: ${undeliverable.join(", ")})`,
      data: {
        ...(invalid.length ? { invalid } : {}),
        ...(skipped.length ? { skipped } : {}),
      },
    };
  }

  // 5) Optional: append AI conversation summary + the lead's phone for context.
  //    Best-effort — a summary failure must never abort the notification.
  if (params.includeConversationSummary) {
    try {
      const summaryRes = await summarizeConversation(input);
      const summary = summaryRes.success
        ? (summaryRes.data?.summary as string | undefined)
        : undefined;
      if (summary) message += `\n\n📋 Resumo da conversa:\n${summary}`;
    } catch (err) {
      console.warn("[send-to-number] summary generation failed (non-fatal):", err);
    }
    const leadPhone = await getLeadPhone(supabase, leadId);
    if (leadPhone) message += `\n\n📞 Telefone do lead: ${leadPhone}`;
  }

  // 6) Send to each reachable number; aggregate partial failures.
  const trackId = buildTrackId(params);
  const failures: Array<{ phone: string; error: string }> = [];
  const succeeded: string[] = [];

  for (const phone of reachable) {
    // Content-hash dedup backstop (fail-open): if this exact notification already
    // went to this number inside the window, count it delivered and skip re-send.
    const dedup = await reserveSendOrSkip({ supabase, orgId: organizationId, phone, content: message, source: "workflow" });
    if (dedup.duplicate) { succeeded.push(phone); continue; }

    const res = await sendTextViaInstance(supabase, wa.instance, phone, message, {
      trackSource: "workflow-send-to-number",
      trackId,
    });
    if (res.success) {
      succeeded.push(phone);
      await persistChatHistory(supabase, organizationId, wa.instance, phone, message, res.messageId);
    } else {
      failures.push({ phone, error: res.error ?? "unknown send error" });
    }
  }

  // 7) Aggregate.
  //  - all failed → terminal failure for this run. The FROM instance is live and the
  //    recipients passed the WhatsApp pre-flight, so an all-fail here is most likely
  //    a momentary provider blip → leave `retryable` DEFAULT (transient) so the
  //    executor can retry. Nothing was delivered, so a retry can't duplicate.
  //  - partial → success so the executor does NOT retry and re-send to numbers that
  //    already received the message; the failures are surfaced in the result.
  if (succeeded.length === 0) {
    return {
      success: false,
      error: `WhatsApp send failed for all ${reachable.length} number(s): ${
        failures.map((f) => `${f.phone} (${f.error})`).join("; ")
      }`,
      data: {
        failed: failures,
        total: reachable.length,
        ...(invalid.length ? { invalid } : {}),
        ...(skipped.length ? { skipped } : {}),
      },
    };
  }

  const baseMessage = `Mensagem enviada para ${succeeded.length}/${reachable.length} número(s)`;
  return {
    success: true,
    message: failures.length
      ? `${baseMessage} — falhou em: ${failures.map((f) => f.phone).join(", ")}`
      : baseMessage,
    data: {
      sent_to: succeeded,
      ...(failures.length ? { failed: failures } : {}),
      ...(invalid.length ? { invalid } : {}),
      ...(skipped.length ? { skipped } : {}),
      includedSummary: !!params.includeConversationSummary,
    },
  };
}
