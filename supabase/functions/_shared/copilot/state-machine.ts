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

// ─── updateConversationState (extracted from agent-engine.ts:2843) ───────────

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Atualiza state da conversation via RPC atomic increment_conversation_turn.
 * Onda 1 / T1.2.1: substituiu SELECT+UPDATE separado (race condition perdia
 * incrementos em mensagens simultâneas).
 *
 * Conversation temporária (id 'temp_') skipa.
 */
export async function updateConversationState(
  supabase: SupabaseClient,
  conversationId: string,
  newState: string,
): Promise<void> {
  try {
    if (conversationId.startsWith("temp_")) {
      console.log("[state-machine] temp conversation, skipping state update");
      return;
    }

    const { error } = await supabase.rpc("increment_conversation_turn", {
      p_conversation_id: conversationId,
      p_new_state: newState,
    });

    if (error) {
      console.warn("[state-machine] increment_conversation_turn RPC error:", error.message);
    }
  } catch (e) {
    console.warn("[state-machine] updateConversationState exception:", e);
  }
}

// ─── determineNextState (extracted from agent-engine.ts:2868) ────────────────

/**
 * Decide próximo estado da conversa baseado no tool/action chamado pelo LLM.
 * Pure function — sem side effects, fácil de testar.
 *
 * Comportamento:
 *   - schedule_meeting → SCHEDULED
 *   - transfer_to_human → WAITING_HUMAN
 *   - qualify_lead → QUALIFIED
 *   - disqualify_lead → DISQUALIFIED
 *   - confirm_meeting → QUALIFIED (dispara onQualify automation)
 *   - transfer_sz_chat → CLOSED_WON
 *   - search_knowledge / advance_* / send_* / create_* → mantém estado
 *   - Default: NEW_LEAD → QUALIFYING (auto-advance ao primeiro turn)
 */
export function determineNextState(currentState: string, toolName: string): ConversationState {
  if (toolName === "schedule_meeting") return "SCHEDULED";
  if (toolName === "transfer_to_human") return "WAITING_HUMAN";
  if (toolName === "qualify_lead") return "QUALIFIED";
  if (toolName === "disqualify_lead") return "DISQUALIFIED";
  if (toolName === "advance_stage") return currentState as ConversationState;
  if (toolName === "confirm_meeting") return "QUALIFIED";
  if (toolName === "advance_confirmation_stage") return currentState as ConversationState;
  if (toolName === "create_custom_field") return currentState as ConversationState;
  if (toolName === "transfer_sz_chat") return "CLOSED_WON";
  if (toolName === "send_document") return currentState as ConversationState;
  if (toolName === "send_product_material") return currentState as ConversationState;
  if (toolName === "search_knowledge") return currentState as ConversationState;
  if (currentState === "NEW_LEAD") return "QUALIFYING";
  return currentState as ConversationState;
}
