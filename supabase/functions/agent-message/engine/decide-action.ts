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
import { getPipeEntry, type PipelineEntry } from "../../_shared/pipeline-adapter.ts";
import { funnelRefsFromRules } from "../../_shared/copilot/kanban-rules.ts";

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

    // SCRUM-628: a automação deixa de assumir o funil WhatsApp — vai junto a
    // ref do funil primário do agente (primeira regra de kanban de eixo-funil).
    // Sem regra configurada, o executor cai no legado "whatsapp".
    const pipelineRef = funnelRefsFromRules(capabilities?.copilot_agent_kanban_rules)[0] ?? null;

    console.log("[engine/decide-action] Enqueuing automation action:", automationActionType);
    await enqueueAiAction(supabase, {
      organizationId,
      leadId,
      actionType: automationActionType,
      payload: {
        action_type: actionType,
        action_config: actionConfig,
        current_state: currentState,
        ...(pipelineRef ? { pipeline_ref: pipelineRef } : {}),
      },
      idempotencyKey,
    });
  } catch (error) {
    console.error("[engine/decide-action] Error enqueuing automation actions:", error);
  }
}

interface EngineStageRow {
  id: string;
  stage_key: string;
  position: number;
  stage_role: string | null;
}

/**
 * Etapas ATIVAS do funil da entry, na ordem de position. Falha de leitura vira
 * `null` (não avança nada) — nunca lista vazia fingindo "funil sem etapas".
 */
async function loadStagesOfPipeline(
  supabase: SupabaseClient,
  organizationId: string,
  pipelineId: string,
): Promise<EngineStageRow[] | null> {
  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("id, stage_key, position, stage_role")
    .eq("organization_id", organizationId)
    .eq("pipeline_id", pipelineId)
    .eq("is_active", true)
    .order("position", { ascending: true });
  if (error) {
    console.warn("[engine/decide-action] Falha ao ler etapas do funil:", { pipelineId, error });
    return null;
  }
  return (data ?? []) as EngineStageRow[];
}

/**
 * Avanço automático de etapa pelo turn do Copilot — em QUALQUER funil (SCRUM-628).
 *
 * O funil deixa de ser o WhatsApp hardcoded: o Sujeito é procurado nos funis
 * que as kanban rules do agente citam (na ordem), com fallback "whatsapp" para
 * agente sem regra — comportamento histórico preservado. A trilha fixa
 * ["novo","abordado","respondeu",...] morreu junto:
 *
 *   - avanço por turn = PRÓXIMA etapa `stage_role='open'` na ordem de position
 *     do funil da entry. Regras (a mesma semântica da trilha antiga, por
 *     posição): turn 1 na primeira etapa open → segunda; segunda etapa open →
 *     terceira. Da terceira em diante ninguém avança sozinho (a antiga
 *     respondeu→esfriou nunca foi automática, e esfriou deixa de ser um alvo
 *     acidental por estar na trilha).
 *   - SCHEDULE_MEETING → etapa `stage_role='meeting_booked'` do funil (a
 *     primeira por position). Funil sem etapa meeting_booked → NÃO move.
 *   - entry em etapa não-open (meeting_booked/held/won/lost) → não move.
 *
 * ADR-0023 §10: a etapa corrente é do NEGÓCIO (`pipeline_entries`), nunca de
 * `leads.pipe_whatsapp`. ADR-0023 §3 (guard preservado): sem negócio, NADA é
 * enfileirado — automação não abre negócio.
 *
 * O payload agora carrega `entry_id` + `stage_id` + `target_pipe` (uuid do
 * funil): o executor (`executeMoveEntryStage`) move O NEGOCIO LIDO AQUI, por id,
 * sem upsert — o caminho legado `{lead_id, new_stage}` continua aceito para
 * ações antigas ainda na fila.
 */
export async function enqueuePipelineStageUpdate(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string,
  turnCount: number,
  actionToExecute: any,
  capabilities?: any,
): Promise<void> {
  try {
    // advance_stage será enfileirado como tool call — não duplicar
    if (actionToExecute?.action === "ADVANCE_STAGE") {
      return;
    }

    const refs = funnelRefsFromRules(capabilities?.copilot_agent_kanban_rules);
    if (refs.length === 0) refs.push("whatsapp");

    let entry: PipelineEntry | null = null;
    for (const ref of refs) {
      entry = await getPipeEntry(supabase, leadId, organizationId, ref);
      if (entry) break;
    }

    if (!entry) {
      // Sem negócio em nenhum funil do agente não há posição para avançar.
      // ADR-0023 §3: negócio nasce só por clique humano — nenhuma automação
      // abre um (era por aqui que o agente criava, via upsert do executor).
      console.log(
        "[engine/decide-action] Lead sem negócio nos funis do agente; nada a avançar.",
        { leadId, refs },
      );
      return;
    }

    const stages = await loadStagesOfPipeline(supabase, organizationId, entry.pipeline_id);
    if (!stages || stages.length === 0) return;

    const entryStageId = (entry as unknown as { stage_id?: string | null }).stage_id ?? null;
    const currentIdx = stages.findIndex((s) =>
      entryStageId ? s.id === entryStageId : s.stage_key === entry!.stage_key,
    );
    const current = currentIdx >= 0 ? stages[currentIdx] : null;

    let target: EngineStageRow | null = null;

    if (actionToExecute?.action === "SCHEDULE_MEETING") {
      target = stages.find((s) => s.stage_role === "meeting_booked") ?? null;
      if (!target) {
        console.log(
          "[engine/decide-action] Funil sem etapa meeting_booked; SCHEDULE_MEETING não move.",
          { pipelineId: entry.pipeline_id },
        );
      }
    } else if (current && (current.stage_role ?? "open") === "open") {
      const open = stages.filter((s) => (s.stage_role ?? "open") === "open");
      const openIdx = open.findIndex((s) => s.id === current.id);
      if (turnCount <= 1 && openIdx === 0 && open.length > 1) {
        target = open[1];
      } else if (openIdx === 1 && open.length > 2) {
        target = open[2];
      }
    }

    if (target && target.stage_key !== entry.stage_key) {
      console.log("[engine/decide-action] Enqueuing pipeline stage update:", {
        leadId,
        pipelineId: entry.pipeline_id,
        from: entry.stage_key,
        to: target.stage_key,
      });
      await enqueueAiAction(supabase, {
        organizationId,
        leadId,
        actionType: "update_pipeline_stage",
        payload: {
          lead_id: leadId,
          entry_id: entry.id,
          target_pipe: entry.pipeline_id,
          new_stage: target.stage_key,
          stage_id: target.id,
          previous_stage: entry.stage_key,
        },
        idempotencyKey: `pipeline_${leadId}_${entry.pipeline_id}_${target.stage_key}`,
      });
    }
  } catch (e) {
    console.warn("[engine/decide-action] Failed to enqueue pipeline stage update:", e);
  }
}
