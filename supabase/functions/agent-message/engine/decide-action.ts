/**
 * Decide ação a partir da resposta do LLM e enfileira side-effects.
 *
 * Funções puras (sem `this`) — recebem deps via parâmetros.
 *
 *  - processLLMResponse:        parse de tool_calls + assistant message
 *  - enqueueToolAction:         enfileira 1 action no pending_ai_actions
 *  - enqueueAutomationActions:  dispara qualify/disqualify/need_human conforme estado
 *  - enqueuePipelineStageUpdate: avança a etapa do NEGÓCIO baseado em turn/action
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enqueueAiAction } from "../../_shared/ai-queue.ts";
import {
  buildIdempotencyKey as buildIdempotencyKeyExternal,
  mapToolToAction as mapToolToActionExternal,
} from "../../_shared/copilot/dispatcher.ts";
import { determineNextState as determineNextStateExternal } from "../../_shared/copilot/state-machine.ts";
import { getPipeEntry } from "../../_shared/pipeline-adapter.ts";

export interface ProcessLLMResponseResult {
  nextState: string;
  actionToExecute:
    | { action: string; params: Record<string, unknown>; tenant_id: string }
    | null;
  assistantMessage: string;
  extraToolCalls: Array<{
    action: string;
    params: Record<string, unknown>;
    tenant_id: string;
  }>;
  finishReason: string;
}

export function processLLMResponse(
  response: any,
  conversation: any,
  organizationId: string,
): ProcessLLMResponseResult {
  let assistantMessage = "";
  let actionToExecute:
    | { action: string; params: Record<string, unknown>; tenant_id: string }
    | null = null;
  const extraToolCalls: ProcessLLMResponseResult["extraToolCalls"] = [];
  let nextState = conversation.state;

  const choice = response.choices?.[0];
  if (!choice) {
    throw new Error("No response from LLM");
  }

  const message = choice.message;
  const finishReason = choice.finish_reason ?? "unknown";

  console.log("[engine/decide-action] LLM response:", {
    finish_reason: finishReason,
    has_content: !!message?.content,
    tool_calls_count: message?.tool_calls?.length ?? 0,
  });

  if (message.content) {
    assistantMessage = message.content;
  }

  // Estratégia: coletar tudo que tem JSON válido. Primeiro válido vira
  // actionToExecute; os demais vão para extraToolCalls. JSON corrompido =
  // log error + skip (nunca enfileira params vazios).
  if (message.tool_calls && message.tool_calls.length > 0) {
    const parsed: Array<{ toolName: string; entry: typeof actionToExecute }> = [];
    for (const toolCall of message.tool_calls) {
      const toolName = toolCall.function.name;
      let toolParams: Record<string, unknown> | null = null;
      try {
        toolParams = JSON.parse(toolCall.function.arguments);
      } catch (e) {
        console.error(
          "[engine/decide-action] Error parsing tool arguments:",
          e,
          "raw:",
          toolCall.function.arguments,
        );
        continue;
      }
      parsed.push({
        toolName,
        entry: {
          action: mapToolToActionExternal(toolName),
          params: toolParams ?? {},
          tenant_id: organizationId,
        },
      });
    }
    if (parsed.length > 0) {
      actionToExecute = parsed[0].entry;
      nextState = determineNextStateExternal(conversation.state, parsed[0].toolName);
      for (let i = 1; i < parsed.length; i++) {
        if (parsed[i].entry) extraToolCalls.push(parsed[i].entry!);
      }
    }
  }

  return { nextState, actionToExecute, assistantMessage, extraToolCalls, finishReason };
}

/**
 * Escapa metacaracteres do LIKE/ILIKE (`%` e `_`) num literal de filename, pra
 * que o match parcial não vire wildcard acidental (ex: `100%.pdf`).
 */
function escapeIlikeLiteral(value: string): string {
  return value.replace(/([%_\\])/g, "\\$1");
}

/**
 * Recovery KomBag 2026-06-23 — resolve um filename de mídia vazado (capturado
 * pelo sanitizer como `recoveredMediaByName` a partir de uma tag-de-chamada
 * fora da allowlist) para uma ação SEND_DOCUMENT real.
 *
 * O sanitizer é PURO (sem DB) → só extrai o filename. A resolução
 * filename→document_id acontece AQUI, buscando em copilot_agent_documents
 * (agent_id atual, status='ready'). Match exato (case-insensitive) primeiro,
 * depois ilike parcial. Sem doc → null (engine apenas suprime, comportamento
 * atual antes deste fix).
 *
 * Multi-tenancy: gateado por agent_id + organization_id. agent_id ausente →
 * null (não dá pra escopar o lookup com segurança).
 */
