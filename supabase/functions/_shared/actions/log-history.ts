/**
 * Mapping action_type → lead_history entry + logger.
 *
 * Stage actions são puladas porque PG triggers (trg_pipe_*_stage_change) já
 * registram automaticamente.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ActionResult } from "./types.ts";

interface HistoryMapping {
  action: string;
  descriptionFn: (payload: Record<string, unknown>, result: ActionResult) => string;
  source: "agent" | "automation" | "system";
}

const PIPE_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  confirmacao: "Confirmação",
  propostas: "Propostas",
  upsell_base: "Carteira Base",
  upsell_gestao: "Carteira Gestão",
  campanha: "Campanhas",
};

const ACTION_HISTORY_MAP: Record<string, HistoryMapping> = {
  schedule_meeting: {
    action: "meeting_scheduled",
    descriptionFn: (p) => `Reunião agendada para ${p.preferred_date || "data não informada"} pelo Copilot`,
    source: "agent",
  },
  create_lead: {
    action: "lead_created",
    descriptionFn: (p) => `Lead criado pelo Copilot: ${p.name || "sem nome"}`,
    source: "agent",
  },
  update_lead: {
    action: "field_updated",
    descriptionFn: (p) => {
      const updates = p.updates as Record<string, unknown> | undefined;
      const fields = updates ? Object.keys(updates).join(", ") : "campos";
      return `Campos atualizados pelo Copilot: ${fields}`;
    },
    source: "agent",
  },
  transfer_to_human: {
    action: "ai_toggled",
    descriptionFn: () => "Transferido para atendimento humano pelo Copilot",
    source: "agent",
  },
  transfer_to_human_notify: {
    action: "ai_toggled",
    descriptionFn: (p) => `Copilot transferiu: ${p.reason || "sem motivo informado"}`,
    source: "agent",
  },
  transfer_sz_chat: {
    action: "ai_toggled",
    descriptionFn: (p) => `Copilot transferiu para setor SZ.chat: ${p.target_team_name || "setor não informado"}`,
    source: "agent",
  },
  update_qualification_score: {
    action: "field_updated",
    descriptionFn: (p) => `Score de qualificação atualizado para ${p.score || 0} pelo Copilot`,
    source: "agent",
  },
  advance_stage: {
    action: "stage_changed",
    descriptionFn: (p) => {
      const pipe = PIPE_LABELS[(p.target_pipe as string) || "whatsapp"] || p.target_pipe;
      return `Movido para ${p.target_stage} em ${pipe} pelo Copilot`;
    },
    source: "agent",
  },
  confirm_meeting: {
    action: "meeting_attended",
    descriptionFn: (p) => {
      const type = p.confirmation_type === "confirmed" ? "confirmada" : "pré-confirmada";
      return `Reunião ${type} pelo Copilot`;
    },
    source: "agent",
  },
  advance_confirmation_stage: {
    action: "stage_changed",
    descriptionFn: (p) => `Movido para ${p.target_stage} no funil Confirmação pelo Copilot`,
    source: "agent",
  },
  create_custom_field: {
    action: "field_updated",
    descriptionFn: (p) => `Campo personalizado "${p.field_name}" criado pelo Copilot`,
    source: "agent",
  },
  automation_qualify: {
    action: "stage_changed",
    descriptionFn: () => "Lead qualificado pelo Copilot",
    source: "automation",
  },
  automation_disqualify: {
    action: "stage_changed",
    descriptionFn: () => "Lead desqualificado pelo Copilot",
    source: "automation",
  },
  automation_need_human: {
    action: "ai_toggled",
    descriptionFn: () => "Transferido para humano por automação do Copilot",
    source: "automation",
  },
  update_pipeline_stage: {
    action: "stage_changed",
    descriptionFn: (p) => `Pipeline atualizado para ${p.new_stage} pelo Copilot`,
    source: "agent",
  },
  send_document: {
    action: "document_sent",
    descriptionFn: (payload) =>
      `Documento "${payload.file_name || "arquivo"}" enviado ao lead via WhatsApp`,
    source: "agent",
  },
};

const STAGE_AI_ACTIONS = new Set<string>([
  "advance_stage",
  "advance_confirmation_stage",
  "automation_qualify",
  "automation_disqualify",
  "update_pipeline_stage",
]);

export async function logToLeadHistory(
  supabase: SupabaseClient,
  params: {
    leadId: string;
    organizationId: string;
    actionType: string;
    payload: Record<string, unknown>;
    result: ActionResult;
  },
): Promise<void> {
  try {
    const mapping = ACTION_HISTORY_MAP[params.actionType];
    if (!mapping) return;
    if (STAGE_AI_ACTIONS.has(params.actionType)) return;

    await supabase.from("lead_history").insert({
      lead_id: params.leadId,
      action: mapping.action,
      description: `Copilot: ${mapping.descriptionFn(params.payload, params.result)}`,
      source: mapping.source,
      organization_id: params.organizationId,
      metadata: {
        action_type: params.actionType,
        ...(params.result.data || {}),
      },
      created_by: null,
    });
  } catch (err) {
    console.warn("[actions/log-history] Failed to log to lead_history (non-fatal):", err);
  }
}
