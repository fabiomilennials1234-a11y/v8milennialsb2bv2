import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import type { PipelineType } from "./usePipelineEntries";

/**
 * Filter params accepted by {@link useFilteredLeadIds}. Mirrors the board's
 * server-resolved filter surface (`PaginatedFilters` in `usePaginatedPipeline`)
 * plus an optional stage scope:
 *
 *   - `search`             — ILIKE on lead name / phone / company
 *   - `responsibleId`      — pre/sale responsible (entry metadata + lead
 *                            columns); `"all"` or `null` clears it (board parity)
 *   - `tagIds`             — lead must have ALL listed tags (intersection)
 *   - `stageKey`           — optional; `null`/omitted = whole pipeline
 *   - `qualificationTier`     — `leads.qualification_tier` ∈ list; empty = all
 *   - `preQualificationTier`  — `leads.pre_qualification_tier` ∈ list; empty = all
 *   - `origin`                — `leads.origin` ∈ list; empty = all
 *
 * The first four mirror exactly the dimensions the board resolves SERVER-SIDE.
 * The tier/origin trio are the Disparo Phase-1 audience conditions, shared with
 * the custom-funnel and carteira resolvers. The board's other panel filters
 * (`urgency`, `product-type`, `status-multi`, `scheduled`,
 * date-range) are applied client-side on the loaded kanban page only
 * (PipeWhatsapp `filterItemsLocal`) and are NOT part of the board's full result
 * set, so they remain absent here. See the RPC migrations (20261120000000,
 * 20261123000000) for the coverage rationale.
 */
export interface FilteredLeadIdsParams {
  search?: string;
  responsibleId?: string | null;
  tagIds?: string[];
  stageKey?: string | null;
  qualificationTier?: string[];
  preQualificationTier?: string[];
  origin?: string[];
}

/**
 * Resolve EVERY lead_id matching the funnel board's currently-active filter for
 * the caller's org — the "Filtro ativo" audience source for Disparo (issue
 * #705). Resolves ALL matching rows across the whole pipeline (not just the
 * loaded kanban page), so the wizard count matches the board after the same
 * filter.
 *
 * Tenancy is enforced server-side: the RPC derives the caller's orgs from auth
 * via `get_my_organization_ids()` and never trusts a client-supplied org. The
 * returned ids feed the Quick Blast engine (it re-queries leads, normalizes
 * phones, dedups and applies the org cap).
 *
 * Contract is stable — the Disparo wizard codes against this signature.
 */
export function useFilteredLeadIds(
  pipelineType: PipelineType,
  params: FilteredLeadIdsParams = {},
) {
  const { organizationId } = useOrganization();
  const {
    search,
    responsibleId,
    tagIds,
    stageKey,
    qualificationTier,
    preQualificationTier,
    origin,
  } = params;

  // Normalize like usePaginatedPipeline's rpcParams: "all"/empty → null so the
  // resolved set lines up 1:1 with what the board sends to get_pipeline_page.
  const pResponsibleId =
    responsibleId === "all" ? null : responsibleId || null;
  const pSearch = search || null;
  const pTagIds = tagIds?.length ? tagIds : null;
  const pStageKey = stageKey || null;
  // Shared condition set: empty/omitted → null (RPC treats null as "all").
  const pQualificationTier = qualificationTier?.length ? qualificationTier : null;
  const pPreQualificationTier = preQualificationTier?.length
    ? preQualificationTier
    : null;
  const pOrigin = origin?.length ? origin : null;

  return useQuery({
    queryKey: [
      "filtered_lead_ids",
      pipelineType,
      pStageKey,
      pSearch,
      pResponsibleId,
      pTagIds,
      pQualificationTier,
      pPreQualificationTier,
      pOrigin,
      organizationId,
    ],
    queryFn: async (): Promise<string[]> => {
      // `as any` on the RPC name: get_filtered_lead_ids is newer than the last
      // generated types.ts (regen after the migration applies). Same pattern as
      // useStageLeadIds. Result shape is asserted below.
      const { data, error } = await supabase.rpc("get_filtered_lead_ids" as any, {
        p_pipeline_type: pipelineType,
        p_stage_key: pStageKey,
        p_search: pSearch,
        p_responsible_id: pResponsibleId,
        p_tag_ids: pTagIds,
        p_qualification_tier: pQualificationTier,
        p_pre_qualification_tier: pPreQualificationTier,
        p_origin: pOrigin,
        // Master-ghost: destrava o ramo master server-side p/ org sem
        // membership (gateado por is_master_user). Ver migration 20261228000000.
        p_organization_id: organizationId,
      });
      if (error) throw error;
      return (data ?? []) as string[];
    },
    enabled: !!organizationId,
  });
}
