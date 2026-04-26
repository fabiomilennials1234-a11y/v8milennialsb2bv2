/**
 * Trilha 3.B Fase B1 / T3B.5 — State Machine (skeleton)
 *
 * Status: SKELETON — máquina de estado da conversa do copilot.
 *
 * Estados conhecidos (de agent-engine.ts):
 *   NEW_LEAD → QUALIFYING → QUALIFIED → SCHEDULING → SCHEDULED
 *                                    → DISQUALIFIED
 *                                    → WAITING_HUMAN
 *                                    → CLOSED_WON | CLOSED_LOST
 *
 * Funções alvo:
 *   - determineNextState (~ linha 2831) — decide próximo estado
 *   - validateTransition  — futura: garantir transição é permitida
 *
 * Estimativa: 4h.
 */

export type ConversationState =
  | "NEW_LEAD"
  | "QUALIFYING"
  | "QUALIFIED"
  | "DISQUALIFIED"
  | "SCHEDULING"
  | "SCHEDULED"
  | "FOLLOW_UP"
  | "WAITING_HUMAN"
  | "CLOSED_WON"
  | "CLOSED_LOST";

/**
 * Mapa de transições válidas. Útil pra validação anti-state-corruption.
 */
export const VALID_TRANSITIONS: Record<ConversationState, ConversationState[]> = {
  NEW_LEAD: ["QUALIFYING", "WAITING_HUMAN", "DISQUALIFIED"],
  QUALIFYING: ["QUALIFIED", "DISQUALIFIED", "WAITING_HUMAN", "QUALIFYING"],
  QUALIFIED: ["SCHEDULING", "FOLLOW_UP", "WAITING_HUMAN", "QUALIFIED"],
  SCHEDULING: ["SCHEDULED", "QUALIFIED", "WAITING_HUMAN"],
  SCHEDULED: ["CLOSED_WON", "CLOSED_LOST", "FOLLOW_UP", "WAITING_HUMAN", "SCHEDULED"],
  FOLLOW_UP: ["QUALIFYING", "QUALIFIED", "SCHEDULED", "WAITING_HUMAN"],
  WAITING_HUMAN: ["QUALIFYING", "QUALIFIED", "SCHEDULED", "CLOSED_WON", "CLOSED_LOST"],
  DISQUALIFIED: [],
  CLOSED_WON: [],
  CLOSED_LOST: [],
};

export function isValidTransition(from: ConversationState, to: ConversationState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// TODO: extrair determineNextState de agent-engine.ts
