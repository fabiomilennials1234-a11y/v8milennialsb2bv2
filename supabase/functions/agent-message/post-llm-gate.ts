/**
 * Decisões puras do agent-message DEPOIS do LLM (gate pós-LLM, absorb loop e
 * resposta pública). Extraídas do handler para serem testáveis sem Deno.serve.
 *
 * H1 (2026-10-13): o turno com transfer_to_human desliga a IA inline; o gate
 * pós-LLM via o próprio desligamento e apagava/descartava o texto do turno.
 * Agora o cancelamento que é EXATAMENTE o handoff do turno (carimbo do engine)
 * libera a entrega — ver _shared/copilot/reply-gate.ts.
 */

import type { CancellationCheck } from "../_shared/copilot/cancellation.ts";
import { SAME_TURN_HANDOFF_KEY } from "../_shared/copilot/same-turn-handoff.ts";
import { decideReplyGate, type ReplyGateDecision } from "../_shared/copilot/reply-gate.ts";

/** Carimbo do handoff que o engine devolveu (cru; validado pelo gate). */
export function sameTurnHandoffOf(response: unknown): unknown {
  if (typeof response !== "object" || response === null) return null;
  return (response as Record<string, unknown>)[SAME_TURN_HANDOFF_KEY] ?? null;
}

/**
 * Gate pós-LLM: `deliver` (IA ligada), `release` (cancelado pelo handoff do
 * próprio turno → entrega, não apaga do histórico) ou `cancel` (apaga e pula).
 */
export function decidePostLlmGate(
  check: CancellationCheck,
  response: unknown,
  leadId: string,
): ReplyGateDecision {
  return decideReplyGate(check, { leadId, sameTurnHandoff: sameTurnHandoffOf(response) });
}

/**
 * Absorb loop (mensagens que chegaram durante o LLM) gera um turno NOVO sem
 * gate próprio. Depois de um handoff — ou de qualquer cancelamento — não roda:
 * o humano assume a conversa.
 */
export function shouldRunAbsorbLoop(decision: ReplyGateDecision, response: unknown): boolean {
  return decision === "deliver" && sameTurnHandoffOf(response) == null;
}

/**
 * Resposta pública do agent-message: sem `_eval_meta`; com `lead_id` e
 * `same_turn_handoff` para os gates por chunk dos chamadores reconhecerem o
 * handoff do turno.
 */
export function buildPublicResponse(response: Record<string, unknown>, leadId: string): Record<string, unknown> {
  const { _eval_meta: _unused, ...rest } = response;
  return { ...rest, lead_id: leadId, [SAME_TURN_HANDOFF_KEY]: sameTurnHandoffOf(response) };
}
