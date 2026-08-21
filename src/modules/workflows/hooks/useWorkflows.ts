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
        const issues = findNodeConfigIssues(nodes);

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

      // Fetch original execution (cast needed: retry_of not in auto-generated types yet)
      const { data: rawOriginal, error: fetchError } = await supabase
        .from("workflow_executions")
        .select("*")
        .eq("id", executionId)
        .eq("organization_id", organizationId)
        .single();

      if (fetchError || !rawOriginal) throw new Error("Execução não encontrada");
      const original = rawOriginal as unknown as WorkflowExecution;
      if (original.status !== "failed") throw new Error("Só é possível repetir execuções que falharam");

      // Create new execution starting from the failed node
      const { data: newExec, error: insertError } = await supabase
        .from("workflow_executions")
        .insert({
          workflow_id: original.workflow_id,
          organization_id: organizationId,
          lead_id: original.lead_id,
          status: "running",
          current_node_id: original.current_node_id,
          loop_counters: original.loop_counters || {},
          context: original.context || {},
          retry_of: original.id,
          next_run_at: new Date().toISOString(),
        } as any)
        .select()
        .single();

      if (insertError) throw insertError;
      return newExec as unknown as WorkflowExecution;
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
