import type { ActionInput, ActionResult } from "./types.ts";

/** Opt-in movement for workflows that must preserve the exact deal and current stage. */
export async function moveCustomStageSafely(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, entryId, params } = input;
  const expected = params.expected_stage_ids;
  if (!leadId || !params.target_pipe || !params.target_stage ||
      !Array.isArray(expected) || expected.length === 0 ||
      expected.some((id) => typeof id !== "string")) {
    return { success: false, retryable: false, error: "Movimentação segura exige lead, funil, destino e etapas de origem." };
  }
  const { data, error } = await supabase.rpc("workflow_move_custom_entry_safely", {
    p_organization_id: organizationId,
    p_lead_id: leadId,
    p_entry_id: entryId ?? null,
    p_pipeline_id: params.target_pipe,
    p_target_stage: params.target_stage,
    p_expected_stage_ids: expected,
  });
  if (error) {
    return { success: false, retryable: !["42501", "22023"].includes(error.code ?? ""),
      error: error.message };
  }
  if (!data || typeof data !== "object" || !["moved", "skipped"].includes(data.status)) {
    return { success: false, retryable: false, error: "Movimentação segura não retornou confirmação." };
  }
  return {
    success: true,
    message: data.status === "moved" ? "Negócio da execução movido." : "Etapa preservada: " + data.reason,
    data: { ...data, target_stage: data.stage_key ?? params.target_stage, target_pipe: params.target_pipe },
  };
}