export async function resolveRecoveredMedia(
  supabase: SupabaseClient,
  agentId: string | null | undefined,
  organizationId: string,
  fileName: string,
): Promise<{ action: string; params: Record<string, unknown>; tenant_id: string } | null> {
  const name = (fileName ?? "").trim();
  if (!name || !agentId) return null;

  // 1. Match exato case-insensitive (ilike sem wildcard = igualdade tolerante a caixa).
  const exact = await supabase
    .from("copilot_agent_documents")
    .select("id, file_name")
    .eq("agent_id", agentId)
    .eq("organization_id", organizationId)
    .eq("status", "ready")
    .ilike("file_name", escapeIlikeLiteral(name))
    .limit(1);

  let docId: string | null = exact.data?.[0]?.id ?? null;

  // 2. Fallback: match parcial (filename contido no nome do doc, ou vice-versa).
  if (!docId) {
    const partial = await supabase
      .from("copilot_agent_documents")
      .select("id, file_name")
      .eq("agent_id", agentId)
      .eq("organization_id", organizationId)
      .eq("status", "ready")
      .ilike("file_name", `%${escapeIlikeLiteral(name)}%`)
      .limit(1);
    docId = partial.data?.[0]?.id ?? null;
  }

  if (!docId) return null;

  return {
    action: "SEND_DOCUMENT",
    params: { document_id: docId },
    tenant_id: organizationId,
  };
}

const ACTION_TYPE_MAP: Record<string, string> = {
  SCHEDULE_MEETING: "schedule_meeting",
  CREATE_LEAD: "create_lead",
  UPDATE_CRM: "update_crm",
  UPDATE_LEAD: "update_lead",
  TRANSFER_HUMAN: "transfer_to_human",
  UPDATE_QUALIFICATION_SCORE: "update_qualification_score",
  ADVANCE_STAGE: "advance_stage",
  CONFIRM_MEETING: "confirm_meeting",
  ADVANCE_CONFIRMATION_STAGE: "advance_confirmation_stage",
  CREATE_CUSTOM_FIELD: "create_custom_field",
  TRANSFER_SZ_CHAT: "transfer_sz_chat",
  SEND_DOCUMENT: "send_document",
  SEND_PRODUCT_MATERIAL: "send_product_material",
};

export interface EnqueueToolActionParams {
  supabase: SupabaseClient;
  organizationId: string;
  currentLeadId: string | null;
  action: { action: string; params: Record<string, unknown> };
  conversationId: string;
  turnCount?: number;
}

export async function enqueueToolAction(
  params: EnqueueToolActionParams,
): Promise<{ success: boolean; queued?: boolean; action_id?: string; error?: string; message?: string }> {
  const { supabase, organizationId, currentLeadId, action, conversationId, turnCount } = params;
  const actionParams = action.params || {};

  // SEARCH_KNOWLEDGE: handled inline via multi-turn, never enqueued
  if (action.action === "SEARCH_KNOWLEDGE") {
    return { success: true, queued: false, message: "Handled inline" };
  }

  // QUALIFY/DISQUALIFY: processados via state machine + enqueueAutomationActions
  if (action.action === "QUALIFY_LEAD" || action.action === "DISQUALIFY_LEAD") {
    console.log(
      `[engine/decide-action] ${action.action} - será processada via state machine em enqueueAutomationActions`,
    );
    return { success: true, queued: false, message: `${action.action} delegada para automação` };
  }

  // UPDATE_CRM: placeholder
  if (action.action === "UPDATE_CRM") {
    return { success: true, message: "UPDATE_CRM - integração externa (placeholder)" };
  }

  const actionType = ACTION_TYPE_MAP[action.action];
  if (!actionType) {
    console.warn("[engine/decide-action] Action não suportada para enqueue:", action.action);
    return { success: false, error: `Ação não suportada: ${action.action}` };
  }

  // Injetar current_lead_id para create_custom_field
  if (action.action === "CREATE_CUSTOM_FIELD" && currentLeadId) {
    actionParams.current_lead_id = currentLeadId;
  }

  const leadId = (actionParams.lead_id as string) || currentLeadId;
  const idempotencyKey = buildIdempotencyKeyExternal(
    actionType,
    leadId,
    organizationId,
    actionParams,
    turnCount,
  );

  const result = await enqueueAiAction(supabase, {
    organizationId,
    leadId: leadId || undefined,
    conversationId: conversationId.startsWith("temp_") ? undefined : conversationId,
    actionType,
    payload: actionParams,
    idempotencyKey,
  });

  console.log(`[engine/decide-action] Action ${action.action} enqueued:`, result);
  return { success: true, queued: result.queued, action_id: result.id };
}

