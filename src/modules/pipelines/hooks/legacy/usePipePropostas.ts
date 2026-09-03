import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { triggerFollowUpAutomation } from "@/modules/workflows/hooks/useAutoFollowUp";

import { useOrganization } from "@/modules/identity";
import { useCanDo } from "@/modules/identity";
import { OptimisticLockConflictError, isPostgrestNoRows } from "@/modules/platform/lib/optimistic-lock";
// Importa via o shim de path estável (`../usePipelineEntries`), não `../model/...`,
// para preservar o module-id que mocks de teste interceptam (slice 7.3-bis).
import { usePipelineEntries, usePipelineId, findOrCreatePipelineEntry } from "../model/usePipelineEntries";

export type PipeProposta = Tables<"pipe_propostas">;
export type PipePropostaInsert = Partial<PipeProposta> & { lead_id: string };
export type PipePropostaUpdate = Partial<PipeProposta>;

// Definição canônica em contracts (quebra import direto leads→pipelines).
// Re-exportados aqui mantendo a API pública do hook inalterada.
export type { PipePropostasStatus } from "@/contracts/pipe";
export { propostasStatusColumns as statusColumns } from "@/contracts/pipe";

export function usePipePropostas() {
  return usePipelineEntries("propostas");
}

export function useCreatePipeProposta() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { data: pipelineId } = usePipelineId("propostas");

  return useMutation({
    mutationFn: async (item: PipePropostaInsert) => {
      if (!organizationId) {
        throw new Error("Cannot create pipe_propostas: No organization context");
      }
      if (!pipelineId) {
        throw new Error("Cannot create proposta: pipeline ID not resolved");
      }

      // Fase A descomissionamento (PRD #211 / Issue #214):
      // Legacy fields (closer_id, responsible_id) are NOT written to metadata.
      // Source of truth for crédito de venda é dual `sale_responsible_id`,
      // capturado pelo trigger DB na transição para `vendido`.
      const metadata: Record<string, unknown> = {};
      if (item.pre_sale_responsible_id !== undefined) metadata.pre_sale_responsible_id = item.pre_sale_responsible_id;
      if (item.sale_responsible_id !== undefined) metadata.sale_responsible_id = item.sale_responsible_id;
      if (item.sale_value !== undefined) metadata.sale_value = item.sale_value;
      if (item.product_type !== undefined) metadata.product_type = item.product_type;
      if (item.product_id !== undefined) metadata.product_id = item.product_id;
      if (item.loss_reason_id !== undefined) metadata.loss_reason_id = item.loss_reason_id;
      if (item.commitment_date !== undefined) metadata.commitment_date = item.commitment_date;
      if (item.contract_duration !== undefined) metadata.contract_duration = item.contract_duration;
      if (item.metrics_period_at !== undefined) metadata.metrics_period_at = item.metrics_period_at;

      // assigned_to: dual fields first; legacy retained as transition fallback.
      const assignedToValue =
        item.sale_responsible_id ?? item.pre_sale_responsible_id ?? item.responsible_id ?? item.closer_id ?? null;

      const { entry: data, created } = await findOrCreatePipelineEntry({
        pipelineId,
        leadId: item.lead_id!,
        organizationId,
        stageKey: item.status ?? "marcar_compromisso",
        assignedTo: assignedToValue,
        metadata,
      });

      // Fire follow-up automation only for genuinely new entries — if we returned
      // an existing one, the original create already fired it.
      if (created) {
        await triggerFollowUpAutomation({
          leadId: data.lead_id,
          assignedTo: assignedToValue ?? null,
          pipeType: "propostas",
          stage: data.stage_key,
          sourcePipeId: data.id,
          organizationId: data.organization_id,
        });
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"], refetchType: "active" });
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
      queryClient.invalidateQueries({ queryKey: ["follow_ups"], refetchType: "active" });
    },
  });
}

