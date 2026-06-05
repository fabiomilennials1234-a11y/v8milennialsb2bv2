import { supabase } from "@/integrations/supabase/client";

/**
 * Insere (ou move) um lead em um funil customizado como destino de transição
 * automática de uma etapa de sucesso.
 *
 * Idempotente por (lead, pipeline): se o lead já tem entry no funil destino,
 * move a entry para a etapa destino; senão cria nova. Espelha o branch
 * custom→custom de `useMoveLeadInCustomPipe`.
 *
 * Segurança: `organizationId` vem do contexto de auth do chamador. RLS em
 * `custom_pipe_entries` (organization_id = get_user_organization_id()) é o gate
 * final — insert/update cross-org falha no Postgres.
 */
export async function upsertLeadIntoCustomPipe(params: {
  leadId: string;
  organizationId: string;
  targetPipelineId: string;
  targetStageId: string;
}): Promise<void> {
  const { leadId, organizationId, targetPipelineId, targetStageId } = params;
  const now = new Date().toISOString();

  const { data: existingEntry } = await supabase
    .from("custom_pipe_entries")
    .select("id")
    .eq("lead_id", leadId)
    .eq("pipeline_id", targetPipelineId)
    .maybeSingle();

  if (existingEntry) {
    await supabase
      .from("custom_pipe_entries")
      .update({ stage_id: targetStageId, stage_changed_at: now })
      .eq("id", existingEntry.id);
  } else {
    await supabase.from("custom_pipe_entries").insert({
      lead_id: leadId,
      organization_id: organizationId,
      pipeline_id: targetPipelineId,
      stage_id: targetStageId,
      entered_at: now,
      stage_changed_at: now,
    });
  }
}
