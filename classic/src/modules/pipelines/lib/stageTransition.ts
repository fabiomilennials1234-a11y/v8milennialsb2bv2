import { moverNegocio } from "./moverNegocio";

/** Transfere a posição original; nunca procura outra venda do mesmo lead. */
export async function upsertLeadIntoCustomPipe(params: {
  sourceEntryId: string;
  sourceStageKey?: string;
  leadId: string;
  organizationId: string;
  targetPipelineId: string;
  targetStageId: string;
}): Promise<void> {
  if (!params.sourceEntryId) throw new Error("Negócio de origem não informado");
  await moverNegocio({
    entryId: params.sourceEntryId,
    targetPipelineId: params.targetPipelineId,
    targetStageKey: params.targetStageId,
    stageOrigem: params.sourceStageKey ?? null,
  });
}
