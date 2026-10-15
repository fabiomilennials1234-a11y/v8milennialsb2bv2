import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { WhatsAppInstance } from "../whatsapp-client.ts";
import { sendMenuViaInstance } from "../whatsapp-dispatch.ts";
import { enforceWhatsAppRateLimit, getLeadPhone, resolveVariables } from "../action-handlers/whatsapp-helpers.ts";
import { logRuntime } from "../logger.ts";
import { resolveWorkflowQuestionImageUrl } from "./image.ts";

/** The durable reservation precedes the HTTP request. A resumed reservation never sends again. */
export async function sendWorkflowButtonQuestion(input: {
  supabase: SupabaseClient;
  organizationId: string;
  executionId: string;
  leadId: string;
  nodeId: string;
  data: Record<string, unknown>;
  visit: number;
  context: Record<string, unknown>;
}): Promise<void> {
  const { supabase, organizationId, executionId, leadId, nodeId, data, visit, context } = input;
  const failAdmission = async (reason: string) => {
    const failed = await supabase.rpc("fail_workflow_button_admission", {
      p_execution_id: executionId, p_organization_id: organizationId, p_node_id: nodeId, p_visit: visit, p_reason: reason,
    });
    if (failed.error) throw new Error("question_buttons_admission_failure_persistence_failed");
  };
  const instanceId = data.instanceId ?? context.whatsapp_instance_id;
  if (typeof instanceId !== "string" || !instanceId) return failAdmission("instance_unavailable");
  const instance = await supabase.from("whatsapp_instances").select("*")
    .eq("id", instanceId).eq("organization_id", organizationId).maybeSingle();
  if (instance.error || !instance.data || !["open", "connected"].includes(instance.data.status)) {
    return failAdmission("instance_unavailable");
  }
  const phone = await getLeadPhone(supabase, leadId, organizationId);
  if (!phone) return failAdmission("recipient_unavailable");
  await enforceWhatsAppRateLimit(supabase, instanceId);
  const reservation = await supabase.rpc("prepare_workflow_button_question", {
    p_execution_id: executionId, p_organization_id: organizationId,
    p_node_id: nodeId, p_visit: visit, p_instance_id: instanceId, p_phone: phone,
  });
  if (reservation.error || !reservation.data?.id) return failAdmission("reservation_unavailable");
  if (reservation.data.send !== true) return;
  await sendReservedQuestion(supabase, instance.data as WhatsAppInstance, {
    id: reservation.data.id, organization_id: organizationId, instance_id: instanceId, phone, content: data,
    lead_id: leadId, context,
  });
}

interface ReservedQuestion {
  id: string;
  organization_id: string;
  instance_id: string;
  phone: string;
  content: Record<string, unknown>;
  lead_id: string;
  execution_id?: string;
  /** Execution context for variable resolution; queued rows load it at send time. */
  context?: Record<string, unknown>;
}

/** Only the transaction that changes queued → sending receives send ownership. */
export async function sendQueuedWorkflowQuestions(supabase: SupabaseClient): Promise<{ errors: number }> {
  const claimed = await supabase.rpc("claim_workflow_button_queue", { p_limit: 5 });
  if (claimed.error) return { errors: 1 };
  const results = await Promise.all((claimed.data ?? []).map(async (question: ReservedQuestion) => {
    const instance = await supabase.from("whatsapp_instances").select("*")
      .eq("id", question.instance_id).eq("organization_id", question.organization_id).maybeSingle();
    if (instance.error || !instance.data || !["open", "connected"].includes(instance.data.status)) {
      const failed = await supabase.rpc("fail_workflow_button_question", {
        p_id: question.id, p_organization_id: question.organization_id, p_reason: "send_preflight_failed",
      });
      return failed.error ? 1 : 0;
    }
    await enforceWhatsAppRateLimit(supabase, question.instance_id);
    // Context only matters when the frozen text carries a variable; a plain text costs no extra read.
    let context: Record<string, unknown> | undefined;
    if (String(question.content?.text ?? "").includes("{{")) {
      const execution = await supabase.from("workflow_executions").select("context")
        .eq("id", question.execution_id).eq("organization_id", question.organization_id).maybeSingle();
      context = (execution.data?.context ?? undefined) as Record<string, unknown> | undefined;
    }
    await sendReservedQuestion(supabase, instance.data as WhatsAppInstance, { ...question, context });
    return 0;
  }));
  return { errors: results.reduce((sum: number, value: number) => sum + value, 0) };
}

