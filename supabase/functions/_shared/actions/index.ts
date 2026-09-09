/**
 * AI Action dispatcher — roteia action_type para o handler correto.
 *
 * Substitui o switch monolítico que vivia em ai-action-executor.ts.
 * Cada capability vive num arquivo próprio:
 *   - schedule-meeting.ts
 *   - update-lead.ts
 *   - qualify-lead.ts
 *   - transfer-human.ts
 *   - send-document.ts
 *   - ../action-handlers/move-stage.ts (shared between AI and Workflow dispatchers)
 *
 * O wrapper público (executeAiAction) preserva o contrato externo:
 *   process-ai-actions/index.ts → executeAiAction(supabase, action)
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type ActionRecord,
  type ActionResult,
  NOOP_ACTION_TYPES,
} from "./types.ts";
import { logToLeadHistory } from "./log-history.ts";
import {
  executeScheduleMeeting,
  executeConfirmMeeting,
  executeAdvanceConfirmationStage,
} from "./schedule-meeting.ts";
import {
  executeCreateLead,
  executeUpdateLead,
  executeCreateCustomField,
} from "./update-lead.ts";
import { moveStage } from "../action-handlers/move-stage.ts";
import { executeMoveEntryStage } from "./move-card.ts";
import {
  executeUpdateQualificationScore,
  executeAutomation,
} from "./qualify-lead.ts";
import {
  executeTransferHuman,
  executeTransferHumanNotify,
  executeTransferSzChat,
} from "./transfer-human.ts";
import { executeTransferHumanWhatsappNotify } from "./transfer-human-whatsapp-notify.ts";
import { executeScheduleMeetingWhatsappNotify } from "./schedule-meeting-whatsapp-notify.ts";
import { executeSendDocument } from "./send-document.ts";

export async function executeAiAction(
  supabase: SupabaseClient,
  action: ActionRecord,
): Promise<ActionResult> {
  const { action_type, payload, organization_id, lead_id, conversation_id } = action;

  if (NOOP_ACTION_TYPES.has(action_type)) {
    console.log(
      `[executeAiAction] noop:${action_type} skipped (handler not implemented)`,
      { lead_id, organization_id },
    );
    return {
      success: true,
      message: `noop:${action_type}`,
      data: { skipped: true, reason: "handler_not_implemented" },
    };
  }

  let result: ActionResult;

  switch (action_type) {
    case "schedule_meeting":
      result = await executeScheduleMeeting(supabase, payload, organization_id, conversation_id);
      break;
    case "create_lead":
      result = await executeCreateLead(supabase, payload, organization_id);
      break;
    case "update_crm":
      return { success: true, message: "UPDATE_CRM - integração externa (placeholder)" };
    case "update_lead":
      result = await executeUpdateLead(supabase, payload, organization_id);
      break;
    case "transfer_to_human":
      result = await executeTransferHuman(supabase, payload, conversation_id);
      break;
    case "transfer_to_human_notify":
      result = await executeTransferHumanNotify(supabase, payload, organization_id, lead_id);
      break;
    case "transfer_to_human_whatsapp_notify":
      result = await executeTransferHumanWhatsappNotify(supabase, payload, organization_id, lead_id);
      break;
    case "schedule_meeting_whatsapp_notify":
      result = await executeScheduleMeetingWhatsappNotify(supabase, payload, organization_id, lead_id, conversation_id);
      break;
    case "update_qualification_score":
      result = await executeUpdateQualificationScore(supabase, payload);
      break;
    case "advance_stage":
      // SCRUM-628: target_pipe aceita QUALQUER funil da org — a resolução
      // (uuid, slug custom, alias legado; etapa por stage_key ou uuid) vive no
      // próprio moveStage compartilhado (SCRUM-627), com erro tipado claro.
      result = await moveStage({
        supabase, organizationId: organization_id, leadId: lead_id || payload.lead_id as string || null,
        // O Copilot age a partir de uma CONVERSA, que é da pessoa: não existe
        // negócio declarado no pedido. Cai no critério de sempre
        // (`pickActiveEntry`) — e é por isso que os dois campos vão nulos e
        // explícitos, em vez de opcionais: aqui a ausência é a resposta certa,
        // e ela precisa estar escrita.
        entryId: null, dealId: null,
        conversationId: conversation_id, params: payload,
      });
      break;
    case "confirm_meeting":
      // `organization_id` faltava na chamada — `tenantId` chegava `undefined` e
      // `getPipeEntry` resolvia pipeline nenhum, então a ação SEMPRE devolvia
      // "Lead não encontrado no pipe de confirmação". Todos os cases vizinhos já
      // repassam o mesmo argumento.
      result = await executeConfirmMeeting(supabase, payload, organization_id);
      break;
    case "advance_confirmation_stage":
      result = await executeAdvanceConfirmationStage(supabase, payload, organization_id);
      break;
    case "create_custom_field":
      result = await executeCreateCustomField(supabase, payload, organization_id);
      break;
    case "automation_qualify":
    case "automation_disqualify":
    case "automation_need_human":
      result = await executeAutomation(supabase, payload, organization_id, lead_id);
      break;
    case "update_pipeline_stage":
      // SCRUM-628: o auto-avanço do turn passou a mandar o NEGÓCIO que leu
      // (`entry_id` + `stage_id`) — move-only, qualquer funil, sem upsert.
      // Payload legado sem entry_id (fila antiga, callers externos) segue no
      // caminho por lead+slug do moveStage compartilhado.
      if (payload.entry_id) {
        result = await executeMoveEntryStage(supabase, payload, organization_id);
        break;
      }
      result = await moveStage({
        supabase, organizationId: organization_id, leadId: lead_id || payload.lead_id as string || null,
        // Idem `advance_stage` acima: pedido do Copilot, sujeito é a pessoa.
        entryId: null, dealId: null,
        conversationId: conversation_id,
        params: { target_stage: payload.new_stage || payload.target_stage, target_pipe: payload.target_pipe || "whatsapp" },
      });
      break;
    case "transfer_sz_chat":
      result = await executeTransferSzChat(supabase, lead_id, organization_id, payload);
      break;
    case "send_document":
      result = await executeSendDocument(
        supabase,
        payload,
        organization_id,
        lead_id,
        conversation_id,
        action.id,
      );
      break;
    case "generate_message": {
      // workflow-executor.ts case "copilot" enqueues this action_type but no
      // handler exists. Returning success no-op stops infinite retry loop.
      console.warn(
        `[executeAiAction] generate_message no-op (handler pending design): lead=${lead_id} org=${organization_id}`,
      );
      return {
        success: true,
        message: "no-op: generate_message handler pending design (workflow→copilot pipeline)",
      };
    }
    default:
      return { success: false, error: `Tipo de ação desconhecido: ${action_type}` };
  }

  // Log to lead_history on success
  if (result.success) {
    const resolvedLeadId =
      lead_id || (payload.lead_id as string) || (result.data?.lead_id as string);

    if (resolvedLeadId) {
      await logToLeadHistory(supabase, {
        leadId: resolvedLeadId,
        organizationId: organization_id,
        actionType: action_type,
        payload,
        result,
      });
    }
  }

  return result;
}
