/**
 * AI Action handlers — movimentação entre etapas/funis.
 *
 *  - executeAdvanceStage: muda lead de stage no pipe alvo
 *  - executeUpdatePipelineStage: atalho específico do funil WhatsApp
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ActionResult } from "./types.ts";
import { upsertPipeEntryDetailed } from "../pipeline-adapter.ts";
import type { PipeSlug } from "../pipeline-adapter.ts";
import { assertPermission } from "../assert-permission.ts";

export interface MoveCardOptions {
  /** When provided, enforces move_pipe_record permission. Omit for AI/automation calls. */
  userId?: string;
}

const PIPE_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  confirmacao: "Confirmação",
  propostas: "Propostas",
  upsell_base: "Carteira Base",
  upsell_gestao: "Carteira Gestão",
  campanha: "Campanhas",
};

export async function executeAdvanceStage(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
  tenantId: string,
  options?: MoveCardOptions,
): Promise<ActionResult> {
  const lead_id = params.lead_id as string;
  const target_stage = params.target_stage as string;
  const target_pipe = (params.target_pipe as string) || "whatsapp";

  if (!lead_id || !target_stage) {
    return { success: false, error: "lead_id e target_stage são obrigatórios" };
  }

  // Permission gate: enforce when userId is provided (user-initiated calls)
  if (options?.userId) {
    const permission = await assertPermission(supabase, options.userId, tenantId, "move_pipe_record");
    if (!permission.allowed) {
      return { success: false, error: `Permission denied: move_pipe_record`, data: { reason: permission.reason } };
    }
  }

  const normalizedStage = String(target_stage).trim().toLowerCase();

  // Validar etapa contra pipeline_stages
  const { data: stages } = await supabase
    .from("pipeline_stages")
    .select("stage_key")
    .eq("organization_id", tenantId)
    .eq("pipeline_type", target_pipe)
    .eq("is_active", true);

  const validKeys = (stages || []).map((s: { stage_key: string }) => s.stage_key);
  const stageKeys =
    validKeys.length > 0
      ? validKeys
      : target_pipe === "whatsapp"
        ? ["novo", "abordado", "respondeu", "esfriou", "agendado"]
        : [];

  if (
    stageKeys.length > 0 &&
    !stageKeys.some((k: string) => k.toLowerCase() === normalizedStage)
  ) {
    return {
      success: false,
      error: `Etapa inválida para funil ${target_pipe}. Use: ${stageKeys.join(", ")}`,
    };
  }

  const finalStage =
    stageKeys.find((k: string) => k.toLowerCase() === normalizedStage) || normalizedStage;

  switch (target_pipe) {
    case "whatsapp":
    case "confirmacao":
    case "propostas": {
      // SCRUM-202: o espelho `leads.pipe_whatsapp` saiu do ramo `whatsapp`. A
      // escrita em `pipeline_entries` logo abaixo roda em `pg_trigger_depth() = 1`
      // e dispara `trg_sync_whatsapp_stage_to_lead`, que grava a mesma coluna com
      // o mesmo valor. Escrever de novo era duplicação — e vira erro no DROP da
      // fatia 3. Os três ramos colapsaram num só porque essa era a única
      // diferença entre eles.
      const result = await upsertPipeEntryDetailed(supabase, {
        leadId: lead_id, orgId: tenantId, slug: target_pipe as PipeSlug, stageKey: finalStage,
      });
      if (result.status !== "created" && result.status !== "updated") {
        return { success: false, error: `Falha ao atualizar pipeline_entries para ${target_pipe}/${finalStage}` };
      }
      break;
    }
    case "upsell_base":
      await supabase
        .from("upsell_clients")
        .update({ tipo_cliente_tempo: finalStage })
        .eq("lead_id", lead_id);
      break;
    case "upsell_gestao":
      await supabase
        .from("upsell_clients")
        .update({ gestao_stage: finalStage })
        .eq("lead_id", lead_id);
      break;
    case "campanha": {
      const { data: campStage } = await supabase
        .from("campanha_stages")
        .select("id")
        .ilike("name", finalStage)
        .limit(1)
        .maybeSingle();
      if (campStage) {
        await supabase
          .from("campanha_leads")
          .update({ stage_id: campStage.id })
          .eq("lead_id", lead_id);
      }
      break;
    }
    default:
      return { success: false, error: `Funil não suportado: ${target_pipe}` };
  }

  return {
    success: true,
    message: `Lead movido para ${finalStage} no funil ${PIPE_LABELS[target_pipe] || target_pipe}`,
    data: { target_stage: finalStage, target_pipe },
  };
}

export async function executeUpdatePipelineStage(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
  organizationId: string,
  options?: MoveCardOptions,
): Promise<ActionResult> {
  const leadId = params.lead_id as string;
  const newStage = params.new_stage as string;

  if (!leadId || !newStage) {
    return { success: false, error: "lead_id e new_stage são obrigatórios" };
  }

  // Permission gate: enforce when userId is provided (user-initiated calls)
  if (options?.userId) {
    const permission = await assertPermission(supabase, options.userId, organizationId, "move_pipe_record");
    if (!permission.allowed) {
      return { success: false, error: `Permission denied: move_pipe_record`, data: { reason: permission.reason } };
    }
  }

  const result = await upsertPipeEntryDetailed(supabase, {
    leadId, orgId: organizationId, slug: "whatsapp", stageKey: newStage,
  });
  if (result.status !== "created" && result.status !== "updated") {
    return { success: false, error: `Falha ao atualizar pipeline_entries para whatsapp/${newStage}` };
  }
  // Espelho `leads.pipe_whatsapp` removido — ver nota em executeAdvanceStage.

  return {
    success: true,
    message: `Pipeline atualizado para ${newStage}`,
    data: { new_stage: newStage },
  };
}