async function sendReservedQuestion(supabase: SupabaseClient, instance: WhatsAppInstance, question: ReservedQuestion): Promise<void> {
  const { id: occurrenceId, organization_id: organizationId, phone, content: data } = question;
  const buttons = data.buttons as { id: string; label: string }[];
  let definitelyNotSent = true;
  let notSentReason: "image_unavailable" | "send_preflight_failed" = "image_unavailable";
  try {
    // /send/menu is deliberately single-attempt in UazapiClient. trackId is for reconciliation only.
    const imageButton = await resolveWorkflowQuestionImageUrl(supabase, organizationId, data.image);
    notSentReason = "send_preflight_failed";
    // Same resolver as the legacy menu node, at send time over the frozen text.
    // Button labels stay literal: the reply matches by id.
    const rawText = String(data.text ?? "");
    const text = await resolveVariables(supabase, question.lead_id, rawText, question.context);
    // A text that resolves to nothing is never sent: it routes to Falha no envio.
    if (!text.trim()) throw new Error("question_buttons_empty_text");
    if (text !== rawText) {
      // The chat mirror projects content.text on acceptance: the CRM must show what the lead receives.
      const persisted = await supabase.from("workflow_button_questions")
        .update({ content: { ...data, text } }).eq("id", occurrenceId).eq("organization_id", organizationId)
        .eq("state", "sending");
      if (persisted.error) throw new Error("question_buttons_text_persistence_failed");
    }
    definitelyNotSent = false;
    const sent = await sendMenuViaInstance(supabase, instance, phone, {
      type: "button", text, imageButton,
      choices: buttons.map(button => `${button.label}|${occurrenceId}:${button.id}`),
    }, {
      trackSource: "workflow-question-buttons", trackId: occurrenceId, idempotencyKey: occurrenceId, requiredProvider: "uazapi",
    });
    if (sent.deliveryState === "not_sent" || sent.deliveryState === "rejected") {
      const failed = await supabase.rpc("fail_workflow_button_question", {
        p_id: occurrenceId, p_organization_id: organizationId,
        p_reason: sent.deliveryState === "rejected" ? "provider_rejected" : "send_preflight_failed",
        p_message_id: sent.whatsappMessageId ?? null, p_accepted_at: sent.acceptedAt ?? null,
      });
      if (failed.error) throw new Error("question_buttons_failure_persistence_failed");
      return;
    }
    if (!sent.success || !sent.whatsappMessageId || !sent.acceptedAt) throw new Error("question_buttons_acceptance_missing_message_id");
    const accepted = await supabase.rpc("accept_workflow_button_question", {
      p_id: occurrenceId, p_organization_id: organizationId,
      p_message_id: sent.whatsappMessageId, p_accepted_at: sent.acceptedAt,
    });
    if (accepted.error || accepted.data !== true) throw new Error("question_buttons_acceptance_persistence_failed");
  } catch {
    if (definitelyNotSent) {
      const failed = await supabase.rpc("fail_workflow_button_question", {
        p_id: occurrenceId, p_organization_id: organizationId, p_reason: notSentReason,
      });
      if (!failed.error) return;
    }
    // Network and persistence failures may follow a successful delivery. Never blindly resend.
    const marked = await supabase.from("workflow_button_questions")
      .update({ state: "uncertain" }).eq("id", occurrenceId).eq("organization_id", organizationId)
      .eq("state", "sending");
    if (marked.error) {
      // The existing durable sending/paused reservation is safer than failing the execution:
      // a failure would release its conversation while delivery is still unknown.
      await logRuntime({ organizationId, module: "workflow", action: "question_buttons_uncertain_persistence_failed",
        status: "error", payloadSnapshot: { question_id: occurrenceId } }).catch(() => {});
    }
  }
}
