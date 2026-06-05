import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

/**
 * Filter params accepted by {@link useCustomFilteredLeadIds}. The CUSTOM-funnel
 * counterpart of {@link FilteredLeadIdsParams}:
 *
 *   - `stageId`               — optional custom_pipeline_stages.id; `null`/
 *                               omitted = whole pipeline (every stage)
 *   - `search`                — ILIKE on lead name / phone / company
 *   - `responsibleId`         — lead pre/sale responsible; `"all"`/`null` clears
 *   - `tagIds`                — lead must have ALL listed tags (intersection)
 *   - `qualificationTier`     — `leads.qualification_tier` ∈ list; empty = all
 *   - `preQualificationTier`  — `leads.pre_qualification_tier` ∈ list; empty=all
 *   - `origin`                — `leads.origin` ∈ list; empty = all
 *
 * Custom funnels carry `stage_id` (uuid) — NOT the `stage_key` slug the system
 * model uses — and have no entry-level responsible metadata, so responsible
 * resolves against the LEAD columns only. See the RPC migration
 * (20261123000001) for the full rationale.
 */
export interface CustomFilteredLeadIdsParams {
  stageId?: string | null;
  search?: string;
  responsibleId?: string | null;
  tagIds?: string[];
  qualificationTier?: string[];
  preQualificationTier?: string[];
  origin?: string[];
}

/**
 * Resolve EVERY lead_id sitting in a CUSTOM pipeline (optionally a single stage)
 * that matches the Disparo wizard's audience conditions, for the caller's org —
 * the custom-funnel audience source for Disparo Phase 1.
 *
 * Tenancy is enforced server-side: the RPC derives the caller's orgs from auth
 * via `get_my_organization_ids()` and never trusts a client-supplied org. The
 * returned ids feed the Quick Blast engine (it re-queries leads, normalizes
 * phones, dedups and applies the org cap).
 *
 * Contract is stable — the Disparo wizard codes against this signature.
 */
export function useCustomFilteredLeadIds(
  pipelineId: string | null | undefined,
  params: CustomFilteredLeadIdsParams = {},
) {
  const { organizationId } = useOrganization();
  const {
    stageId,
    search,
    responsibleId,
    tagIds,
    qualificationTier,
    preQualificationTier,
    origin,
  } = params;

  const pStageId = stageId || null;
  const pResponsibleId =
    responsibleId === "all" ? null : responsibleId || null;
  const pSearch = search || null;
  const pTagIds = tagIds?.length ? tagIds : null;
  const pQualificationTier = qualificationTier?.length ? qualificationTier : null;
  const pPreQualificationTier = preQualificationTier?.length
    ? preQualificationTier
    : null;
  const pOrigin = origin?.length ? origin : null;

  return useQuery({
    queryKey: [
      "custom_filtered_lead_ids",
      pipelineId,
      pStageId,
      pSearch,
      pResponsibleId,
      pTagIds,
      pQualificationTier,
      pPreQualificationTier,
      pOrigin,
      organizationId,
    ],
    queryFn: async (): Promise<string[]> => {
      // `as any` on the RPC name: get_custom_filtered_lead_ids is newer than the
      // last generated types.ts (regen after the migration applies). Same
      // pattern as useFilteredLeadIds. Result shape is asserted below.
      const { data, error } = await supabase.rpc(
        "get_custom_filtered_lead_ids" as any,
        {
          p_pipeline_id: pipelineId,
          p_stage_id: pStageId,
          p_search: pSearch,
          p_responsible_id: pResponsibleId,
          p_tag_ids: pTagIds,
          p_qualification_tier: pQualificationTier,
          p_pre_qualification_tier: pPreQualificationTier,
          p_origin: pOrigin,
        },
      );
      if (error) throw error;
      return (data ?? []) as string[];
    },
    enabled: !!organizationId && !!pipelineId,
  });
}
