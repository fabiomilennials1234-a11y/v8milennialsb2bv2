/**
 * AI Action handlers — transferência humana.
 *
 *  - immediateTransferHuman: chamada inline pelo agent-engine, atômica via RPC
 *  - executeTransferHuman: handler async (queue) com mensagem time-aware
 *  - executeTransferHumanNotify: side-effects (notification + lead_history)
 *  - executeTransferSzChat: transferência pra setor SZ.chat externo
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  loadAgentTimeContext,
  resolveActiveWindow,
} from "../copilot/time-context.ts";
import { getPipeEntry, tryResolvePipelineId, updatePipeEntryById } from "../pipeline-adapter.ts";
import type { PipelineRef } from "../pipeline-adapter.ts";
import type { ActionResult } from "./types.ts";
import { isCopilotCanceled } from "../copilot/cancellation.ts";
import {
  buildSameTurnHandoffMarker,
  type SameTurnHandoffMarker,
} from "../copilot/same-turn-handoff.ts";

/**
 * Transferência atômica via RPC. Usada pelo agent-engine antes de enfileirar
 * side-effects (notificação, history). Mantém leads.ai_disabled e
 * conversations.state em sync.
 *
 * `pipelineRef` (SCRUM-628): funil onde procurar a etapa de "atendimento
 * humano" — vem das kanban rules do agente. Ausente → "whatsapp" (legado).
 *
 * `opts.skipHumanStageMove`: o turno também tem ADVANCE_STAGE explícito. A
 * transferência roda INLINE antes da fila; mover o card para
 * `atendimento_humano` aqui seria sobrescrito pela ADVANCE_STAGE logo depois
 * (ordem do worker não é garantida). A etapa explícita do turno vence; o
 * handoff continua marcado por `leads.ai_disabled` (RPC).
 *
 * `opts.captureHandoffMarker`: o turno também enfileira mídia. O worker de
 * mídia cancela quando a IA está desligada — e este RPC a desliga. Lê o gate
 * canônico antes e depois do RPC e devolve `handoffMarker` (carimbo do
 * desligamento causado AQUI) só se a IA estava ligada antes. Ver
 * `_shared/copilot/same-turn-handoff.ts`. Custo (até 5 leituras) só é pago
 * quando pedido.
 */
export async function immediateTransferHuman(
  supabase: SupabaseClient,
  leadId: string,
  pipelineRef?: PipelineRef,
  opts?: { skipHumanStageMove?: boolean; captureHandoffMarker?: boolean },
): Promise<{ success: boolean; error?: string; handoffMarker?: SameTurnHandoffMarker | null }> {
  try {
    const gate = opts?.captureHandoffMarker ? await loadCancellationKey(supabase, leadId) : null;
    const before = gate ? await isCopilotCanceled(supabase, gate.organizationId, gate.phone) : null;

    const { error } = await supabase.rpc("transfer_lead_to_human", {
      p_lead_id: leadId,
    });

    if (error) {
      console.warn("[immediateTransferHuman] RPC failed:", error.message);
      return { success: false, error: error.message };
    }

    let handoffMarker: SameTurnHandoffMarker | null = null;
    if (gate && before) {
      const after = await isCopilotCanceled(supabase, gate.organizationId, gate.phone);
      handoffMarker = buildSameTurnHandoffMarker(leadId, before, after);
    }

    console.log("[immediateTransferHuman] Transfer executed atomically for lead:", leadId);

    // Move lead to human-handoff stage in the agent's pipeline (if org has one)
    if (!opts?.skipHumanStageMove) {
      await moveLeadToHumanStage(supabase, leadId, pipelineRef ?? "whatsapp");
    }

    return opts?.captureHandoffMarker ? { success: true, handoffMarker } : { success: true };
  } catch (err) {
    console.warn("[immediateTransferHuman] Unexpected error:", err);
    return { success: false, error: String(err) };
  }
}

