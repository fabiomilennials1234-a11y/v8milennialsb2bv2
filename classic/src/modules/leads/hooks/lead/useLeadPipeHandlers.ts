/**
 * useLeadPipeHandlers — handlers de alto nível para operações de pipeline.
 *
 * Onda 3.1, C12. Extrai handleMoveStage, handleRemoveFromPipeline,
 * handleAddToPipeline do shell LeadDetailContent, reduzindo LOC do shell.
 * Delega para mutations existentes sem reimplementar lógica.
 */

import { toast } from "sonner";
import {
  useAddLeadToStandardPipe,
  useMoveLeadInStandardPipe,
  useRemoveLeadFromStandardPipe,
  type PipelineStatus,
} from "../useLeadAllPipelines";
import { usePipeOps } from "../../pipe-ops";
import { notifyError, toAppError } from "@/shared/errors";

interface UsePipeHandlersResult {
  isMutating: boolean;
  moveStage: (pipeline: PipelineStatus, newStageId: string) => Promise<void>;
  removeFromPipeline: (pipeline: PipelineStatus) => Promise<void>;
  addToPipeline: (pipeline: PipelineStatus, stageId: string) => Promise<void>;
}

export function useLeadPipeHandlers(leadId: string | null | undefined): UsePipeHandlersResult {
  const { useAddLeadToCustomPipe, useMoveLeadInCustomPipe, useRemoveLeadFromCustomPipe } = usePipeOps();
  const addToStandard = useAddLeadToStandardPipe();
  const moveInStandard = useMoveLeadInStandardPipe();
  const removeFromStandard = useRemoveLeadFromStandardPipe();
  const addToCustom = useAddLeadToCustomPipe();
  const moveInCustom = useMoveLeadInCustomPipe();
  const removeFromCustom = useRemoveLeadFromCustomPipe();

  const isMutating =
    addToStandard.isPending || moveInStandard.isPending ||
    removeFromStandard.isPending || addToCustom.isPending ||
    moveInCustom.isPending || removeFromCustom.isPending;

  const moveStage = async (pipeline: PipelineStatus, newStageId: string) => {
    if (!leadId) return;
    if (pipeline.type === "standard" && pipeline.pipeId) {
      await moveInStandard.mutateAsync({ pipeId: pipeline.pipeId, pipeType: pipeline.pipeType, newStageId });
      const stageName = pipeline.stages.find((s) => s.id === newStageId)?.label;
      toast.success(`Movido para "${stageName}"`);
    } else if (pipeline.type === "custom" && pipeline.entryId) {
      await moveInCustom.mutateAsync({ entry_id: pipeline.entryId, pipeline_id: pipeline.pipelineId, stage_id: newStageId });
      const stageName = pipeline.stages.find((s) => s.id === newStageId)?.name;
      toast.success(`Movido para "${stageName}"`);
    }
  };

  const removeFromPipeline = async (pipeline: PipelineStatus) => {
    if (!leadId) return;
    if (pipeline.type === "standard" && pipeline.pipeId) {
      await removeFromStandard.mutateAsync({ pipeId: pipeline.pipeId, pipeType: pipeline.pipeType });
      toast.success(`Removido de "${pipeline.label}"`);
    } else if (pipeline.type === "custom" && pipeline.entryId) {
      await removeFromCustom.mutateAsync({ entry_id: pipeline.entryId, pipeline_id: pipeline.pipelineId });
      toast.success(`Removido de "${pipeline.pipelineName}"`);
    }
  };

  const addToPipeline = async (pipeline: PipelineStatus, stageId: string) => {
    if (!leadId) return;
    try {
      if (pipeline.type === "standard") {
        await addToStandard.mutateAsync({ leadId, pipeType: pipeline.pipeType, stageId });
        toast.success(`Adicionado a "${pipeline.label}"`);
      } else if (pipeline.type === "custom") {
        await addToCustom.mutateAsync({ pipeline_id: pipeline.pipelineId, lead_id: leadId, stage_id: stageId });
        toast.success(`Adicionado a "${pipeline.pipelineName}"`);
      }
    } catch (error: unknown) {
      // Pelo código, não pelo texto: o erro do Supabase é objeto simples, e o
      // `instanceof Error ? .message : ""` antigo devolvia "" — o aviso de
      // duplicado nunca aparecia (ADR-0038).
      if (toAppError(error).code === "record.duplicate") toast.info("Lead já está neste funil");
      else notifyError(error, { fallback: "Não foi possível adicionar o lead ao funil." });
    }
  };

  return { isMutating, moveStage, removeFromPipeline, addToPipeline };
}
