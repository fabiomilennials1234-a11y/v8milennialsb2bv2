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
 *    numbers, not the lead. We therefore do NOT write a lead-associated
 *    whatsapp_messages row (that would pollute the lead's chat thread).
 *  - The FROM instance is the operator-selected one (params.whatsappInstanceId) or
 *    the org default — leadId is intentionally NOT passed to instance resolution so
 *    strict-write lead binding doesn't force the lead's responsible's instance.
 */

import type { ActionInput, ActionResult } from "./types.ts";
import { getWhatsAppInstance, getLeadPhone, resolveVariables, buildTrackId } from "./whatsapp-helpers.ts";
import { sendTextViaInstance, normalizeBrazilianPhone } from "../whatsapp-dispatch.ts";
import { summarizeConversation } from "./ai-operations.ts";

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

  // 2) FROM instance — operator-selected or org default. leadId NOT passed on
  //    purpose (recipients are fixed numbers, not the lead).
  const wa = await getWhatsAppInstance(
    supabase,
    organizationId,
    params.whatsappInstanceId as string | undefined,
    null,
  );
  if (!wa) return { success: false, error: "WhatsApp instance not available" };

  // 3) Resolve the message template against the lead.
  const template = (params.messageTemplate as string) || "";
  let message = await resolveVariables(supabase, leadId, template, executionContext);
  if (!message) return { success: false, error: "Empty message template", retryable: false };

  // 4) Optional: append AI conversation summary + the lead's phone for context.
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

  // 5) Send to each number; aggregate partial failures.
  const trackId = buildTrackId(params);
  const failures: Array<{ phone: string; error: string }> = [];
  const succeeded: string[] = [];

  for (const phone of phones) {
    const res = await sendTextViaInstance(supabase, wa.instance, phone, message, {
      trackSource: "workflow-send-to-number",
      trackId,
    });
    if (res.success) succeeded.push(phone);
    else failures.push({ phone, error: res.error ?? "unknown send error" });
  }

  // 6) Aggregate.
  //  - all failed → terminal failure for this run, retryable (transient provider
  //    error is the common cause; nothing was delivered so a retry can't duplicate).
  //  - partial   → success so the executor does NOT retry and re-send to numbers
  //    that already received the message; the failures are surfaced in the result.
  if (succeeded.length === 0) {
    return {
      success: false,
      error: `WhatsApp send failed for all ${phones.length} number(s): ${
        failures.map((f) => `${f.phone} (${f.error})`).join("; ")
      }`,
      data: { failed: failures, total: phones.length },
    };
  }

  const baseMessage = `Mensagem enviada para ${succeeded.length}/${phones.length} número(s)`;
  return {
    success: true,
    message: failures.length
      ? `${baseMessage} — falhou em: ${failures.map((f) => f.phone).join(", ")}`
      : baseMessage,
    data: {
      sent_to: succeeded,
      ...(failures.length ? { failed: failures } : {}),
      ...(invalid.length ? { invalid } : {}),
      includedSummary: !!params.includeConversationSummary,
    },
  };
}
