import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface WorkflowNodeStats {
  node_id: string;
  executions_count: number;
  success_count: number;
  error_count: number;
  avg_duration_ms: number;
}

export function useWorkflowNodeStats(workflowId: string | null) {
  return useQuery<WorkflowNodeStats[]>({
    queryKey: ["workflow-node-stats", workflowId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_workflow_node_stats", {
        p_workflow_id: workflowId,
      });
      if (error) throw error;
      return (data ?? []) as WorkflowNodeStats[];
    },
    enabled: !!workflowId,
  });
}
