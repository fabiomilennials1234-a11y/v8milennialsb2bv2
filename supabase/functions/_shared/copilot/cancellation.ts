/**
 * Copilot Cancellation — gate compartilhado pra parar envios em-flight quando
 * o usuário desativa o copilot no meio do processamento.
 *
 * Cobre 3 janelas de delay (RC-cancel, 2026-04-26):
 *   1. Batch wait pré-LLM (sz-chat-webhook já tinha proteção, mantemos)
 *   2. LLM call (~5-30s) — agent-message checa pós-LLM
 *   3. Natural messaging chunks (smartSplit + setTimeout) — checa per-chunk
 *
 * Fonte de verdade: phone_ai_preferences.ai_disabled (decisão CTO 2026-04-22).
 * Fallback: leads.ai_disabled pra leads legados sem preference.
 *
 * Bypass RLS: service_role (este módulo só roda em edge functions).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logRuntime } from "../logger.ts";
import { normalizeBrazilianPhone } from "../whatsapp-dispatch.ts";

export interface CancellationCheck {
  canceled: boolean;
  source: "phone_ai_preferences" | "leads" | "default" | "error";
  ai_disabled: boolean;
  reason?: string;
}

/**
 * Checa se o copilot foi desativado pra este lead/telefone.
 *
 * Retorna `canceled=true` quando ai_disabled=true em phone_ai_preferences
 * (fonte de verdade) ou em leads (fallback). Erros viram canceled=false
 * (fail-open intencional — bug no DB não deve travar todos os envios).
 */
export async function isCopilotCanceled(
  supabase: SupabaseClient,
  organizationId: string,
  phone: string,
): Promise<CancellationCheck> {
  try {
    if (!phone || !organizationId) {
      return { canceled: false, source: "default", ai_disabled: false };
    }

    const normalized = normalizeBrazilianPhone(phone);
    if (!normalized) {
      return { canceled: false, source: "default", ai_disabled: false };
    }

    // 1. Source of truth: phone_ai_preferences (PK organization_id, normalized_phone)
    const { data: pref, error: prefErr } = await supabase
      .from("phone_ai_preferences")
      .select("ai_disabled")
      .eq("organization_id", organizationId)
      .eq("normalized_phone", normalized)
      .maybeSingle();

    if (prefErr) {
      console.warn("[isCopilotCanceled] phone_ai_preferences read failed:", prefErr.message);
    } else if (pref) {
      return {
        canceled: Boolean(pref.ai_disabled),
        ai_disabled: Boolean(pref.ai_disabled),
        source: "phone_ai_preferences",
      };
    }

    // 2. Fallback: leads.ai_disabled (lead mais recente pra esse telefone).
    // Query é por normalized_phone (canonical 11-digit, populado pelo trigger
    // leads_normalize_phone_trigger). Antes comparava contra leads.phone que
    // armazena raw — match dependia de coincidência de formato, então o
    // fallback quase nunca disparava. Agora alinhado com a coluna canônica.
    const { data: lead } = await supabase
      .from("leads")
      .select("ai_disabled")
      .eq("organization_id", organizationId)
      .eq("normalized_phone", normalized)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lead) {
      return {
        canceled: Boolean(lead.ai_disabled),
        ai_disabled: Boolean(lead.ai_disabled),
        source: "leads",
      };
    }

    return { canceled: false, source: "default", ai_disabled: false };
  } catch (e) {
    console.warn("[isCopilotCanceled] exception (fail-open):", e);
    return {
      canceled: false,
      source: "error",
      ai_disabled: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Helper de logging — registra cancelamento mid-flight em runtime_logs.
 * Fire-and-forget. Action: 'copilot_canceled'.
 */
export function logCopilotCancellation(params: {
  organizationId: string;
  gate: "post_llm" | "sz_chat_chunks" | "outbound_chunks" | "followup_chunks" | "ai_action_send";
  leadId?: string;
  conversationId?: string;
  phone?: string;
  chunksSent?: number;
  chunksTotal?: number;
  source?: CancellationCheck["source"];
}): void {
  logRuntime({
    organizationId: params.organizationId,
    module: "copilot",
    action: "copilot_canceled",
    status: "skipped",
    entityType: params.leadId ? "lead" : "conversation",
    entityId: params.leadId ?? params.conversationId,
    payloadSnapshot: {
      gate: params.gate,
      phone: params.phone,
      conversation_id: params.conversationId,
      chunks_sent: params.chunksSent,
      chunks_total: params.chunksTotal,
      source: params.source,
    },
  }).catch((e) => console.warn("[logCopilotCancellation] log failed (non-fatal):", e));
}
