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

// Args das RPCs (migration 20270725000000_duplicate_leads_rpcs.sql).
interface FindDuplicateLeadsArgs {
  p_organization_id: string;
}
interface MergeLeadsArgs {
  p_keep_lead_id: string;
  p_merge_lead_id: string;
}

// NOTA: `find_duplicate_leads` e `merge_leads` foram adicionadas na migration
// 20270725000000. Enquanto src/integrations/supabase/types.ts não for
// regenerado pós-apply (`supabase gen types typescript --project-id <ref>`),
// os nomes dessas RPCs não existem no union tipado do client — daí o
// `as never` no nome (padrão do repo p/ RPC fora dos types gerados). Os
// args e o retorno seguem fortemente tipados (MergeLeadsArgs / DuplicateGroup).
// Remover os `as never` após regenerar os types.

export function useDuplicateLeads() {
  const { organizationId } = useOrganization();
  return useQuery({
    queryKey: ["duplicate_leads", organizationId],
    queryFn: async (): Promise<DuplicateGroup[]> => {
      // org validada server-side (assert_org_access) — "frontend nunca envia
      // org" = não CONFIAR nela; aqui é enviada E validada na RPC.
      const args: FindDuplicateLeadsArgs = { p_organization_id: organizationId! };
      const { data, error } = await supabase.rpc("find_duplicate_leads" as never, args as never);
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
      const { error } = await supabase.rpc("merge_leads" as never, args as never);
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
