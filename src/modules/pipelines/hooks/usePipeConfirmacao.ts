import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { triggerFollowUpAutomation } from "@/modules/workflows/hooks/useAutoFollowUp";

import { useOrganization } from "@/modules/identity";
import { useCanDo } from "@/modules/identity";
import { OptimisticLockConflictError, isPostgrestNoRows } from "@/modules/platform/lib/optimistic-lock";
import { usePipelineEntries, usePipelineId, findOrCreatePipelineEntry } from "./usePipelineEntries";

export type PipeConfirmacao = Tables<"pipe_confirmacao">;
export type PipeConfirmacaoInsert = Partial<PipeConfirmacao> & { lead_id: string };
export type PipeConfirmacaoUpdate = Partial<PipeConfirmacao>;

// Definição canônica em contracts (quebra import direto leads→pipelines).
// Re-exportados aqui mantendo a API pública do hook inalterada.
export type { PipeConfirmacaoStatus } from "@/contracts/pipe";
export { confirmacaoStatusColumns as statusColumns } from "@/contracts/pipe";

export function usePipeConfirmacao() {
  return usePipelineEntries("confirmacao");
}

export function useCreatePipeConfirmacao() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { data: pipelineId } = usePipelineId("confirmacao");

  return useMutation({
    mutationFn: async (item: PipeConfirmacaoInsert) => {
      if (!organizationId) {
        throw new Error("Cannot create pipe_confirmacao: No organization context");
      }
      if (!pipelineId) {
        throw new Error("Pipeline 'confirmacao' not found for this organization");
      }

      // Fase A descomissionamento (PRD #211 / Issue #214):
      // Legacy fields (sdr_id, closer_id, responsible_id) are destructured here only
      // to keep the public hook signature backward-compatible — they are NOT written
      // into metadata. Source of truth for crédito is now the dual snapshot captured
      // by the DB trigger (`snapshot_responsible_from_lead`).
      const {
        lead_id, status, organization_id,
        sdr_id, closer_id, responsible_id,
        pre_sale_responsible_id, sale_responsible_id,
        meeting_date, meet_link, is_confirmed, metrics_period_at,
        ...rest
      } = item;

      const metadata = {
        ...(pre_sale_responsible_id !== undefined && { pre_sale_responsible_id }),
        ...(sale_responsible_id !== undefined && { sale_responsible_id }),
        ...(meeting_date !== undefined && { meeting_date }),
        ...(meet_link !== undefined && { meet_link }),
        ...(is_confirmed !== undefined && { is_confirmed }),
        ...(metrics_period_at !== undefined && { metrics_period_at }),
      };

      // assigned_to: dual fields first; legacy retained only as transition fallback
      // so existing callers that haven't migrated to dual still produce a usable FK.
      const assignedToValue =
        pre_sale_responsible_id ?? sale_responsible_id ?? responsible_id ?? sdr_id ?? closer_id ?? null;

      const { entry: data, created } = await findOrCreatePipelineEntry({
        pipelineId,
        leadId: lead_id!,
        organizationId,
        stageKey: status || "reuniao_marcada",
        assignedTo: assignedToValue,
        metadata,
      });

      // Fire automation only for new entries — if we returned an existing one,
      // the original create already fired it.
      if (created) {
        await triggerFollowUpAutomation({
          leadId: data.lead_id,
          assignedTo: assignedToValue,
          pipeType: "confirmacao",
          stage: data.stage_key,
          sourcePipeId: data.id,
          organizationId: data.organization_id,
        });
      }

      // stage_changed workflows are fired by the PG trigger on pipeline_entries
      // (via pg_net → process-workflow-executions). No need to fire from frontend.

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
    },
  });
}

