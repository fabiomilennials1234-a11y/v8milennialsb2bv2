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

// TODO: extrair enqueueToolAction + buildIdempotencyKey de agent-engine.ts