/** Chave do gate de cancelamento (org + telefone) do lead. Falha → null. */
async function loadCancellationKey(
  supabase: SupabaseClient,
  leadId: string,
): Promise<{ organizationId: string; phone: string } | null> {
  try {
    const { data } = await supabase
      .from("leads")
      .select("organization_id, phone")
      .eq("id", leadId)
      .maybeSingle();
    const organizationId = (data as { organization_id?: unknown } | null)?.organization_id;
    const phone = (data as { phone?: unknown } | null)?.phone;
    if (typeof organizationId !== "string" || typeof phone !== "string" || !phone) return null;
    return { organizationId, phone };
  } catch {
    return null;
  }
}

const HUMAN_STAGE_KEYS = ["atendimento_humano", "aguardando_humano", "aguardando_atendimento"];

async function moveLeadToHumanStage(
  supabase: SupabaseClient,
  leadId: string,
  pipelineRef: PipelineRef,
): Promise<void> {
  try {
    const { data: lead } = await supabase
      .from("leads")
      .select("organization_id")
      .eq("id", leadId)
      .single();

    if (!lead?.organization_id) return;

    // SCRUM-628: o funil deixou de ser `pipeline_type='whatsapp'` fixo — a ref
    // (uuid ou slug, qualquer funil da org) resolve via adapter e a busca de
    // etapa passa a ser por `pipeline_id`, que cobre também funil custom.
    const pipelineId = await tryResolvePipelineId(supabase, lead.organization_id, pipelineRef);
    if (!pipelineId) {
      console.log("[moveLeadToHumanStage] Funil não resolvido, skipping pipeline move", { pipelineRef });
      return;
    }

    // Find human-handoff stage: first by known keys, then by name pattern
    let stage: { stage_key: string } | null = null;

    const { data: byKey } = await supabase
      .from("pipeline_stages")
      .select("stage_key")
      .eq("organization_id", lead.organization_id)
      .eq("pipeline_id", pipelineId)
      .eq("is_active", true)
      .in("stage_key", HUMAN_STAGE_KEYS)
      .limit(1)
      .maybeSingle();

    if (byKey) {
      stage = byKey;
    } else {
      const { data: byName } = await supabase
        .from("pipeline_stages")
        .select("stage_key")
        .eq("organization_id", lead.organization_id)
        .eq("pipeline_id", pipelineId)
        .eq("is_active", true)
        .or("name.ilike.%humano%,name.ilike.%atendimento human%")
        .limit(1)
        .maybeSingle();

      if (byName) stage = byName;
    }

    if (!stage) {
      console.log("[moveLeadToHumanStage] No human-handoff stage found for org, skipping pipeline move");
      return;
    }

    // ADR-0023 §3: MOVE, nunca upsert — o `upsertPipeEntry` antigo CRIAVA o
    // negócio quando o lead não tinha entry no funil, a partir de uma
    // transferência. Sem negócio → só a transferência acontece (ai_disabled +
    // WAITING_HUMAN já foram feitos pela RPC), o funil não muda.
    const entry = await getPipeEntry(supabase, leadId, lead.organization_id, pipelineId);
    if (!entry) {
      console.log("[moveLeadToHumanStage] Lead sem negócio no funil; transferência sem move (§3).", { leadId, pipelineId });
      return;
    }
    if (entry.stage_key === stage.stage_key) return;

    const ok = await updatePipeEntryById(supabase, entry.id, { stageKey: stage.stage_key });
    if (ok) {
      console.log(`[moveLeadToHumanStage] Lead ${leadId} moved to stage ${stage.stage_key}`);
    }
  } catch (err) {
    // Non-fatal: transfer already succeeded, pipeline move is best-effort
    console.warn("[moveLeadToHumanStage] Failed (non-fatal):", err);
  }
}