export function useUpdatePipeProposta() {
  const queryClient = useQueryClient();
  const movePermission = useCanDo("move_pipe_record");
  const { data: pipelineId } = usePipelineId("propostas");

  return useMutation({
    mutationFn: async ({
      id,
      leadId,
      closerId,
      skip_auto_push,
      expectedUpdatedAt,
      ...updates
    }: PipePropostaUpdate & {
      id: string;
      leadId?: string;
      closerId?: string | null;
      skip_auto_push?: boolean;
      expectedUpdatedAt?: string;
    }) => {
      if (updates.status && !movePermission.allowed) {
        throw new Error(movePermission.isLoading
          ? "Permissões ainda carregando — tente novamente"
          : "Sem permissão para mover registros no pipe");
      }

      // Fetch current entry to get existing metadata for merge
      const { data: current, error: fetchError } = await supabase
        .from("pipeline_entries")
        .select("*")
        .eq("id", id)
        .single();

      if (fetchError) throw fetchError;

      const existingMeta = (current.metadata as Record<string, unknown>) ?? {};
      const mergedMeta = { ...existingMeta };

      // Fase A: merge dual fields only — legacy keys never enter the metadata write.
      if (updates.pre_sale_responsible_id !== undefined) mergedMeta.pre_sale_responsible_id = updates.pre_sale_responsible_id;
      if (updates.sale_responsible_id !== undefined) mergedMeta.sale_responsible_id = updates.sale_responsible_id;
      if (updates.sale_value !== undefined) mergedMeta.sale_value = updates.sale_value;
      if (updates.product_type !== undefined) mergedMeta.product_type = updates.product_type;
      if (updates.product_id !== undefined) mergedMeta.product_id = updates.product_id;
      if (updates.loss_reason_id !== undefined) mergedMeta.loss_reason_id = updates.loss_reason_id;
      // 🔴 `loss_reason` FALTAVA nesta lista, e a ausência era invisível
      // (SCRUM-369). A tela de Propostas escrevia `updates.loss_reason` desde
      // sempre; a chave caía aqui e era descartada em silêncio, porque este
      // merge é uma allowlist. Medido em produção em 2026-08-21: 72 negócios
      // marcados como perdidos, ZERO com motivo — nem no id, nem no texto.
      //
      // O texto NÃO é redundante com o id: ele é o RÓTULO SNAPSHOTADO no
      // momento da perda. `loss_reasons` é catálogo editável por org, e um
      // motivo renomeado ou apagado depois deixaria o histórico ilegível se só
      // o id fosse guardado.
      if (updates.loss_reason !== undefined) mergedMeta.loss_reason = updates.loss_reason;
      if (updates.commitment_date !== undefined) mergedMeta.commitment_date = updates.commitment_date;
      if (updates.contract_duration !== undefined) mergedMeta.contract_duration = updates.contract_duration;
      if (updates.metrics_period_at !== undefined) mergedMeta.metrics_period_at = updates.metrics_period_at;

      const entryUpdate: Record<string, unknown> = { metadata: mergedMeta };
      if (updates.status !== undefined) entryUpdate.stage_key = updates.status;
      // assigned_to: recompute when caller touched a responsibility field.
      // Dual fields first; legacy retained as transition fallback (existing entries' metadata).
      if (
        updates.pre_sale_responsible_id !== undefined ||
        updates.sale_responsible_id !== undefined ||
        updates.responsible_id !== undefined ||
        updates.closer_id !== undefined
      ) {
        entryUpdate.assigned_to =
          (updates.sale_responsible_id ?? (mergedMeta.sale_responsible_id as string | null | undefined) ?? null) ||
          (updates.pre_sale_responsible_id ?? (mergedMeta.pre_sale_responsible_id as string | null | undefined) ?? null) ||
          (updates.responsible_id ?? (mergedMeta.responsible_id as string | null | undefined) ?? null) ||
          (updates.closer_id ?? (mergedMeta.closer_id as string | null | undefined) ?? null) ||
          null;
      }

      let entryQuery = supabase
        .from("pipeline_entries")
        .update(entryUpdate)
        .eq("id", id);
      if (expectedUpdatedAt) {
        entryQuery = entryQuery.eq("updated_at", expectedUpdatedAt);
      }
      const { data, error } = await entryQuery.select().single();

      if (error) {
        if (expectedUpdatedAt && isPostgrestNoRows(error)) {
          throw new OptimisticLockConflictError();
        }
        throw error;
      }

      // Sync responsible_id back to leads table
      const effectiveLeadId = leadId || data.lead_id;
      if (effectiveLeadId && updates.responsible_id !== undefined) {
        await supabase.from("leads").update({ responsible_id: updates.responsible_id || null }).eq("id", effectiveLeadId);
      }

      // Sync pre_sale_responsible_id / sale_responsible_id back to leads table
      if (effectiveLeadId && (updates.pre_sale_responsible_id !== undefined || updates.sale_responsible_id !== undefined)) {
        const leadUpdate: Record<string, unknown> = {};
        if (updates.pre_sale_responsible_id !== undefined) leadUpdate.pre_sale_responsible_id = updates.pre_sale_responsible_id || null;
        if (updates.sale_responsible_id !== undefined) leadUpdate.sale_responsible_id = updates.sale_responsible_id || null;
        if (Object.keys(leadUpdate).length > 0) {
          await supabase.from("leads").update(leadUpdate).eq("id", effectiveLeadId);
        }
      }

      // Auto-push order to TinyERP when status changes to "vendido" (skip if modal already handled it)
      if (updates.status === "vendido" && data.organization_id && !skip_auto_push) {
        try {
          const { data: tinyConn } = await supabase
            .from("tinyerp_connections")
            .select("auto_push_orders, status")
            .eq("organization_id", data.organization_id)
            .eq("status", "connected")
            .maybeSingle();

          if (tinyConn?.auto_push_orders) {
            // Push order and refresh TinyERP queries so UI updates
            supabase.functions.invoke("tinyerp-push-order", {
              body: { pipe_proposta_id: id },
            }).then(({ data: pushResult, error: pushError }) => {
              if (pushError || pushResult?.error) {
                console.error("[TinyERP Auto-push] Error:", pushError || pushResult?.error);
              } else {
                // Invalidate TinyERP queries so TinyErpOrderStatus component updates
                queryClient.invalidateQueries({ queryKey: ["tinyerp-order-mapping"] });
                queryClient.invalidateQueries({ queryKey: ["tinyerp-sync-logs"] });
              }
            }).catch((err) => console.error("[TinyERP Auto-push] Error:", err));
          }
        } catch {
          // Ignore — TinyERP auto-push is best-effort
        }
      }

      // Trigger automation if status changed.
      // Prefer dual snapshot fields; fall back to legacy keys on historical entries.
      if (updates.status && effectiveLeadId) {
        const effectiveAssignedTo =
          closerId ||
          (mergedMeta.sale_responsible_id as string | null | undefined) ||
          (mergedMeta.pre_sale_responsible_id as string | null | undefined) ||
          (mergedMeta.closer_id as string | null | undefined) ||
          (mergedMeta.responsible_id as string | null | undefined) ||
          null;
        await triggerFollowUpAutomation({
          leadId: effectiveLeadId,
          assignedTo: effectiveAssignedTo,
          pipeType: "propostas",
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

export function useDeletePipeProposta() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      // Use .select("id") so PostgREST returns the affected rows.
      // Without it, Supabase returns { error: null } even when RLS silently
      // blocks the DELETE — causing the optimistic removal to appear to succeed
      // while the record remains in the database and reappears on the next refetch.
      const { data: deleted, error } = await supabase
        .from("pipeline_entries")
        .delete()
        .eq("id", id)
        .select("id");

      if (error) throw error;

      if (!deleted || deleted.length === 0) {
        throw new Error(
          "Não foi possível excluir: permissão insuficiente ou registro não encontrado."
        );
      }
    },
    onMutate: async (id: string) => {
      // Cancel any in-flight refetches so they don't overwrite the optimistic update
      await queryClient.cancelQueries({ queryKey: ["pipeline_entries"] });

      // Snapshot previous cache for rollback
      const previousData = queryClient.getQueriesData({ queryKey: ["pipeline_entries"] });

      // Optimistically remove the proposal from all cached pipe_propostas queries
      queryClient.setQueriesData({ queryKey: ["pipeline_entries"] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.filter((item: any) => item.id !== id);
      });

      return { previousData };
    },
    onError: (_err, _id, context) => {
      // Rollback optimistic update on error
      if (context?.previousData) {
        context.previousData.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
    },
  });
}
