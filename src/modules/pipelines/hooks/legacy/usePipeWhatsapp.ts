import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { triggerFollowUpAutomation } from "@/modules/workflows/hooks/useAutoFollowUp";

import { useOrganization } from "@/modules/identity";
import { useCanDo } from "@/modules/identity";
import { OptimisticLockConflictError, isPostgrestNoRows } from "@/modules/platform/lib/optimistic-lock";
import { optimisticMovePipelineEntry, rollbackPipelineEntryMove, type OptimisticMoveSnapshot } from "@/modules/pipelines/lib/optimistic-move";
// Importa via o shim de path estável (`../usePipelineEntries`), não `../model/...`,
// para preservar o module-id que mocks de teste interceptam (slice 7.3-bis).
import { usePipelineEntries, usePipelineId, findOrCreatePipelineEntry } from "../model/usePipelineEntries";

export type PipeWhatsapp = Tables<"pipe_whatsapp">;
export type PipeWhatsappInsert = Partial<PipeWhatsapp> & { lead_id: string };
export type PipeWhatsappUpdate = Partial<PipeWhatsapp>;

// Definição canônica em contracts (quebra import direto leads→pipelines).
// Re-exportados aqui mantendo a API pública do hook inalterada.
export type { PipeWhatsappStatus } from "@/contracts/pipe";
export { whatsappStatusColumns as statusColumns } from "@/contracts/pipe";

export function usePipeWhatsapp() {
  return usePipelineEntries("whatsapp");
}

export function useCreatePipeWhatsapp() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { data: pipelineId } = usePipelineId("whatsapp");

  return useMutation({
    mutationFn: async (item: PipeWhatsappInsert) => {
      if (!organizationId) {
        throw new Error("Cannot create pipe_whatsapp: No organization context");
      }
      if (!pipelineId) {
        throw new Error("Cannot create pipe_whatsapp: Pipeline ID not resolved");
      }

      // Fase A descomissionamento (PRD #211 / Issue #214):
      // Legacy fields (sdr_id, responsible_id) are NOT written to metadata.
      // pipe_whatsapp não alimenta ranking de crédito; este cleanup mantém
      // simetria com confirmacao/propostas e elimina escrita legacy do harness.
      const metadata: Record<string, unknown> = {};
      if (item.pre_sale_responsible_id !== undefined) metadata.pre_sale_responsible_id = item.pre_sale_responsible_id;
      if (item.sale_responsible_id !== undefined) metadata.sale_responsible_id = item.sale_responsible_id;
      if ((item as any).scheduled_date !== undefined) metadata.scheduled_date = (item as any).scheduled_date;

      // assigned_to: dual fields first; legacy retained as transition fallback.
      const assignedToValue =
        item.pre_sale_responsible_id ?? item.responsible_id ?? item.sdr_id ?? null;

      const { entry: data, created } = await findOrCreatePipelineEntry({
        pipelineId,
        leadId: item.lead_id!,
        organizationId,
        stageKey: item.status ?? "novo",
        assignedTo: assignedToValue,
        metadata,
        notes: item.notes ?? null,
      });

      // Fire automation only for new entries — if we returned an existing one,
      // the original create already fired it.
      if (created) {
        await triggerFollowUpAutomation({
          leadId: data.lead_id,
          assignedTo: assignedToValue,
          pipeType: "whatsapp",
          stage: data.stage_key,
          sourcePipeId: data.id,
          organizationId: data.organization_id,
        });
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
    },
  });
}

