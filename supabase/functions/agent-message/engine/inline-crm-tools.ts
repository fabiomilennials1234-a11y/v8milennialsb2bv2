import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { executeAiAction, immediateTransferHuman } from "../../_shared/ai-action-executor.ts";
import { enqueueAiAction } from "../../_shared/ai-queue.ts";
import { logRuntime } from "../../_shared/logger.ts";

export const INLINE_CRM_TOOLS = new Set(["update_lead", "advance_stage", "transfer_to_human"]);
export interface CrmToolCall { id: string; function: { name: string; arguments: string } }
export interface HandoffReceipt { conversation_id: string; paused_at: string }

/** Opt-in execution: ordered writes return real results before the model speaks. */
export async function runInlineCrmTools(input: {
  supabase: SupabaseClient; organizationId: string; leadId: string; conversationId: string;
  calls: CrmToolCall[]; availableTools: string[]; primaryPipeline?: string;
  notifyPhones?: string[] | null;
}) {
  const { supabase, organizationId, leadId, conversationId } = input;
  const results: Array<{ tool_call_id: string; result: Record<string, unknown> }> = [];
  let failed = false;
  let handedOff = false;
  let receipt: HandoffReceipt | undefined;
  for (const call of input.calls) {
    let result: Record<string, unknown>;
    if (failed || handedOff) {
      result = { success: false, error: "Ação não executada após falha ou transferência." };
    } else if (!INLINE_CRM_TOOLS.has(call.function.name) || !input.availableTools.includes(call.function.name)) {
      result = { success: false, error: "Ferramenta não autorizada nesta sequência." };
    } else {
      try {
        const args = JSON.parse(call.function.arguments);
        if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Argumentos inválidos.");
        if (call.function.name === "transfer_to_human") {
          result = await immediateTransferHuman(supabase, leadId, input.primaryPipeline);
          if (result.success) {
            handedOff = true;
            const paused = await supabase.from("leads").select("ai_disabled_at").eq("id", leadId).eq("organization_id", organizationId).single();
            if (paused.error || !paused.data?.ai_disabled_at) throw new Error("Não foi possível confirmar a pausa do atendimento.");
            receipt = { conversation_id: conversationId, paused_at: paused.data.ai_disabled_at };
            const notification = await enqueueAiAction(supabase, {
              organizationId, leadId, conversationId, actionType: "transfer_to_human_notify",
              payload: { ...args, lead_id: leadId }, idempotencyKey: `handoff:${conversationId}:${receipt.paused_at}:notify`,
            });
            if (!notification.queued && notification.reason !== "duplicate_idempotency_key") throw new Error("Não foi possível notificar o vendedor.");
            if (input.notifyPhones?.length) {
              const whatsappNotification = await enqueueAiAction(supabase, {
              organizationId, leadId, conversationId, actionType: "transfer_to_human_whatsapp_notify",
              payload: { ...args, lead_id: leadId, notify_phones: input.notifyPhones },
              idempotencyKey: `handoff:${conversationId}:${receipt.paused_at}:whatsapp`,
            });
              if (!whatsappNotification.queued && whatsappNotification.reason !== "duplicate_idempotency_key") throw new Error("Não foi possível enfileirar o aviso de WhatsApp ao vendedor.");
            }
          }
        } else {
          result = { ...await executeAiAction(supabase, {
            id: call.id, organization_id: organizationId, lead_id: leadId,
            conversation_id: conversationId, action_type: call.function.name,
            payload: { ...args, lead_id: leadId },
          }) };
        }
      } catch (error) {
        result = { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    failed ||= result.success !== true;
    results.push({ tool_call_id: call.id, result });
    await logRuntime({ organizationId, module: "copilot", action: "crm_tool_result", status: result.success ? "success" : "error", entityType: "lead", entityId: leadId, errorMessage: result.success ? undefined : String(result.error), payloadSnapshot: { tool: call.function.name, conversation_id: conversationId, success: result.success } });
  }
  return { results, failed, handedOff, receipt };
}