const QUALIFIED_STATES = ["QUALIFIED", "SCHEDULED", "MEETING_SCHEDULED", "CLOSED_WON"];
const DISQUALIFIED_STATES = ["DISQUALIFIED", "NOT_INTERESTED", "NO_FIT", "CLOSED_LOST"];
const NEED_HUMAN_STATES = ["NEED_HUMAN", "ESCALATED", "COMPLEX_ISSUE", "WAITING_HUMAN"];

export async function enqueueAutomationActions(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string,
  currentState: string,
  capabilities: any,
): Promise<void> {
  try {
    const automationActions = capabilities.automation_actions;
    if (!automationActions) {
      console.log("[engine/decide-action] No automation actions configured");
      return;
    }

    let actionConfig = null;
    let actionType: string | null = null;

    if (QUALIFIED_STATES.includes(currentState)) {
      actionConfig = automationActions.onQualify;
      actionType = "qualify";
    } else if (DISQUALIFIED_STATES.includes(currentState)) {
      actionConfig = automationActions.onDisqualify;
      actionType = "disqualify";
    } else if (NEED_HUMAN_STATES.includes(currentState)) {
      actionConfig = automationActions.onNeedHuman;
      actionType = "need_human";
    }

    if (!actionConfig || !actionType) {
      console.log(
        "[engine/decide-action] No automation action matches current state:",
        currentState,
      );
      return;
    }

    const automationActionType = `automation_${actionType}` as string;
    const idempotencyKey = `auto_${actionType}_${leadId}_${currentState}`;

    console.log("[engine/decide-action] Enqueuing automation action:", automationActionType);
    await enqueueAiAction(supabase, {
      organizationId,
      leadId,
      actionType: automationActionType,
      payload: {
        action_type: actionType,
        action_config: actionConfig,
        current_state: currentState,
      },
      idempotencyKey,
    });
  } catch (error) {
    console.error("[engine/decide-action] Error enqueuing automation actions:", error);
  }
}

const STANDARD_WHATSAPP_STAGES = ["novo", "abordado", "respondeu", "esfriou", "agendado"];

export async function enqueuePipelineStageUpdate(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string,
  turnCount: number,
  actionToExecute: any,
): Promise<void> {
  try {
    // advance_stage será enfileirado como tool call — não duplicar
    if (actionToExecute?.action === "ADVANCE_STAGE") {
      return;
    }

    // ADR-0023 §10: a etapa corrente é do NEGÓCIO, não do lead. `leads.pipe_whatsapp`
    // sobrevive como espelho legado e não é mais lido aqui — em L2 um gatilho passa a
    // zerá-lo quando o negócio sai de Oportunidades, e continuar lendo dali mudaria o
    // comportamento do agente em silêncio (1.885 leads em 34 orgs já divergem hoje).
    const entry = await getPipeEntry(supabase, leadId, organizationId, "whatsapp");

    if (!entry) {
      // Sem negócio no funil não há posição para avançar. Antes daqui saía um
      // `update_pipeline_stage`, e `executeUpdatePipelineStage` faz `upsertPipeEntry`,
      // que INSERE a entry quando não existe — ou seja, o agente CRIAVA o negócio.
      // ADR-0023 §3: negócio nasce só por clique humano. Nenhuma automação abre um.
      console.log(
        "[engine/decide-action] Lead sem negócio no funil WhatsApp; nada a avançar.",
        { leadId },
      );
      return;
    }

    const currentStage = entry.stage_key;
    let newStage: string | null = null;

    const isStandardStage = STANDARD_WHATSAPP_STAGES.includes(currentStage || "");

    if (actionToExecute?.action === "SCHEDULE_MEETING") {
      newStage = "agendado";
    } else if (isStandardStage) {
      if (turnCount <= 1 && currentStage === "novo") {
        newStage = "abordado";
      } else if (currentStage === "abordado") {
        newStage = "respondeu";
      }
    }

    if (newStage && newStage !== currentStage) {
      console.log("[engine/decide-action] Enqueuing pipeline stage update:", {
        leadId,
        from: currentStage,
        to: newStage,
      });
      await enqueueAiAction(supabase, {
        organizationId,
        leadId,
        actionType: "update_pipeline_stage",
        payload: { lead_id: leadId, new_stage: newStage, previous_stage: currentStage },
        idempotencyKey: `pipeline_${leadId}_${newStage}`,
      });
    }
  } catch (e) {
    console.warn("[engine/decide-action] Failed to enqueue pipeline stage update:", e);
  }
}
