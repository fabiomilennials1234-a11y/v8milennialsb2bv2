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
import { normalizePhoneForSearch } from "../lead-service.ts";

export interface CancellationCheck {
  canceled: boolean;
  source: "phone_ai_preferences" | "human_pause" | "leads" | "default" | "error";
  ai_disabled: boolean;
  /**
   * True quando o `ai_disabled` veio do desligamento em massa do SISTEMA (script
   * SQL direto, sem usuário) e não de uma ação manual ou pausa humana:
   *   - pref `ai_disabled=true` com `set_by IS NULL`, ou
   *   - fallback `leads.ai_disabled=true` com `ai_disabled_at IS NULL`
   * (todo toggle manual da UI grava `set_by`/`ai_disabled_at`; ver useCopilotToggle).
   *
   * O caller pode tratar esse caso como reativável-no-inbound: quando o lead
   * escreve, religa SÓ aquele contato e responde. Pausa humana e desligamento
   * manual continuam com systemDisabled=false (seguem bloqueando).
   */
  systemDisabled: boolean;
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
      return { canceled: false, source: "default", ai_disabled: false, systemDisabled: false };
    }

    // CRITICAL: normalize using the SAME function used by the canonical RPCs
    // (normalize_brazilian_phone in SQL → normalizePhoneForSearch mirror in TS).
    // Output format: 11 digits for mobile, 10 for landline, NO "55" prefix.
    //
    // DO NOT use normalizeBrazilianPhone from whatsapp-dispatch.ts here — that
    // function adds the "55" prefix because the WhatsApp provider (Uazapi/
    // Evolution) requires it on outbound. Using it for DB lookups produces a
    // format mismatch against phone_ai_preferences.normalized_phone (stored
    // without the prefix), turning every gate into a silent fail-open.
    const normalized = normalizePhoneForSearch(phone);
    if (!normalized) {
      return { canceled: false, source: "default", ai_disabled: false, systemDisabled: false };
    }

    // 1. Source of truth: phone_ai_preferences (PK organization_id, normalized_phone).
    // Cobre DOIS gates phone-keyed: ai_disabled (toggle permanente) e
    // human_paused_until (pausa temporária quando humano assume — RC human-pause).
    const { data: pref, error: prefErr } = await supabase
      .from("phone_ai_preferences")
      .select("ai_disabled, human_paused_until, set_by")
      .eq("organization_id", organizationId)
      .eq("normalized_phone", normalized)
      .maybeSingle();

    if (prefErr) {
      console.warn("[isCopilotCanceled] phone_ai_preferences read failed:", prefErr.message);
    } else if (pref) {
      // ai_disabled (toggle permanente) tem prioridade sobre a pausa temporária.
      if (pref.ai_disabled) {
        // set_by IS NULL → desligamento em massa do sistema (reativável no inbound).
        // set_by preenchido → ação manual de um usuário (segue bloqueando).
        return {
          canceled: true,
          ai_disabled: true,
          source: "phone_ai_preferences",
          systemDisabled: pref.set_by == null,
        };
      }
      // Pausa humana ativa: human_paused_until no futuro.
      if (pref.human_paused_until && new Date(pref.human_paused_until as string) > new Date()) {
        return {
          canceled: true,
          ai_disabled: false,
          source: "human_pause",
          systemDisabled: false,
          reason: "human_pause_active",
        };
      }
      return { canceled: false, ai_disabled: false, source: "phone_ai_preferences", systemDisabled: false };
    }

    // 2. Fallback: leads.ai_disabled (lead mais recente pra esse telefone).
    // Query é por normalized_phone (canonical 11-digit, populado pelo trigger
    // leads_normalize_phone_trigger). Antes comparava contra leads.phone que
    // armazena raw — match dependia de coincidência de formato, então o
    // fallback quase nunca disparava. Agora alinhado com a coluna canônica.
    const { data: lead } = await supabase
      .from("leads")
      .select("ai_disabled, ai_disabled_at")
      .eq("organization_id", organizationId)
      .eq("normalized_phone", normalized)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lead) {
      const disabled = Boolean(lead.ai_disabled);
      return {
        canceled: disabled,
        ai_disabled: disabled,
        source: "leads",
        // Sem ai_disabled_at = assinatura do bulk SQL (toggle manual sempre grava _at).
        systemDisabled: disabled && lead.ai_disabled_at == null,
      };
    }

    return { canceled: false, source: "default", ai_disabled: false, systemDisabled: false };
  } catch (e) {
    console.warn("[isCopilotCanceled] exception (fail-open):", e);
    return {
      canceled: false,
      source: "error",
      ai_disabled: false,
      systemDisabled: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Reativação REATIVA disparada por mensagem do lead.
 *
 * Religa o copilot SÓ para este contato e SÓ quando o desligamento foi o bulk
 * do sistema (pref `set_by IS NULL` / lead `ai_disabled_at IS NULL`). Os guards
 * `.is(...)` garantem idempotência e blindam contra religar um desligamento
 * manual (Adriane) que tenha aparecido entre o check e a escrita.
 *
 * NÃO chamar dentro de isCopilotCanceled (gate puro, re-executado por chunk).
 * Caller único: agent-message no inbound, antes de processar o turno.
 */
export async function reactivateSystemDisabledContact(
  supabase: SupabaseClient,
  organizationId: string,
  phone: string,
  leadId: string | null,
): Promise<void> {
  try {
    const normalized = normalizePhoneForSearch(phone);
    if (normalized) {
      const { error: prefErr } = await supabase
        .from("phone_ai_preferences")
        .update({ ai_disabled: false })
        .eq("organization_id", organizationId)
        .eq("normalized_phone", normalized)
        .is("set_by", null);
      if (prefErr) {
        console.warn("[reactivateSystemDisabledContact] pref update failed:", prefErr.message);
      }
    }

    if (leadId) {
      const { error: leadErr } = await supabase
        .from("leads")
        .update({ ai_disabled: false, ai_disabled_at: null })
        .eq("id", leadId)
        .eq("ai_disabled", true)
        .is("ai_disabled_at", null);
      if (leadErr) {
        console.warn("[reactivateSystemDisabledContact] lead update failed:", leadErr.message);
      }
    }
  } catch (e) {
    // Non-fatal: se a reativação falhar, o pior caso é o turno seguir bloqueado.
    console.warn("[reactivateSystemDisabledContact] exception (non-fatal):", e);
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
