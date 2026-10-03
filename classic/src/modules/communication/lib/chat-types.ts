/**
 * Tipos do domínio de chat — FSM Takeover IA↔humano e search.
 *
 * C28: tipos AiTakeoverState + AiStateResumeMode
 */

// ─── FSM Takeover ─────────────────────────────────────────────────────────────

/**
 * Estados da FSM de takeover IA↔humano.
 * Mapeado para conversations.ai_state (migration 20260422140000).
 *
 * Transições permitidas (enforced por trigger Postgres):
 *   AI_ACTIVE        → AI_PAUSED_MANUAL | WAITING_HUMAN
 *   AI_PAUSED_MANUAL → AI_ACTIVE | HUMAN_ACTIVE
 *   WAITING_HUMAN    → HUMAN_ACTIVE | AI_ACTIVE
 *   HUMAN_ACTIVE     → HANDOFF_BACK | AI_PAUSED_MANUAL
 *   HANDOFF_BACK     → AI_ACTIVE | AI_PAUSED_MANUAL
 */
export type AiTakeoverState =
  | "AI_ACTIVE"
  | "AI_PAUSED_MANUAL"
  | "WAITING_HUMAN"
  | "HUMAN_ACTIVE"
  | "HANDOFF_BACK";

/**
 * Modo de retomada após a pausa manual.
 * Determina se e como a IA volta a responder.
 */
export type AiStateResumeMode =
  | "immediate"       // Retoma assim que o operador liberar
  | "after_response"  // Retoma após a próxima resposta do lead
  | "dont_resume";    // Não retoma — requer ação manual

// ─── Payload das mutations ────────────────────────────────────────────────────

export interface AiStatePayload {
  ai_state: AiTakeoverState;
  ai_state_resume_mode?: AiStateResumeMode | null;
  ai_state_updated_by: string; // auth.uid() — obrigatório para audit trail (Security B3)
}

// ─── Search ───────────────────────────────────────────────────────────────────

/** Item retornado pela RPC search_messages */
export interface MessageSearchResult {
  id: string;
  phone_number: string;
  message: string;
  direction: "incoming" | "outgoing";
  timestamp: string;
  /** HTML com <mark> tags do ts_headline — SEMPRE sanitizar com DOMPurify antes de renderizar */
  headline: string;
}