export function useUpdatePipeConfirmacao() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const movePermission = useCanDo("move_pipe_record");
  const { data: pipelineId } = usePipelineId("confirmacao");

  return useMutation({
    mutationFn: async ({
      id,
      leadId,
      assignedTo,
      expectedUpdatedAt,
      ...updates
    }: PipeConfirmacaoUpdate & {
      id: string;
      leadId?: string;
      assignedTo?: string | null;
      expectedUpdatedAt?: string;
    }) => {
      if (!organizationId) {
        throw new Error("Cannot update pipe_confirmacao: No organization context");
      }

      // Detecta mudança real de status: SELECT do row atual e compara com payload.
      // Decisão server-side proxy do Security (opção B) — caller não pode bypassar
      // omitindo `status` e move_pipe_record só é checado quando status muda de fato.
      let isStatusChange = false;
      if (updates.status !== undefined) {
        const { data: current, error: selErr } = await supabase
          .from("pipeline_entries")
          .select("stage_key")
          .eq("id", id)
          .single();
        if (selErr || !current) {
          // Não vazar diferença "não existe" vs "sem permissão"
          throw new Error("Registro não encontrado");
        }
        isStatusChange = current.stage_key !== updates.status;

        if (isStatusChange) {
          if (!movePermission.allowed) {
            throw new Error(movePermission.isLoading
              ? "Permissões ainda carregando — tente novamente"
              : "Sem permissão para mover registros no pipe");
          }
        } else {
          // status no payload mas igual ao atual — remove pra evitar UPDATE inútil
          // + log de auditoria fantasma (trigger de stage_change dispara em UPDATE OF stage_key).
          delete updates.status;
        }
      }

      // Fetch current entry to get existing metadata for merge
      const { data: currentEntry, error: fetchErr } = await supabase
        .from("pipeline_entries")
        .select("metadata")
        .eq("id", id)
        .single();
      if (fetchErr || !currentEntry) {
        throw new Error("Registro não encontrado");
      }

      const existingMetadata = (currentEntry.metadata as Record<string, unknown>) || {};

      // Extract metadata fields from updates, keep non-metadata fields separate.
      // Fase A: legacy fields are destructured to be excluded from `nonMetaUpdates`
      // and from the metadata write, but kept usable for `assigned_to` fallback.
      const { status, sdr_id, closer_id, responsible_id, pre_sale_responsible_id, sale_responsible_id, meeting_date, meet_link, is_confirmed, metrics_period_at, ...nonMetaUpdates } = updates;

      const metadataUpdates: Record<string, unknown> = {};
      if (pre_sale_responsible_id !== undefined) metadataUpdates.pre_sale_responsible_id = pre_sale_responsible_id;
      if (sale_responsible_id !== undefined) metadataUpdates.sale_responsible_id = sale_responsible_id;
      if (meeting_date !== undefined) metadataUpdates.meeting_date = meeting_date;
      if (meet_link !== undefined) metadataUpdates.meet_link = meet_link;
      if (is_confirmed !== undefined) metadataUpdates.is_confirmed = is_confirmed;
      if (metrics_period_at !== undefined) metadataUpdates.metrics_period_at = metrics_period_at;

      const mergedMetadata = { ...existingMetadata, ...metadataUpdates };

      const payload: Record<string, unknown> = {};
      if (status !== undefined) payload.stage_key = status;
      if (Object.keys(metadataUpdates).length > 0) payload.metadata = mergedMetadata;
      // assigned_to recompute only when caller touched a responsibility field
      // (dual or legacy). Dual takes precedence; legacy retained as transition fallback.
      if (
        pre_sale_responsible_id !== undefined ||
        sale_responsible_id !== undefined ||
        responsible_id !== undefined ||
        sdr_id !== undefined ||
        closer_id !== undefined
      ) {
        payload.assigned_to =
          pre_sale_responsible_id ?? sale_responsible_id ?? responsible_id ?? sdr_id ?? closer_id ?? null;
      }

      // Only update if there's something to update
      if (Object.keys(payload).length === 0) {
        // Nothing changed — return current entry
        const { data: unchanged } = await supabase
          .from("pipeline_entries")
          .select()
          .eq("id", id)
          .single();
        return unchanged;
      }

      // Optimistic lock (#307) — when caller passes expectedUpdatedAt
      // the UPDATE is conditional, and PostgREST returns PGRST116 if
      // the row was already touched by someone else.
      let entryUpdateQuery = supabase
        .from("pipeline_entries")
        .update(payload)
        .eq("id", id);
      if (expectedUpdatedAt) {
        entryUpdateQuery = entryUpdateQuery.eq("updated_at", expectedUpdatedAt);
      }
      const { data, error } = await entryUpdateQuery.select().single();

      if (error) {
        if (expectedUpdatedAt && isPostgrestNoRows(error)) {
          throw new OptimisticLockConflictError();
        }
        throw error;
      }

      // Sync meeting_date → leads.compromisso_date (espelho).
      // Só dispara quando meeting_date foi explicitamente passado (inclusive null = deletando reunião).
      if (leadId && updates.meeting_date !== undefined) {
        await supabase
          .from("leads")
          .update({ compromisso_date: updates.meeting_date })
          .eq("id", leadId)
          .eq("organization_id", organizationId);
      }

      // Sync responsible_id back to leads table
      if (leadId && updates.responsible_id !== undefined) {
        await supabase
          .from("leads")
          .update({ responsible_id: updates.responsible_id || null })
          .eq("id", leadId)
          .eq("organization_id", organizationId);
      }

      // Trigger automation só quando status mudou de fato.
      // Prefer dual snapshot fields; fall back to legacy keys on historical entries.
      if (isStatusChange && updates.status && leadId) {
        const meta = (data.metadata as Record<string, unknown>) || {};
        await triggerFollowUpAutomation({
          leadId: leadId,
          assignedTo:
            assignedTo ||
            (meta.pre_sale_responsible_id as string) ||
            (meta.sale_responsible_id as string) ||
            (meta.responsible_id as string) ||
            (meta.sdr_id as string) ||
            (meta.closer_id as string),
          pipeType: "confirmacao",
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
      queryClient.invalidateQueries({ queryKey: ["leads"], refetchType: "active" });
    },
  });
}

export function useDeletePipeConfirmacao() {
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