export async function executeTransferHuman(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
  conversationId: string | null,
): Promise<ActionResult> {
  const lead_id = params.lead_id as string;
  if (!lead_id) return { success: false, error: "lead_id é obrigatório" };

  await supabase
    .from("leads")
    .update({ ai_disabled: true, ai_disabled_at: new Date().toISOString() })
    .eq("id", lead_id);

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("lead_id", lead_id)
    .maybeSingle();

  if (conversation) {
    await supabase
      .from("conversations")
      .update({ state: "WAITING_HUMAN" })
      .eq("id", conversation.id);
  }

  // F5b: Time-Aware — mensagem variável por janela ativa do agente.
  let message = "Conversa transferida para humano";
  if (conversationId) {
    const ctx = await loadAgentTimeContext(supabase, conversationId);
    const windows = ctx?.behavior_windows ?? [];
    if (windows.length > 0) {
      const active = resolveActiveWindow({
        behavior_windows: windows,
        availability: ctx?.availability ?? null,
      });
      if (active && active.hasBehavior) {
        message = `Transferindo agora — janela ativa: "${active.window.name}"`;
      } else {
        message = "Transferido para humano. Time fora do horário comercial agora — retorno em horário comercial.";
      }
    }
  }

  return { success: true, message };
}

/**
 * Side-effects only: notificação + audit. ai_disabled + WAITING_HUMAN já foram
 * setados por immediateTransferHuman.
 */
export async function executeTransferHumanNotify(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
  organizationId: string,
  leadId: string | null,
): Promise<ActionResult> {
  if (!leadId) return { success: false, error: "lead_id é obrigatório" };

  const reason = (params.reason as string) || "sem motivo informado";

  const { data: lead } = await supabase
    .from("leads")
    .select("name, company, responsible_id")
    .eq("id", leadId)
    .single();

  const leadLabel = lead?.name
    ? lead.company
      ? `${lead.name} - ${lead.company}`
      : lead.name
    : "Lead";

  let notifyUserIds: string[] = [];

  if (lead?.responsible_id) {
    const { data: member } = await supabase
      .from("team_members")
      .select("user_id")
      .eq("id", lead.responsible_id)
      .not("user_id", "is", null)
      .single();

    if (member?.user_id) {
      notifyUserIds = [member.user_id];
    }
  }

  if (notifyUserIds.length === 0) {
    const { data: members } = await supabase
      .from("team_members")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .not("user_id", "is", null);

    notifyUserIds = (members ?? []).map((m) => m.user_id).filter(Boolean) as string[];
  }

  for (const userId of notifyUserIds) {
    try {
      await supabase.from("notifications").insert({
        organization_id: organizationId,
        user_id: userId,
        type: "transfer_to_human",
        title: "Lead precisa de atendimento humano",
        description: `${leadLabel}: ${reason}`,
        lead_id: leadId,
        link: "/pipe-whatsapp",
      });
    } catch (notifErr) {
      console.warn("[executeTransferHumanNotify] Failed to create notification:", notifErr);
    }
  }

  console.log(
    `[executeTransferHumanNotify] Notified ${notifyUserIds.length} user(s) for lead ${leadId}`,
  );
  return {
    success: true,
    message: `Notificação enviada para ${notifyUserIds.length} usuário(s)`,
  };
}

export async function executeTransferSzChat(
  supabase: SupabaseClient,
  leadId: string | null,
  organizationId: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  if (!leadId) return { success: false, error: "lead_id é obrigatório" };

  const { data: session } = await supabase
    .from("sz_chat_sessions")
    .select("sz_chat_session_id")
    .eq("lead_id", leadId)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session?.sz_chat_session_id) {
    return { success: false, error: "No active SZ.chat session for this lead" };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const res = await fetch(`${supabaseUrl}/functions/v1/sz-chat-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      action: "transfer_back",
      organization_id: organizationId,
      session_id: session.sz_chat_session_id,
      target_team_name: params.target_team_name,
      target_team_id: params.target_team_id,
    }),
  });

  const result = await res.json();
  if (!res.ok || !result.success) {
    return { success: false, error: result.error || "Transfer failed" };
  }

  await supabase
    .from("leads")
    .update({ ai_disabled: true, ai_disabled_at: new Date().toISOString() })
    .eq("id", leadId);

  return { success: true, message: "Conversa transferida para setor SZ.chat" };
}