export function useUpdatePipeWhatsapp() {
  const queryClient = useQueryClient();
  const movePermission = useCanDo("move_pipe_record");

  return useMutation({
    mutationFn: async ({
      id,
      leadId,
      sdrId,
      expectedUpdatedAt,
      ...updates
    }: PipeWhatsappUpdate & {
      id: string;
      leadId?: string;
      sdrId?: string | null;
      expectedUpdatedAt?: string;
    }) => {
      if (updates.status && !movePermission.allowed) {
        throw new Error(movePermission.isLoading
          ? "Permissões ainda carregando — tente novamente"
          : "Sem permissão para mover registros no pipe");
      }

      // fix2: só busca o metadata atual quando há mudança que exige merge
      // (responsáveis / scheduled_date). Um drag puro altera só `stage_key` e
      // não toca metadata — aí pulamos a viagem de SELECT prévia (−1 round trip
      // por move, o caminho quente do kanban).
      const touchesMetadata =
        updates.pre_sale_responsible_id !== undefined ||
        updates.sale_responsible_id !== undefined ||
        (updates as any).scheduled_date !== undefined;
      const touchesAssigned =
        touchesMetadata ||
        updates.responsible_id !== undefined ||
        updates.sdr_id !== undefined;

      let mergedMetadata: Record<string, unknown> | undefined;
      if (touchesAssigned) {
        // Fetch current entry to merge metadata
        const { data: current, error: fetchError } = await supabase
          .from("pipeline_entries")
          .select("metadata")
          .eq("id", id)
          .single();
        if (fetchError) throw fetchError;

        const currentMetadata = (current?.metadata as Record<string, any>) ?? {};
        // Fase A: dual-only metadata writes.
        const newMetadata: Record<string, unknown> = {};
        if (updates.pre_sale_responsible_id !== undefined) newMetadata.pre_sale_responsible_id = updates.pre_sale_responsible_id;
        if (updates.sale_responsible_id !== undefined) newMetadata.sale_responsible_id = updates.sale_responsible_id;
        if ((updates as any).scheduled_date !== undefined) newMetadata.scheduled_date = (updates as any).scheduled_date;
        mergedMetadata = { ...currentMetadata, ...newMetadata };
      }

      const updatePayload: Record<string, unknown> = {};
      if (mergedMetadata !== undefined) {
        updatePayload.metadata = mergedMetadata;
      }
      if (updates.status !== undefined) {
        updatePayload.stage_key = updates.status;
      }
      if (updates.notes !== undefined) {
        updatePayload.notes = updates.notes;
      }
      // assigned_to: prefer dual on the merged result; legacy retained as
      // transition fallback so historical entries still produce a usable FK.
      if (touchesAssigned && mergedMetadata) {
        updatePayload.assigned_to =
          mergedMetadata.pre_sale_responsible_id ??
          mergedMetadata.sale_responsible_id ??
          mergedMetadata.responsible_id ??
          mergedMetadata.sdr_id ??
          null;
      }

      let updateQuery = supabase
        .from("pipeline_entries")
        .update(updatePayload)
        .eq("id", id);
      if (expectedUpdatedAt) {
        updateQuery = updateQuery.eq("updated_at", expectedUpdatedAt);
      }
      const { data, error } = await updateQuery.select().single();

      if (error) {
        if (expectedUpdatedAt && isPostgrestNoRows(error)) {
          throw new OptimisticLockConflictError();
        }
        throw error;
      }

      // Sync sdr_id back to leads table
      const effectiveLeadId = leadId || data.lead_id;
      if (effectiveLeadId && updates.sdr_id !== undefined) {
        await supabase.from("leads").update({ sdr_id: updates.sdr_id || null }).eq("id", effectiveLeadId);
      }

      // Trigger automation if status changed.
      // Prefer dual snapshot fields; fall back to legacy keys on historical entries.
      if (updates.status && effectiveLeadId) {
        const meta = (data.metadata as Record<string, any>) ?? {};

        await triggerFollowUpAutomation({
          leadId: effectiveLeadId,
          assignedTo:
            sdrId ||
            meta.pre_sale_responsible_id ||
            meta.sale_responsible_id ||
            meta.sdr_id ||
            meta.responsible_id ||
            null,
          pipeType: "whatsapp",
          stage: updates.status,
          sourcePipeId: data.id,
          organizationId: data.organization_id,
        });


      }

      return data;
    },
    // fix1: move o card no cache do board na hora. Sem isso o card só reflete
    // no eco do Realtime (debounce 2s) → congelava ~2-3s por move.
    onMutate: async ({ id, status }): Promise<{ snapshot: OptimisticMoveSnapshot | null }> => {
      if (!status) return { snapshot: null };
      await queryClient.cancelQueries({ queryKey: ["pipeline-page", "whatsapp"] });
      const snapshot = optimisticMovePipelineEntry(queryClient, {
        slug: "whatsapp",
        id,
        toStage: status,
      });
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshot) rollbackPipelineEntryMove(queryClient, context.snapshot);
    },
    // fix3: invalida a chave REAL do board (`pipeline-page`/`pipeline-stage-counts`)
    // — antes invalidava `pipeline_entries` (não casava, no-op) e o board só
    // atualizava via Realtime. Uma reconciliação silenciosa; o card já está no
    // lugar pelo otimismo, então não há salto visual.
    onSettled: (_data, _err, vars) => {
      if (vars?.status) {
        queryClient.invalidateQueries({ queryKey: ["pipeline-page", "whatsapp"] });
        queryClient.invalidateQueries({ queryKey: ["pipeline-stage-counts", "whatsapp"] });
      } else {
        queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
      }
    },
  });
}

export function useDeletePipeWhatsapp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("pipeline_entries")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
    },
  });
}
