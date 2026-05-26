import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import type { SplitAbVariantMetrics } from "@/types/workflow";

export function useSplitAbMetrics(
  workflowId: string | undefined,
  nodeId: string | undefined
) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["split-ab-metrics", workflowId, nodeId, organizationId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_split_ab_metrics", {
        p_workflow_id: workflowId!,
        p_node_id: nodeId!,
        p_org_id: organizationId!,
      });

      if (error) throw error;
      return data as unknown as SplitAbVariantMetrics[];
    },
    enabled: isReady && !!organizationId && !!workflowId && !!nodeId,
    refetchInterval: 30_000,
  });
}

export function useSplitAbNodes(workflowId: string | undefined) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["split-ab-nodes", workflowId, organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workflows")
        .select("definition")
        .eq("id", workflowId!)
        .eq("organization_id", organizationId!)
        .maybeSingle();

      if (error) throw error;
      if (!data?.definition) return [];

      const definition = data.definition as { nodes?: Array<{ id: string; type?: string; data?: { type?: string; label?: string } }> };
      const nodes = definition.nodes ?? [];

      return nodes
        .filter((n) => n.type === "split_ab" || n.data?.type === "split_ab")
        .map((n) => ({ id: n.id, label: n.data?.label ?? "Split A/B" }));
    },
    enabled: isReady && !!organizationId && !!workflowId,
  });
}
