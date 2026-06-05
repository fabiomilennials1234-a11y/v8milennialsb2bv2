import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import type { PipelineType } from "./usePipelineEntries";

/**
 * Resolve every lead_id sitting in a (pipelineType, stageKey) for the caller's
 * org — the "all Leads in a Stage" audience source for Disparo F1 (issue #703).
 *
 * Tenancy is enforced server-side: the RPC derives the caller's orgs from auth
 * via `get_my_organization_ids()` and never trusts a client-supplied org. The
 * returned ids feed `useQuickBlast` (the engine re-queries leads, normalizes
 * phones, dedups and applies the org cap).
 *
 * Contract is stable — the Disparo wizard codes against this signature.
 */
export function useStageLeadIds(pipelineType: PipelineType, stageKey: string) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["stage_lead_ids", pipelineType, stageKey, organizationId],
    queryFn: async (): Promise<string[]> => {
      // `as any` on the RPC name: get_stage_lead_ids is newer than the last
      // generated types.ts (regen after the migration applies). Same pattern as
      // useTrashLeads / useBulkActions. Result shape is asserted below.
      const { data, error } = await supabase.rpc("get_stage_lead_ids" as any, {
        p_pipeline_type: pipelineType,
        p_stage_key: stageKey,
      });
      if (error) throw error;
      return (data ?? []) as string[];
    },
    enabled: !!stageKey && !!organizationId,
  });
}
