// deno-lint-ignore-file no-explicit-any
/**
 * Follow-up message sender — provider-agnostic via whatsapp-client adapter.
 *
 * Accepts either a pre-resolved instance_id or falls back to the first
 * instance of the org. Preserves smart-split + humanization contract from
 * the Evolution-era implementation.
 */

import { humanizeMessage } from "./message-humanizer.ts";
import { smartSplitMessage } from "./natural-messaging.ts";
import {
  resolveDispatchContext,
  DispatchResolutionError,
} from "./whatsapp-dispatch.ts";
import { assertRecipientReachableWithProvider } from "./action-handlers/whatsapp-helpers.ts";
import { isCopilotCanceled, logCopilotCancellation } from "./copilot/cancellation.ts";
import { governSend, isSkippedSend } from "./send-governor/gate.ts";

export async function sendFollowupMessage(
  supabase: any,
  params: {
    organizationId: string;
    leadId: string;
    ruleId: string;
    phone: string;
    messageContent: string;
    instanceId: string | null;
    /** @deprecated kept for telemetry logging only; provider is resolved via instanceId */
    instanceName?: string;
    agentId?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const {
    organizationId,
    leadId,
    ruleId,
    phone,
    messageContent,
    instanceId,
    instanceName,
    agentId,
  } = params;

  if (agentId) {
    const { data: agent } = await supabase
      .from("copilot_agents")
      .select("is_active")
      .eq("id", agentId)
      .maybeSingle();
    if (agent && !agent.is_active) {
      console.log("[followup-sender] Agent disabled — skipping followup for lead:", leadId);
      return { success: false, error: "Agent disabled" };
    }
  }

  // lead_id propagado — quando flag user_write_instance_strict ON na org,
  // força resolução pelo responsável; OFF preserva precedência legada
  // (instanceId → primeira instância da org).
  let ctx;
  try {
    ctx = await resolveDispatchContext(supabase, {
      organization_id: organizationId,
      phone,
      preferred_instance_id: instanceId,
      lead_id: leadId,
    });
  } catch (e) {
    const err = e as DispatchResolutionError;
    return { success: false, error: err.message };
  }

  const { provider, instance, normalizedPhone } = ctx;

  // Pre-flight: skip (non-retryably) when the recipient is not on WhatsApp.
  // Established conversations short-circuit via the prior-history fast path, so
  // this only costs an API call on genuinely new numbers.
  const reach = await assertRecipientReachableWithProvider(supabase, provider, normalizedPhone, organizationId);
  if (!reach.reachable) {
    return { success: false, error: reach.reason };
  }

  const humanizedContent = await humanizeMessage(messageContent);
  const { chunks, delays } = await smartSplitMessage(humanizedContent, {
    enabled: true,
    intensity: "natural",
  });

  let firstMessageId: string | undefined;
  let allSent = true;
  let chunksSent = 0;
  let canceled = false;
  for (let i = 0; i < chunks.length; i++) {
    try {
      await provider.setPresence(normalizedPhone, "composing");
    } catch {
      /* best-effort */
    }

    if (delays[i] > 0) {
      await new Promise((r) => setTimeout(r, delays[i]));
    }

    // RC-cancel 2026-04-26: per-chunk cancellation gate.
    const cancelCheck = await isCopilotCanceled(supabase, organizationId, normalizedPhone);
    if (cancelCheck.canceled) {
      console.log("[followup-sender] Copilot canceled mid-flight; aborting after", chunksSent, "of", chunks.length);
      logCopilotCancellation({
        organizationId,
        gate: "followup_chunks",
        leadId,
        phone: normalizedPhone,
        chunksSent,
        chunksTotal: chunks.length,
        source: cancelCheck.source,
      });
      canceled = true;
      break;
    }

    try {
      // Send Governor (SHADOW/PR-0): evaluates + logs would-be decision but
      // NEVER blocks — `supabase` here is the callers' service-role client
      // (process-copilot-followups / process-followup-situations), which the
      // governor needs to bypass RLS. category='automation'. Fail-open is
      // owned by governSend, so any governor error still lets the chunk send.
      const governed = await governSend(
        supabase,
        {
          orgId: organizationId,
          instanceId: instance.id,
          category: "automation",
          recipientPhone: normalizedPhone,
          trackSource: "copilot-followup",
        },
        () =>
          provider.sendText({
            number: normalizedPhone,
            text: chunks[i],
            trackSource: "copilot-followup",
            trackId: ruleId,
          }),
      );
      // Forward-safe: unreachable in SHADOW (send always runs). Under a future
      // enforce mode a block/defer stops the remaining chunks (avoids a partial
      // message) and reports the followup as not fully sent.
      if (isSkippedSend(governed)) {
        console.log(
          "[followup-sender] governor skipped chunk",
          i + 1,
          governed.action,
          governed.reason
        );
        allSent = false;
        break;
      }
      const res = governed;
      if (i === 0) firstMessageId = res.message_id;
      chunksSent++;
    } catch (err) {
      console.error(
        "[followup-sender] provider error on chunk",
        i + 1,
        ":",
        (err as Error).message
      );
      allSent = false;
    }
  }

  if (canceled && chunksSent === 0) {
    return { success: false, error: "canceled_before_send" };
  }

  if (!allSent) {
    return { success: false, error: "Failed to send one or more chunks" };
  }

  const messageId = firstMessageId || `followup-${crypto.randomUUID()}`;

  await supabase.from("whatsapp_messages").upsert({
    organization_id: organizationId,
    instance_id: instance.id,
    message_id: messageId,
    remote_jid: normalizedPhone + "@s.whatsapp.net",
    phone_number: normalizedPhone,
    direction: "outgoing",
    message_type: "conversation",
    content: humanizedContent,
    status: "sent",
    lead_id: leadId,
    timestamp: new Date().toISOString(),
    sent_by_ai: true,
    sent_source: "workflow",
  }, { onConflict: "message_id,instance_id", ignoreDuplicates: false });

  await supabase.from("copilot_followup_execution_log").insert({
    lead_id: leadId,
    rule_id: ruleId,
    organization_id: organizationId,
    message_content: humanizedContent,
    instance_name: instanceName ?? instance.instance_name,
  });

  const { data: summaryRow } = await supabase
    .from("conversation_context_summary")
    .select("followup_count")
    .eq("lead_id", leadId)
    .maybeSingle();

  const newCount = (summaryRow?.followup_count ?? 0) + 1;
  await supabase.from("conversation_context_summary").upsert(
    {
      lead_id: leadId,
      organization_id: organizationId,
      followup_count: newCount,
      last_followup_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "lead_id" }
  );

  return { success: true };
}
