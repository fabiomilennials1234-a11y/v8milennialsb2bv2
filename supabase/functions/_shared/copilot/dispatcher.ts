/**
 * Trilha 3.B Fase B1 / T3B.6 — Dispatcher (skeleton)
 *
 * Status: SKELETON — enfileira ações do LLM em pending_ai_actions.
 *
 * Funções alvo:
 *   - enqueueToolAction (linha 2853) — entry point
 *   - buildIdempotencyKey (linha 2921) — gera key turn-based
 *   - mapToolToAction — converter tool name LLM → action_type DB
 *
 * Estimativa: 4h.
 */

export const ACTION_MAP: Record<string, string> = {
  SCHEDULE_MEETING: "schedule_meeting",
  CREATE_LEAD: "create_lead",
  UPDATE_CRM: "update_crm",
  UPDATE_LEAD: "update_lead",
  TRANSFER_HUMAN: "transfer_to_human",
  TRANSFER_HUMAN_NOTIFY: "transfer_to_human_notify",
  TRANSFER_HUMAN_WHATSAPP_NOTIFY: "transfer_to_human_whatsapp_notify",
  UPDATE_QUALIFICATION_SCORE: "update_qualification_score",
  ADVANCE_STAGE: "advance_stage",
  CONFIRM_MEETING: "confirm_meeting",
  ADVANCE_CONFIRMATION_STAGE: "advance_confirmation_stage",
  CREATE_CUSTOM_FIELD: "create_custom_field",
  UPDATE_PIPELINE_STAGE: "update_pipeline_stage",
  TRANSFER_SZ_CHAT: "transfer_sz_chat",
  SEND_DOCUMENT: "send_document",
  AUTOMATION_QUALIFY: "automation_qualify",
  AUTOMATION_DISQUALIFY: "automation_disqualify",
  AUTOMATION_NEED_HUMAN: "automation_need_human",
  SEND_PRODUCT_MATERIAL: "send_product_material",
};

// ─── buildIdempotencyKey (extracted from agent-engine.ts:2947) ───────────────

/**
 * Gera chave de idempotência por action_type + lead + params críticos.
 *
 * Granularidade:
 *   - turn_count quando disponível (mais robusto, evita colisão tempo)
 *   - ts (1min bucket) fallback
 *
 * Schema dedup em pending_ai_actions:
 *   UNIQUE(idempotency_key) WHERE idempotency_key IS NOT NULL AND status IN ('pending','processing')
 *
 * Pure function — sem side effects.
 */
export function buildIdempotencyKey(
  actionType: string,
  leadId: string | null,
  organizationId: string,
  params: Record<string, unknown>,
  turnCount?: number,
): string {
  const turnOrTs = turnCount !== undefined && turnCount !== null
    ? `t${turnCount}`
    : `ts${Math.floor(Date.now() / 60_000)}`;

  switch (actionType) {
    case "schedule_meeting":
      return `schedule_meeting_${leadId}_${params.preferred_date}`;
    case "transfer_to_human":
      return `transfer_human_${leadId}`;
    case "transfer_to_human_notify":
      return `transfer_human_notify_${leadId}_${turnOrTs}`;
    case "advance_stage":
      return `advance_stage_${leadId}_${params.target_pipe || "whatsapp"}_${params.target_stage}`;
    case "confirm_meeting":
      return `confirm_meeting_${leadId}_${params.confirmation_type || "pre_confirmed"}`;
    case "advance_confirmation_stage":
      return `advance_confirmation_${leadId}_${params.target_stage}`;
    case "create_custom_field":
      return `create_field_${organizationId}_${params.field_name}`;
    case "update_qualification_score":
      return `update_score_${leadId}_${params.score}_${turnOrTs}`;
    default:
      return `${actionType}_${leadId || organizationId}_${turnOrTs}`;
  }
}

/**
 * Mapeia action.action (UPPER_SNAKE) → action_type (snake_case) na fila.
 * Returns null se ação não suportada.
 */
export function mapActionToType(actionUpper: string): string | null {
  return ACTION_MAP[actionUpper] ?? null;
}

// ─── logDecision (extracted from agent-engine.ts:2915) ───────────────────────

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Registra decisão do copilot em agent_decision_logs.
 * Conversation temporária (id começa com 'temp_') só loga em console.
 *
 * Onda 1 / T1.3.1: opts.success=false aceito explicitamente.
 */
