import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * @deprecated SCRUM-633 — era o caminho por slug dos 3 pipes de sistema
 * (RPC `bulk_move_stage`, hoje wrapper fino sobre o motor único — ver
 * 20270908003000). Sem consumidor no front; morre na W6 junto do wrapper.
 * Use {@link useBulkMoveToPipeline}.
 */
export function useBulkMoveStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      lead_ids: string[];
      target_pipe: string;
      target_stage: string;
    }) => {
      const { data, error } = await supabase.rpc("bulk_move_stage" as any, {
        p_lead_ids: params.lead_ids,
        p_target_pipe: params.target_pipe,
        p_target_stage: params.target_stage,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline_entries"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

/**
 * Mover/adicionar leads em massa a QUALQUER funil por `pipeline_id` + etapa
 * (uuid de `pipeline_stages`) — o motor único `bulk_add_to_pipeline` da
 * migration 20270908003000 (SCRUM-626): move os negócios ABERTOS do lead no
 * funil alvo (won/lost intocados) ou abre um novo quando não há aberto.
 * Autorização server-side (SECURITY DEFINER: org do membro / master).
 */
export function useBulkMoveToPipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      lead_ids,
      pipeline_id,
      stage_id,
    }: {
      lead_ids: string[];
      pipeline_id: string;
      stage_id: string;
    }) => {
      const { data, error } = await supabase.rpc("bulk_add_to_pipeline" as any, {
        p_lead_ids: lead_ids,
        p_pipeline_id: pipeline_id,
        p_stage_id: stage_id,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      // Boards novos (pipeline-page/counts) + espelhos legados ainda montados.
      qc.invalidateQueries({ queryKey: ["pipeline-page"] });
      qc.invalidateQueries({ queryKey: ["pipeline-stage-counts"] });
      qc.invalidateQueries({ queryKey: ["custom_pipe_entries"] });
      qc.invalidateQueries({ queryKey: ["pipeline_entries"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

/**
 * @deprecated SCRUM-633 — alias de compat; use {@link useBulkMoveToPipeline}.
 * O nome "custom" mentia desde a SCRUM-626: o motor serve qualquer funil.
 */
export const useBulkMoveToCustomPipe = useBulkMoveToPipeline;

export function useBulkAssign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      lead_ids: string[];
      responsible_id: string | null;
      sdr_id: string | null;
      closer_id: string | null;
    }) => {
      const { data, error } = await supabase.rpc("bulk_assign_leads" as any, {
        p_lead_ids: params.lead_ids,
        p_responsible_id: params.responsible_id,
        p_sdr_id: params.sdr_id,
        p_closer_id: params.closer_id,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline_entries"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

export function useBulkTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      lead_ids: string[];
      add_tag_ids: string[];
      remove_tag_ids: string[];
    }) => {
      const { data, error } = await supabase.rpc("bulk_tag_leads" as any, {
        p_lead_ids: params.lead_ids,
        p_add_tag_ids: params.add_tag_ids,
        p_remove_tag_ids: params.remove_tag_ids,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline_entries"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

export function useBulkDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { lead_ids: string[] }) => {
      const { data, error } = await supabase.rpc("bulk_delete_leads" as any, {
        p_lead_ids: params.lead_ids,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline_entries"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["trash_leads"] });
    },
  });
}
