import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import type {
  Workflow,
  WorkflowInsert,
  WorkflowUpdate,
  WorkflowExecution,
  WorkflowExecutionStep,
} from "@/types/workflow";

export function useWorkflows() {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["workflows", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("workflows")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as unknown as Workflow[];
    },
    enabled: isReady && !!organizationId,
  });
}

export function useWorkflow(id: string | undefined) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["workflow", id, organizationId],
    queryFn: async () => {
      if (!id || !organizationId) return null;
      const { data, error } = await supabase
        .from("workflows")
        .select("*")
        .eq("id", id)
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (error) throw error;
      return data as unknown as Workflow | null;
    },
    enabled: isReady && !!organizationId && !!id,
  });
}

export function useCreateWorkflow() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: WorkflowInsert) => {
      if (!organizationId || !user?.id) throw new Error("Sem organização ou usuário");

      const { data, error } = await supabase
        .from("workflows")
        .insert({
          ...input,
          organization_id: organizationId,
          created_by: user.id,
        } as any)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as Workflow;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows", organizationId] });
    },
  });
}

export function useUpdateWorkflow() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ id, ...updates }: WorkflowUpdate & { id: string }) => {
      const { data, error } = await supabase
        .from("workflows")
        .update(updates as any)
        .eq("id", id)
        .eq("organization_id", organizationId!)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as Workflow;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["workflows", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["workflow", data.id, organizationId] });
    },
  });
}

export function useDeleteWorkflow() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("workflows")
        .delete()
        .eq("id", id)
        .eq("organization_id", organizationId!);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows", organizationId] });
    },
  });
}

export function useToggleWorkflow() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("workflows")
        .update({ is_active } as any)
        .eq("id", id)
        .eq("organization_id", organizationId!);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows", organizationId] });
    },
  });
}

// =====================================================
// EXECUTIONS
// =====================================================

export function useWorkflowExecutions(workflowId: string | undefined) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["workflow-executions", workflowId, organizationId],
    queryFn: async () => {
      if (!workflowId || !organizationId) return [];
      const { data, error } = await supabase
        .from("workflow_executions")
        .select("*")
        .eq("workflow_id", workflowId)
        .eq("organization_id", organizationId)
        .order("started_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      return data as unknown as WorkflowExecution[];
    },
    enabled: isReady && !!organizationId && !!workflowId,
  });
}

export function useWorkflowExecutionSteps(executionId: string | undefined) {
  return useQuery({
    queryKey: ["workflow-execution-steps", executionId],
    queryFn: async () => {
      if (!executionId) return [];
      const { data, error } = await supabase
        .from("workflow_execution_steps")
        .select("*")
        .eq("execution_id", executionId)
        .order("executed_at", { ascending: true });

      if (error) throw error;
      return data as unknown as WorkflowExecutionStep[];
    },
    enabled: !!executionId,
  });
}

// =====================================================
// STATS (para lista)
// =====================================================

export function useWorkflowStats(workflowId: string | undefined) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["workflow-stats", workflowId, organizationId],
    queryFn: async () => {
      if (!workflowId || !organizationId) return { total: 0, lastRun: null };

      const { count, error: countError } = await supabase
        .from("workflow_executions")
        .select("*", { count: "exact", head: true })
        .eq("workflow_id", workflowId)
        .eq("organization_id", organizationId);

      if (countError) throw countError;

      const { data: lastExec, error: lastError } = await supabase
        .from("workflow_executions")
        .select("started_at, status")
        .eq("workflow_id", workflowId)
        .eq("organization_id", organizationId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastError) throw lastError;

      return {
        total: count ?? 0,
        lastRun: lastExec,
      };
    },
    enabled: !!workflowId && !!organizationId,
  });
}