export async function logDecision(
  supabase: SupabaseClient,
  organizationId: string,
  conversationId: string,
  stateBefore: string,
  stateAfter: string,
  action: { action?: string } | null,
  capabilities: unknown,
  opts: { success?: boolean; errorMessage?: string; reasoningChain?: string } = {},
): Promise<void> {
  try {
    if (conversationId.startsWith("temp_")) {
      console.log("[dispatcher] decision (temp):", { stateBefore, stateAfter, action: action?.action, ...opts });
      return;
    }

    const { error } = await supabase.from("agent_decision_logs").insert({
      conversation_id: conversationId,
      organization_id: organizationId,
      state_before: stateBefore,
      state_after: stateAfter,
      action_decided: action?.action ?? "RESPOND_ONLY",
      reasoning: `Based on capabilities: ${JSON.stringify(capabilities)}`,
      reasoning_chain: opts.reasoningChain ?? null,
      capabilities_snapshot: capabilities,
      success: opts.success ?? true,
      error_message: opts.errorMessage ?? null,
    });

    if (error) {
      console.warn("[dispatcher] logDecision error:", error.message);
    }
  } catch (e) {
    console.warn("[dispatcher] logDecision exception:", e);
  }
}

// ─── addMessageToMemory (extracted from agent-engine.ts:2868) ────────────────

/**
 * Persiste message em conversation_messages com idempotency_key.
 * Onda 1 / T1.1.6: dedup via UNIQUE partial index (conversation_id, idempotency_key).
 * Key formato: `${role}:${sha256(content).slice(0,16)}:${bucket5min}`.
 *
 * Usa INSERT (não upsert) porque partial unique indexes não são inferidos
 * pelo ON CONFLICT do PostgREST. Erro 23505 (unique_violation) = dedup ok.
 */
export async function addMessageToMemory(
  supabase: SupabaseClient,
  conversationId: string,
  role: string,
  content: string,
): Promise<void> {
  try {
    if (conversationId.startsWith("temp_")) {
      console.log("[dispatcher] temp conversation, skipping memory save");
      return;
    }

    const contentBytes = new TextEncoder().encode(content);
    const hashBuf = await crypto.subtle.digest("SHA-256", contentBytes);
    const contentHash = Array.from(new Uint8Array(hashBuf))
      .slice(0, 8)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const bucket = Math.floor(Date.now() / 300_000);
    const idempotency_key = `${role}:${contentHash}:${bucket}`;

    const { error } = await supabase
      .from("conversation_messages")
      .insert({ conversation_id: conversationId, role, content, idempotency_key });

    if (error && error.code !== "23505") {
      console.warn("[dispatcher] addMessageToMemory error:", error.message);
    }
  } catch (e) {
    console.warn("[dispatcher] addMessageToMemory exception:", e);
  }
}

// ─── mapToolToAction (extracted from agent-engine.ts:2782) ───────────────────

/**
 * Mapeia tool name retornado pelo LLM (snake_case) → action UPPER_SNAKE.
 * Inverso de ACTION_MAP. Pure function.
 */
const TOOL_TO_ACTION: Record<string, string> = {
  schedule_meeting: "SCHEDULE_MEETING",
  create_lead: "CREATE_LEAD",
  update_crm: "UPDATE_CRM",
  update_lead: "UPDATE_LEAD",
  transfer_to_human: "TRANSFER_HUMAN",
  update_qualification_score: "UPDATE_QUALIFICATION_SCORE",
  qualify_lead: "QUALIFY_LEAD",
  disqualify_lead: "DISQUALIFY_LEAD",
  advance_stage: "ADVANCE_STAGE",
  confirm_meeting: "CONFIRM_MEETING",
  advance_confirmation_stage: "ADVANCE_CONFIRMATION_STAGE",
  create_custom_field: "CREATE_CUSTOM_FIELD",
  transfer_sz_chat: "TRANSFER_SZ_CHAT",
  send_document: "SEND_DOCUMENT",
  send_product_material: "SEND_PRODUCT_MATERIAL",
  search_knowledge: "SEARCH_KNOWLEDGE",
};

export function mapToolToAction(toolName: string): string {
  return TOOL_TO_ACTION[toolName] ?? "UNKNOWN";
}
