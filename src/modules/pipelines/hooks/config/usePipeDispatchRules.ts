import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import type { PipelineType } from "../model/usePipelineStages";

// --- Types ---

export type PipeDispatchRuleTriggerType = "lead_added" | "lead_moved_to_stage";
export type PipeDispatchRuleStepActionType = "send_template" | "wait_response" | "change_stage" | "assign_sdr" | "cancel_sequence";
export type PipeDispatchRuleTimeoutAction = "continue" | "change_stage" | "send_template" | "cancel_sequence";
export type SdrAssignmentMode = "specific" | "round_robin";

export interface PipeDispatchRule {
  id: string;
  organization_id: string;
  pipe_type: PipelineType;
  trigger_type: PipeDispatchRuleTriggerType;
  pipeline_stage_id: string | null;
  whatsapp_instance_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PipeDispatchRuleStep {
  id: string;
  rule_id: string;
  action_type: PipeDispatchRuleStepActionType;
  template_id: string | null;
  delay_minutes: number;
  position: number;
  wait_timeout_minutes: number | null;
  timeout_action: PipeDispatchRuleTimeoutAction | null;
  timeout_target_stage_id: string | null;
  timeout_template_id: string | null;
  target_stage_id: string | null;
  sdr_assignment_mode: SdrAssignmentMode | null;
  target_sdr_id: string | null;
  template?: { id: string; name: string; content?: string; message_type?: string };
}

// --- Hooks ---

export function usePipeDispatchRules(pipeType: PipelineType) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["pipe_dispatch_rules", organizationId, pipeType],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("pipe_dispatch_rules")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("pipe_type", pipeType)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PipeDispatchRule[];
    },
    enabled: isReady && !!organizationId,
  });
}

export function usePipeDispatchRuleSteps(ruleId: string | undefined) {
  return useQuery({
    queryKey: ["pipe_dispatch_rule_steps", ruleId],
    queryFn: async () => {
      if (!ruleId) return [];
      const { data, error } = await supabase
        .from("pipe_dispatch_rule_steps")
        .select(`
          *,
          template:campaign_templates!template_id(id, name, content, message_type, audio_url)
        `)
        .eq("rule_id", ruleId)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PipeDispatchRuleStep[];
    },
    enabled: !!ruleId,
  });
}

export function useCreatePipeDispatchRule() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (payload: {
      pipe_type: PipelineType;
      trigger_type: PipeDispatchRuleTriggerType;
      pipeline_stage_id?: string | null;
      whatsapp_instance_id?: string | null;
      is_active?: boolean;
    }) => {
      if (!organizationId) throw new Error("Organização não disponível");
      const { data, error } = await supabase
        .from("pipe_dispatch_rules")
        .insert({
          organization_id: organizationId,
          pipe_type: payload.pipe_type,
          trigger_type: payload.trigger_type,
          pipeline_stage_id: payload.trigger_type === "lead_moved_to_stage" ? payload.pipeline_stage_id ?? null : null,
          whatsapp_instance_id: payload.whatsapp_instance_id ?? null,
          is_active: payload.is_active ?? true,
        })
        .select()
        .single();
      if (error) throw error;
      return data as PipeDispatchRule;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pipe_dispatch_rules", organizationId, variables.pipe_type] });
    },
  });
}

export function useUpdatePipeDispatchRule() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({
      id,
      pipe_type,
      trigger_type,
      pipeline_stage_id,
      whatsapp_instance_id,
      is_active,
    }: {
      id: string;
      pipe_type: PipelineType;
      trigger_type?: PipeDispatchRuleTriggerType;
      pipeline_stage_id?: string | null;
      whatsapp_instance_id?: string | null;
      is_active?: boolean;
    }) => {
      const updates: Record<string, unknown> = {};
      if (trigger_type !== undefined) updates.trigger_type = trigger_type;
      if (pipeline_stage_id !== undefined) updates.pipeline_stage_id = (trigger_type === "lead_moved_to_stage" ? pipeline_stage_id : null) ?? null;
      if (whatsapp_instance_id !== undefined) updates.whatsapp_instance_id = whatsapp_instance_id;
      if (is_active !== undefined) updates.is_active = is_active;
      const { data, error } = await supabase
        .from("pipe_dispatch_rules")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as PipeDispatchRule;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pipe_dispatch_rules", organizationId, variables.pipe_type] });
    },
  });
}

export function useDeletePipeDispatchRule() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ id, pipe_type }: { id: string; pipe_type: PipelineType }) => {
      const { error } = await supabase.from("pipe_dispatch_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pipe_dispatch_rules", organizationId, variables.pipe_type] });
      queryClient.invalidateQueries({ queryKey: ["pipe_dispatch_rule_steps"] });
    },
  });
}

export function useCreatePipeDispatchRuleStep() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      rule_id: string;
      action_type?: PipeDispatchRuleStepActionType;
      template_id?: string | null;
      delay_minutes?: number;
      position: number;
      wait_timeout_minutes?: number | null;
      timeout_action?: PipeDispatchRuleTimeoutAction | null;
      timeout_target_stage_id?: string | null;
      timeout_template_id?: string | null;
      target_stage_id?: string | null;
      sdr_assignment_mode?: SdrAssignmentMode | null;
      target_sdr_id?: string | null;
    }) => {
      const insertData: Record<string, unknown> = {
        rule_id: payload.rule_id,
        action_type: payload.action_type || "send_template",
        delay_minutes: Math.max(0, Math.floor(Number(payload.delay_minutes) || 0)),
        position: payload.position,
      };
      if (payload.template_id) insertData.template_id = payload.template_id;
      if (payload.wait_timeout_minutes != null) insertData.wait_timeout_minutes = payload.wait_timeout_minutes;
      if (payload.timeout_action) insertData.timeout_action = payload.timeout_action;
      if (payload.timeout_target_stage_id) insertData.timeout_target_stage_id = payload.timeout_target_stage_id;
      if (payload.timeout_template_id) insertData.timeout_template_id = payload.timeout_template_id;
      if (payload.target_stage_id) insertData.target_stage_id = payload.target_stage_id;
      if (payload.sdr_assignment_mode) insertData.sdr_assignment_mode = payload.sdr_assignment_mode;
      if (payload.target_sdr_id) insertData.target_sdr_id = payload.target_sdr_id;

      const { data, error } = await supabase
        .from("pipe_dispatch_rule_steps")
        .insert(insertData)
        .select()
        .single();
      if (error) throw error;
      return data as PipeDispatchRuleStep;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pipe_dispatch_rule_steps", variables.rule_id] });
      queryClient.invalidateQueries({ queryKey: ["pipe_dispatch_rules"] });
    },
  });
}
