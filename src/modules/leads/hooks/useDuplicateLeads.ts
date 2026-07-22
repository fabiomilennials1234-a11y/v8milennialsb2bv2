import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
export interface DuplicateGroup {
  lead_a_id: string;
  lead_a_name: string;
  lead_a_phone: string | null;
  lead_a_email: string | null;
  lead_a_company: string | null;
  lead_b_id: string;
  lead_b_name: string;
  lead_b_phone: string | null;
  lead_b_email: string | null;
  lead_b_company: string | null;
  match_type: "phone" | "email" | "name" | string;
  similarity: number;
}

// Args das RPCs (migration 20260722184420_duplicate_leads_rpcs.sql).
interface FindDuplicateLeadsArgs {
  p_organization_id: string;
}
interface MergeLeadsArgs {
  p_keep_lead_id: string;
  p_merge_lead_id: string;
}

// `find_duplicate_leads` e `merge_leads` aplicadas em prod (migration
// 20260722184420) e presentes em types.ts (regenerado) — RPCs tipadas.

export function useDuplicateLeads() {
  const { organizationId } = useOrganization();
  return useQuery({
    queryKey: ["duplicate_leads", organizationId],
    queryFn: async (): Promise<DuplicateGroup[]> => {
      // org validada server-side (assert_org_access) — "frontend nunca envia
      // org" = não CONFIAR nela; aqui é enviada E validada na RPC.
      const args: FindDuplicateLeadsArgs = { p_organization_id: organizationId! };
      const { data, error } = await supabase.rpc("find_duplicate_leads", args);
      if (error) throw error;
      return (data ?? []) as DuplicateGroup[];
    },
    enabled: !!organizationId,
  });
}

export function useMergeLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { keep_id: string; merge_id: string }) => {
      const args: MergeLeadsArgs = {
        p_keep_lead_id: params.keep_id,
        p_merge_lead_id: params.merge_id,
      };
      const { error } = await supabase.rpc("merge_leads", args);
      if (error) throw error;
    },
    onSuccess: () => {
      // O merge re-aponta pipeline_entries / custom_pipe_entries do lead
      // absorvido → o card dele precisa sumir do kanban (board + contadores).
      const keys = [
        "duplicate_leads",
        "leads",
        "pipeline-page",
        "pipeline-stage-counts",
        "pipeline_entries",
        "custom_pipe_entries",
        "custom_pipe_stage_counts",
      ];
      keys.forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
    },
  });
}
