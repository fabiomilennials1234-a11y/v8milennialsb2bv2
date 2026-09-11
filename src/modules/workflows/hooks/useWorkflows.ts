import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useAuth } from "@/modules/identity";
import { assertPermission } from "@/modules/identity";
import { findNodeConfigIssues } from "@/contracts/workflows/node-requirements";
import type {
  Workflow,
  WorkflowInsert,
  WorkflowUpdate,
  WorkflowExecutionHistoryItem,
  WorkflowExecutionHistoryStep,
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

      // PERMISSION: Apenas admin pode criar workflows
      await assertPermission("create_workflow");

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
      // PERMISSION: Apenas admin pode editar workflows
      await assertPermission("edit_workflow");

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
      // PERMISSION: Apenas admin pode excluir workflows
      await assertPermission("edit_workflow");

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
      // PERMISSION: Apenas admin pode ativar/desativar workflows
      await assertPermission("edit_workflow");

      // O gate do editor não alcança esta porta: daqui dá para ligar um workflow
      // sem nunca abrir o editor. Sem esta checagem, o gate seria contornável por
      // um clique — e o defeito que ele existe para impedir voltaria inteiro.
      // Só a classe "campo nunca preenchido" bloqueia aqui: referência que
      // apodreceu depois não é algo que o autor acabou de fazer, e sai na
      // varredura de /master/automation-health em vez de travar o clique.
      if (is_active) {
        const { data: wf } = await supabase
          .from("workflows")
          .select("definition")
          .eq("id", id)
          .eq("organization_id", organizationId!)
          .maybeSingle();

        const nodes = ((wf?.definition as { nodes?: unknown[] } | null)?.nodes ?? []) as {
          id: string;
          data?: Record<string, unknown>;
        }[];
        const edges = (wf?.definition as { edges?: { source: string; target: string; sourceHandle?: string | null }[] } | null)?.edges ?? [];
        const issues = findNodeConfigIssues(nodes, edges);

        if (issues.length > 0) {
          const nomes = [...new Set(issues.map((i) => i.nodeLabel))].slice(0, 3).join(", ");
          throw new Error(
            issues.length === 1
              ? `Não dá para ativar: "${nomes}" está incompleto — falta ${issues[0].missing}.`
              : `Não dá para ativar: ${issues.length} nós incompletos (${nomes}). Abra a automação e complete.`,
          );
        }
      }

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
        .rpc("get_workflow_execution_history" as never, {
          p_workflow_id: workflowId,
          p_limit: 50,
        } as never);

      if (error) throw error;
      return (data ?? []) as unknown as WorkflowExecutionHistoryItem[];
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
        .rpc("get_workflow_execution_steps" as never, {
          p_execution_id: executionId,
        } as never);

      if (error) throw error;
      return (data ?? []) as unknown as WorkflowExecutionHistoryStep[];
    },
    enabled: !!executionId,
  });
}

// =====================================================
// RETRY
// =====================================================

export function useRetryWorkflowExecution() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (executionId: string) => {
      if (!organizationId) throw new Error("Sem organização");

      // PERMISSION: Apenas admin pode repetir execuções
      await assertPermission("edit_workflow");

      const { data, error } = await supabase.rpc("retry_workflow_execution" as never, {
        p_execution_id: executionId,
      } as never);
      if (error) throw error;
      const retried = (data as unknown as Array<{ id: string; workflow_id: string; status: string }> | null)?.[0];
      if (!retried) throw new Error("Execução não encontrada");
      return retried;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["workflow-executions", data.workflow_id] });
    },
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

      const { data, error } = await supabase.rpc("get_workflow_execution_stats" as never, {
        p_workflow_id: workflowId,
      } as never);
      if (error) throw error;
      const stats = (data as unknown as Array<{ total: number; last_started_at: string | null; last_status: string | null }> | null)?.[0];

      return {
        total: Number(stats?.total ?? 0),
        lastRun: stats?.last_started_at ? { started_at: stats.last_started_at, status: stats.last_status } : null,
      };
    },
    enabled: !!workflowId && !!organizationId,
  });
}
