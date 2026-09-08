import type { ActionInput, ActionResult } from "./types.ts";
import {
  deletePipeEntry,
  getPipeEntry,
  isPipelineResolutionError,
  resolvePipeline,
  updatePipeEntryById,
  upsertPipeEntryDetailed,
} from "../pipeline-adapter.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StageRefRow {
  id: string;
  stage_key: string;
  stage_role: string | null;
  is_final_negative: boolean | null;
  position: number | null;
}

function pipelineError(error: unknown, ref: string): ActionResult {
  if (isPipelineResolutionError(error)) {
    return {
      success: false,
      error: `Funil "${ref}" não encontrado ou inativo (${error.code})`,
      retryable: error.code === "pipeline_lookup_failed",
    };
  }
  return { success: false, error: error instanceof Error ? error.message : String(error), retryable: true };
}

async function readActiveStages(
  input: ActionInput,
  pipelineId: string,
): Promise<{ rows: StageRefRow[]; error: string | null }> {
  const { data, error } = await input.supabase
    .from("pipeline_stages")
    .select("id, stage_key, stage_role, is_final_negative, position")
    .eq("organization_id", input.organizationId)
    .eq("pipeline_id", pipelineId)
    .eq("is_active", true)
    .order("position", { ascending: true });

  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as StageRefRow[], error: null };
}

/** UUID novo ou stage_key legado, sempre limitado ao funil e à organização. */
async function resolveStageKey(
  input: ActionInput,
  pipelineId: string,
  stageRef: string,
): Promise<{ stageKey: string | null; error: string | null }> {
  const stages = await readActiveStages(input, pipelineId);
  if (stages.error) return { stageKey: null, error: `Falha ao ler etapas do funil: ${stages.error}` };

  const wanted = stageRef.trim();
  const match = UUID_RE.test(wanted)
    ? stages.rows.find((stage) => stage.id === wanted)
    : stages.rows.find((stage) => stage.stage_key.toLowerCase() === wanted.toLowerCase());

  // Compatibilidade com funis legados ainda sem catálogo: stage_key textual já
  // era aceito. UUID nunca degrada, pois gravá-lo em stage_key criaria card fantasma.
  if (!match && stages.rows.length === 0 && !UUID_RE.test(wanted)) {
    return { stageKey: wanted, error: null };
  }
  if (!match) return { stageKey: null, error: `Etapa "${wanted}" não existe ou está inativa neste funil` };
  return { stageKey: match.stage_key, error: null };
}

/** Duplica/adiciona o lead em qualquer funil ativo. Novos nós usam UUIDs. */
export async function duplicateToPipe(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params } = input;
  if (!leadId) return { success: false, error: "leadId is required for duplicateToPipe" };

  const pipelineRef = String(params.pipelineId || params.targetPipeType || "").trim();
  if (!pipelineRef) return { success: false, error: "No target funnel configured" };

  const stageRef = String(params.targetStage || params.targetPipeStage || "").trim();
  if (!stageRef) return { success: false, error: "No target stage configured" };

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (leadError) return { success: false, error: `Falha ao validar lead: ${leadError.message}`, retryable: true };
  if (!lead) return { success: false, error: "Lead not found" };

  let pipeline;
  try {
    pipeline = await resolvePipeline(supabase, organizationId, pipelineRef);
  } catch (error) {
    return pipelineError(error, pipelineRef);
  }

  const stage = await resolveStageKey(input, pipeline.id, stageRef);
  if (!stage.stageKey) return { success: false, error: stage.error || "No target stage configured" };

  const upsert = await upsertPipeEntryDetailed(supabase, {
    leadId,
    orgId: organizationId,
    slug: pipeline.id,
    stageKey: stage.stageKey,
  });
  if (upsert.status !== "created" && upsert.status !== "updated") {
    return {
      success: false,
      error: `Falha ao adicionar negócio ao funil (${upsert.status})`,
      retryable: upsert.status === "read_failed" || upsert.status === "write_failed",
    };
  }

  return {
    success: true,
    message: `Negócio adicionado a ${pipeline.name || pipeline.slug}/${stage.stageKey}`,
    data: { pipelineId: pipeline.id, targetStage: stage.stageKey, entryId: upsert.entryId },
  };
}

/** Remove todas as posições correntes do lead no funil escolhido. */
export async function removeFromPipe(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params } = input;
  if (!leadId) return { success: false, error: "leadId is required for removeFromPipe" };

  const pipelineRef = String(params.pipelineId || params.pipeType || "").trim();
  if (!pipelineRef) return { success: false, error: "No funnel configured" };

  let pipeline;
  try {
    pipeline = await resolvePipeline(supabase, organizationId, pipelineRef);
  } catch (error) {
    return pipelineError(error, pipelineRef);
  }

  const removed = await deletePipeEntry(supabase, leadId, organizationId, pipeline.id);
  if (!removed) return { success: false, error: `Falha ao remover negócio do funil ${pipeline.name || pipeline.slug}`, retryable: true };

  return {
    success: true,
    message: `Negócio removido de ${pipeline.name || pipeline.slug}`,
    data: { pipelineId: pipeline.id },
  };
}

/** Move a posição corrente para a etapa semântica lost do funil escolhido. */
export async function markAsLost(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params } = input;
  if (!leadId) return { success: false, error: "leadId is required for markAsLost" };

  const pipelineRef = String(params.pipelineId || params.pipeType || "").trim();
  if (!pipelineRef) return { success: false, error: "No funnel configured" };
  const reason = String(params.lostReason || "").trim();

  let pipeline;
  try {
    pipeline = await resolvePipeline(supabase, organizationId, pipelineRef);
  } catch (error) {
    return pipelineError(error, pipelineRef);
  }

  const stages = await readActiveStages(input, pipeline.id);
  if (stages.error) return { success: false, error: `Falha ao ler etapas do funil: ${stages.error}`, retryable: true };
  const lostStage = stages.rows.find((stage) => stage.stage_role === "lost")
    ?? stages.rows.find((stage) => stage.is_final_negative === true);
  if (!lostStage) return { success: false, error: "No lost stage configured for funnel" };

  const entry = await getPipeEntry(supabase, leadId, organizationId, pipeline.id);
  if (!entry) return { success: false, error: `Lead não possui negócio no funil ${pipeline.name || pipeline.slug}` };

  const updated = await updatePipeEntryById(supabase, entry.id, {
    stageKey: lostStage.stage_key,
    metadata: reason ? { loss_reason: reason, loss_reason_id: reason } : {},
  });
  if (!updated) return { success: false, error: `Falha ao marcar negócio como perdido em ${pipeline.name || pipeline.slug}`, retryable: true };

  try {
    await supabase.from("lead_history").insert({
      lead_id: leadId,
      organization_id: organizationId,
      action: "marked_lost",
      description: `Marcado como perdido em ${pipeline.name || pipeline.slug}: ${reason}`,
      source: "automation",
      metadata: { pipelineId: pipeline.id, pipelineSlug: pipeline.slug, reason },
      created_by: null,
    });
  } catch (_error) {
    // Histórico é observabilidade auxiliar; não desfaz uma transição já gravada.
  }

  return {
    success: true,
    message: `Negócio marcado como perdido em ${pipeline.name || pipeline.slug}`,
    data: { pipelineId: pipeline.id, targetStage: lostStage.stage_key, entryId: entry.id },
  };
}
