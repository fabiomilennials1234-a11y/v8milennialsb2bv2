/**
 * AI Action handlers — movimentação entre etapas/funis.
 *
 *  - executeMoveEntryStage: move O NEGÓCIO lido no turn (entry_id), qualquer
 *    funil, sem upsert — caminho novo do Copilot (SCRUM-628)
 *  - executeAdvanceStage: muda lead de stage no pipe alvo (LEGADO — o dispatcher
 *    usa `action-handlers/move-stage.ts`; mantido só pelos testes de permissão)
 *  - executeUpdatePipelineStage: atalho por lead+funil (LEGADO, idem)
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ActionResult } from "./types.ts";
import {
  upsertPipeEntryDetailed,
  updatePipeEntryById,
} from "../pipeline-adapter.ts";
import type { PipeSlug } from "../pipeline-adapter.ts";
import { assertPermission } from "../assert-permission.ts";

/**
 * Move o negócio apontado por `entry_id` para outra etapa DO MESMO funil.
 *
 * Caminho novo do auto-avanço do Copilot (SCRUM-628): o decide-action já leu a
 * entry, escolheu a etapa-alvo por position/stage_role e mandou tudo no payload
 * (`entry_id`, `stage_id`, `new_stage`). Aqui:
 *
 *   1. relê a entry por id (pode ter sumido/mudado entre enfileirar e executar);
 *   2. confere org (defesa em profundidade — roda com service-role) e lead;
 *   3. valida a etapa-alvo contra as etapas ATIVAS do funil da entry;
 *   4. move via `updatePipeEntryById` — NUNCA upsert (ADR-0023 §3: automação
 *      não cria negócio; o espelho stage_id/stage_key é do trigger do banco).
 *
 * Funciona para QUALQUER funil (sistema ou custom) porque opera direto em
 * `pipeline_entries` por uuid — nenhum branch por slug.
 */
export async function executeMoveEntryStage(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
  organizationId: string,
): Promise<ActionResult> {
  const entryId = params.entry_id as string;
  const newStage = (params.new_stage as string) || "";
  const targetStageId = (params.stage_id as string) || null;

  if (!entryId || (!newStage && !targetStageId)) {
    return { success: false, error: "entry_id e new_stage (ou stage_id) são obrigatórios" };
  }

  const { data: entry, error: readError } = await supabase
    .from("pipeline_entries")
    .select("id, organization_id, lead_id, pipeline_id, stage_key")
    .eq("id", entryId)
    .maybeSingle();

  if (readError) {
    return { success: false, error: `Falha ao ler o negócio ${entryId}: ${readError.message}` };
  }
  if (!entry) {
    return { success: false, error: `Negócio ${entryId} não existe mais; nada movido` };
  }
  if (entry.organization_id !== organizationId) {
    return { success: false, error: "Negócio de outra organização; nada movido" };
  }
  if (params.lead_id && entry.lead_id && entry.lead_id !== params.lead_id) {
    return { success: false, error: "Negócio pertence a outro lead; nada movido" };
  }

  // Valida a etapa-alvo contra as etapas ATIVAS do funil da entry (nunca mover
  // para etapa fantasma). stage_id ganha quando presente; new_stage é o espelho.
  const { data: stages, error: stagesError } = await supabase
    .from("pipeline_stages")
    .select("id, stage_key")
    .eq("organization_id", organizationId)
    .eq("pipeline_id", entry.pipeline_id)
    .eq("is_active", true);

  if (stagesError) {
    return { success: false, error: `Falha ao ler etapas do funil: ${stagesError.message}` };
  }

  const target =
    (targetStageId && (stages ?? []).find((s: { id: string }) => s.id === targetStageId)) ||
    (stages ?? []).find(
      (s: { stage_key: string }) => s.stage_key.toLowerCase() === newStage.trim().toLowerCase(),
    ) ||
    null;

  if (!target) {
    return {
      success: false,
      error: `Etapa "${targetStageId ?? newStage}" não é etapa ativa do funil ${entry.pipeline_id}`,
    };
  }

  if (target.stage_key === entry.stage_key) {
    return {
      success: true,
      message: `Negócio já está em ${target.stage_key}`,
      data: { target_stage: target.stage_key, target_pipe: entry.pipeline_id, entry_id: entry.id },
    };
  }

  const ok = await updatePipeEntryById(supabase, entry.id, { stageKey: target.stage_key });
  if (!ok) {
    return { success: false, error: `Falha ao mover o negócio ${entry.id} para ${target.stage_key}` };
  }

  return {
    success: true,
    message: `Negócio movido para ${target.stage_key}`,
    data: {
      target_stage: target.stage_key,
      target_pipe: entry.pipeline_id,
      entry_id: entry.id,
      new_stage: target.stage_key,
    },
  };
}


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
