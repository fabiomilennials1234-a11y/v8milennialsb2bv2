/**
 * Gate de cancelamento da RESPOSTA DE TEXTO do turno × handoff do mesmo turno.
 *
 * Problema (H1, 2026-10-13): num turno com transfer_to_human a transferência
 * roda INLINE no engine e desliga a IA. O gate pós-LLM do agent-message e os
 * gates por chunk dos chamadores viam a IA desligada — pelo PRÓPRIO turno — e
 * descartavam o texto ("Já vou te passar para o time") em silêncio.
 *
 * Solução: a mesma prova de identidade usada para a mídia
 * (same-turn-handoff.ts). O engine devolve `same_turn_handoff` (carimbo do
 * desligamento que ELE causou); o texto sai só se o cancelamento vigente é
 * exatamente aquele. Humano, pausa, opt-out, carimbo diferente, outro lead e
 * fonte error/default continuam cancelando — ver isSameTurnHandoffCancel.
 *
 * Um único módulo para os 5 pontos de decisão (agent-message pós-LLM +
 * whatsapp-webhook, copilot-batch-processor, recover-stuck-conversations e
 * sz-chat-webhook por chunk) para as regras não divergirem.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logRuntime } from "../logger.ts";
import { type CancellationCheck, isCopilotCanceled } from "./cancellation.ts";
import { isSameTurnHandoffCancel, SAME_TURN_HANDOFF_KEY } from "./same-turn-handoff.ts";

/** Identidade do turno que produziu a resposta (vem da resposta pública do agent-message). */
export interface ReplyTurn {
  leadId: string | null;
  /** Marcador cru — validado por isSameTurnHandoffCancel, nunca confiado. */
  sameTurnHandoff: unknown;
}

export type ReplyGateDecision =
  /** IA ligada: entrega normal. */
  | "deliver"
  /** Cancelado pelo handoff do PRÓPRIO turno: entrega. */
  | "release"
  /** Cancelado por outro motivo: não entrega. */
  | "cancel";

/** Extrai a identidade do turno da resposta pública do agent-message. */
export function replyTurnFromAgentResponse(response: unknown): ReplyTurn {
  if (typeof response !== "object" || response === null) return { leadId: null, sameTurnHandoff: null };
  const r = response as Record<string, unknown>;
  return {
    leadId: typeof r.lead_id === "string" && r.lead_id.length > 0 ? r.lead_id : null,
    sameTurnHandoff: r[SAME_TURN_HANDOFF_KEY] ?? null,
  };
}

/** Decisão pura. */
export function decideReplyGate(check: CancellationCheck, turn: ReplyTurn): ReplyGateDecision {
  if (!check.canceled) return "deliver";
  return isSameTurnHandoffCancel(check, turn.sameTurnHandoff, turn.leadId) ? "release" : "cancel";
}

export type ReplyGateName = "post_llm" | "outbound_chunks" | "batch_chunks" | "recover_chunks" | "sz_chat_chunks";

/**
 * Gate com I/O: lê o cancelamento canônico e decide. Na liberação registra
 * `copilot_handoff_reply_released` (fire-and-forget) — prova em runtime_logs de
 * que o texto saiu APESAR da IA desligada, e por quê.
 */
export async function checkReplyGate(
  supabase: SupabaseClient,
  params: { organizationId: string; phone: string; turn: ReplyTurn; gate: ReplyGateName },
): Promise<{ decision: ReplyGateDecision; check: CancellationCheck }> {
  const check = await isCopilotCanceled(supabase, params.organizationId, params.phone);
  const decision = decideReplyGate(check, params.turn);
  if (decision === "release") logReplyReleased({ ...params, check });
  return { decision, check };
}

export function logReplyReleased(params: {
  organizationId: string;
  turn: ReplyTurn;
  gate: ReplyGateName;
  check: CancellationCheck;
  conversationId?: string;
}): void {
  logRuntime({
    organizationId: params.organizationId,
    module: "copilot",
    action: "copilot_handoff_reply_released",
    status: "success",
    entityType: "lead",
    entityId: params.turn.leadId ?? undefined,
    payloadSnapshot: {
      gate: params.gate,
      source: params.check.source,
      disabled_at: params.check.disabledAt ?? null,
      conversation_id: params.conversationId,
    },
  }).catch((e) => console.warn("[logReplyReleased] log failed (non-fatal):", e));
}
