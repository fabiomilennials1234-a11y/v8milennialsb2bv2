import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/modules/identity";
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
  match_type: string;
  similarity: number;
}

export function useDuplicateLeads() {
  const { organizationId } = useAuth();
  return useQuery({
    queryKey: ["duplicate_leads", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("find_duplicate_leads" as any);
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
      const { data, error } = await supabase.rpc("merge_leads" as any, {
        p_keep_lead_id: params.keep_id,
        p_merge_lead_id: params.merge_id,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["duplicate_leads"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}
