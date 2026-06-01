import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const PIPELINE_KEY = ["onboarding-pipeline-templates"];
const AUTOMATION_KEY = ["onboarding-automation-templates"];

export function usePipelineTemplates() {
  return useQuery({
    queryKey: PIPELINE_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("onboarding_pipeline_templates")
        .select("*")
        .order("priority", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreatePipelineTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const { data, error } = await supabase
        .from("onboarding_pipeline_templates")
        .insert(values as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: PIPELINE_KEY }),
  });
}

export function useUpdatePipelineTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: { id: string } & Record<string, unknown>) => {
      const { data, error } = await supabase
        .from("onboarding_pipeline_templates")
        .update({ ...values, updated_at: new Date().toISOString() } as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: PIPELINE_KEY }),
  });
}

export function useDeletePipelineTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("onboarding_pipeline_templates")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: PIPELINE_KEY }),
  });
}

export function useAutomationTemplates() {
  return useQuery({
    queryKey: AUTOMATION_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("onboarding_automation_templates")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateAutomationTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const { data, error } = await supabase
        .from("onboarding_automation_templates")
        .insert(values as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: AUTOMATION_KEY }),
  });
}

export function useUpdateAutomationTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: { id: string } & Record<string, unknown>) => {
      const { data, error } = await supabase
        .from("onboarding_automation_templates")
        .update({ ...values, updated_at: new Date().toISOString() } as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: AUTOMATION_KEY }),
  });
}

export function useDeleteAutomationTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("onboarding_automation_templates")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: AUTOMATION_KEY }),
  });
}

export function useAllOrganizations() {
  return useQuery({
    queryKey: ["all-organizations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useOrgWorkflows(orgId: string | null) {
  return useQuery({
    queryKey: ["org-workflows", orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("workflows")
        .select("id, name, trigger_type, trigger_config, definition, is_active")
        .eq("organization_id", orgId)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId,
  });
}
