/**
 * AI Action Queue — enfileira ações do Copilot para processamento assíncrono
 *
 * Garante idempotência via idempotency_key e nunca lança exceção
 * para não quebrar o fluxo de resposta do agente.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface EnqueueParams {
  organizationId: string;
  leadId?: string;
  conversationId?: string;
  actionType: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface EnqueueResult {
  queued: boolean;
  id?: string;
  reason?: string;
}

/**
 * Insere uma ação na fila pending_ai_actions.
 *
 * Se idempotencyKey for fornecido e já existir um registro pending/processing
 * com o mesmo key, retorna { queued: false } sem inserir duplicata.
 *
 * Nunca lança exceção — retorna { queued: false, reason } em caso de erro.
 */
export async function enqueueAiAction(
  supabase: SupabaseClient,
  params: EnqueueParams,
): Promise<EnqueueResult> {
  try {
    const { data, error } = await supabase
      .from("pending_ai_actions")
      .insert({
        organization_id: params.organizationId,
        lead_id: params.leadId || null,
        conversation_id: params.conversationId || null,
        action_type: params.actionType,
        payload: params.payload,
        idempotency_key: params.idempotencyKey || null,
      })
      .select("id")
      .single();

    if (error) {
      // Unique constraint violation on idempotency_key → duplicate, not an error
      if (error.code === "23505") {
        console.log(`[ai-queue] Duplicate idempotency_key, skipping: ${params.idempotencyKey}`);
        return { queued: false, reason: "duplicate_idempotency_key" };
      }
      console.warn("[ai-queue] Insert failed:", error.message);
      return { queued: false, reason: error.message };
    }

    console.log(`[ai-queue] Enqueued ${params.actionType} for lead ${params.leadId || "N/A"} (id: ${data.id})`);
    return { queued: true, id: data.id };
  } catch (err) {
    console.warn("[ai-queue] Unexpected error:", err);
    return { queued: false, reason: String(err) };
  }
}

/**
 * Enfileira múltiplas ações em batch (uma transação lógica).
 * Útil para automation actions que geram múltiplas operações.
 */
export async function enqueueAiActions(
  supabase: SupabaseClient,
  actions: EnqueueParams[],
): Promise<EnqueueResult[]> {
  const results: EnqueueResult[] = [];
  for (const action of actions) {
    results.push(await enqueueAiAction(supabase, action));
  }
  return results;
}
