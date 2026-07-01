import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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

export function useBulkMoveToCustomPipe() {
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
      const { data, error } = await supabase.rpc("bulk_add_to_custom_pipe" as any, {
        p_lead_ids: lead_ids,
        p_pipeline_id: pipeline_id,
        p_stage_id: stage_id,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom_pipe_entries"] });
      qc.invalidateQueries({ queryKey: ["pipeline_entries"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

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
