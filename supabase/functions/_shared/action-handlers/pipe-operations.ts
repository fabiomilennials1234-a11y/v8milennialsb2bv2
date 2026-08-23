import type { ActionInput, ActionResult } from "./types.ts";
import {
  getPipeEntry,
  upsertPipeEntryDetailed,
  updatePipeEntryById,
  deletePipeEntry,
} from "../pipeline-adapter.ts";
import type { PipeSlug } from "../pipeline-adapter.ts";

const STANDARD_PIPES: readonly string[] = ["whatsapp", "confirmacao", "propostas"];

/**
 * Duplicate/add a lead into a pipe at a given stage.
 * Expects params.targetPipeType and params.targetPipeStage.
 */
export async function duplicateToPipe(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for duplicateToPipe" };
  }

  const targetPipeType = (params.targetPipeType as string) || "whatsapp";
  const targetPipeStage = (params.targetPipeStage as string) || "novo";

  // Verify lead exists
  const { data: lead } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) {
    return { success: false, error: "Lead not found" };
  }

  if (STANDARD_PIPES.includes(targetPipeType)) {
    // SCRUM-202: espelho `leads.pipe_whatsapp` removido. O upsert bate direto em
    // `pipeline_entries` (depth 1) e `trg_sync_whatsapp_stage_to_lead` grava a
    // coluna com o mesmo valor.
    // ADR-0023 decisão 3: se a org é manual-only e o lead não tem negócio no
    // funil alvo, o adapter devolve `skipped_deal_manual_only` e nada é criado.
    const result = await upsertPipeEntryDetailed(supabase, {
      leadId,
      orgId: organizationId,
      slug: targetPipeType as PipeSlug,
      stageKey: targetPipeStage,
    });

    if (result.status === "skipped_deal_manual_only") {
      return {
        success: true,
        message: `Não duplicado para ${targetPipeType}/${targetPipeStage}: organização abre negócio só por clique humano.`,
        data: { skipped: true, reason: "deal_manual_only" },
      };
    }
  }

  return { success: true, message: `Duplicated to ${targetPipeType}/${targetPipeStage}` };
}

/**
 * Remove a lead from a pipe entirely.
 * Expects params.pipeType.
 */
export async function removeFromPipe(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for removeFromPipe" };
  }

  const pipeType = (params.pipeType as string) || "whatsapp";

  if (STANDARD_PIPES.includes(pipeType)) {
    // SCRUM-202: espelho `leads.pipe_whatsapp = null` removido. `deletePipeEntry`
    // faz DELETE direto em `pipeline_entries` (depth 1), e o ramo DELETE de
    // `sync_pipeline_entry_to_lead_pipe_whatsapp` já zera a coluna
    // (20270803000040:65). Escrever NULL de novo era duplicação.
    await deletePipeEntry(supabase, leadId, organizationId, pipeType as PipeSlug);
  }

  return { success: true, message: `Removed from ${pipeType}` };
}

/**
 * Mark a lead as lost in a pipe. Logs to lead_history.
 * Expects params.pipeType and params.lostReason.
 */
export async function markAsLost(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for markAsLost" };
  }

  const pipeType = (params.pipeType as string) || "propostas";
  const reason = (params.lostReason as string) || "";

  if (STANDARD_PIPES.includes(pipeType)) {
    const entry = await getPipeEntry(
      supabase,
      leadId,
      organizationId,
      pipeType as PipeSlug,
    );

    if (entry) {
      const metaUpdate = pipeType === "propostas" ? { loss_reason_id: reason } : {};
      await updatePipeEntryById(supabase, entry.id, {
        stageKey: "perdido",
        metadata: metaUpdate,
      });
    }
  }

  // Log to lead_history (markAsLost is excluded from auto-logging in executeWorkflowAction)
  try {
    await supabase.from("lead_history").insert({
      lead_id: leadId,
      organization_id: organizationId,
      action: "marked_lost",
      description: `Marcado como perdido em ${pipeType}: ${reason}`,
      source: "automation",
      metadata: { pipeType, reason },
      created_by: null,
    });
  } catch (_err) {
    // Non-blocking — same pattern as workflow-action-handler logToHistory
  }

  return { success: true, message: `Marked as lost in ${pipeType}` };
}
