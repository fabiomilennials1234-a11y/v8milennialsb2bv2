import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { triggerFollowUpAutomation } from "./useAutoFollowUp";

import { useOrganization } from "./useOrganization";
import { useCanPerformActionAsync } from "@/lib/permissions";
import { usePipelineEntries, usePipelineId, findOrCreatePipelineEntry } from "./usePipelineEntries";

export type PipeWhatsapp = Tables<"pipe_whatsapp">;
export type PipeWhatsappInsert = Partial<PipeWhatsapp> & { lead_id: string };
export type PipeWhatsappUpdate = Partial<PipeWhatsapp>;

export type PipeWhatsappStatus = string;

export const statusColumns: { id: string; title: string; color: string }[] = [
  { id: "novo", title: "Novo", color: "#6366f1" },
  { id: "abordado", title: "Abordado", color: "#f59e0b" },
  { id: "respondeu", title: "Respondeu", color: "#3b82f6" },
  { id: "esfriou", title: "Esfriou", color: "#ef4444" },
  { id: "agendado", title: "Agendado ✓", color: "#22c55e" },
];

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
  const { data: movePermission } = useCanPerformActionAsync("move_pipe_record");

  return useMutation({
    mutationFn: async ({ id, leadId, sdrId, ...updates }: PipeWhatsappUpdate & { id: string; leadId?: string; sdrId?: string | null }) => {
      if (updates.status && movePermission && !movePermission.allowed) {
        throw new Error("Sem permissão para mover registros no pipe");
      }

      // Fetch current entry to merge metadata
      const { data: current, error: fetchError } = await supabase
        .from("pipeline_entries")
        .select("metadata, lead_id, organization_id")
        .eq("id", id)
        .single();

      if (fetchError) throw fetchError;

      const currentMetadata = (current.metadata as Record<string, any>) ?? {};
      // Fase A: dual-only metadata writes.
      const newMetadata: Record<string, unknown> = {};
      if (updates.pre_sale_responsible_id !== undefined) newMetadata.pre_sale_responsible_id = updates.pre_sale_responsible_id;
      if (updates.sale_responsible_id !== undefined) newMetadata.sale_responsible_id = updates.sale_responsible_id;
      if ((updates as any).scheduled_date !== undefined) newMetadata.scheduled_date = (updates as any).scheduled_date;

      const mergedMetadata = { ...currentMetadata, ...newMetadata };

      const updatePayload: Record<string, unknown> = {
        metadata: mergedMetadata,
      };
      if (updates.status !== undefined) {
        updatePayload.stage_key = updates.status;
      }
      if (updates.notes !== undefined) {
        updatePayload.notes = updates.notes;
      }
      // assigned_to: prefer dual on the merged result; legacy retained as
      // transition fallback so historical entries still produce a usable FK.
      const assignedTo =
        mergedMetadata.pre_sale_responsible_id ??
        mergedMetadata.sale_responsible_id ??
        mergedMetadata.responsible_id ??
        mergedMetadata.sdr_id ??
        null;
      if (
        updates.pre_sale_responsible_id !== undefined ||
        updates.sale_responsible_id !== undefined ||
        updates.responsible_id !== undefined ||
        updates.sdr_id !== undefined
      ) {
        updatePayload.assigned_to = assignedTo;
      }

      const { data, error } = await supabase
        .from("pipeline_entries")
        .update(updatePayload)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"], refetchType: "active" });
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
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
