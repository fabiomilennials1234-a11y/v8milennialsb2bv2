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
