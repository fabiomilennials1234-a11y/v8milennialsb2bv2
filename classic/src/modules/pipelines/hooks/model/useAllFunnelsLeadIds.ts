import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

/**
 * Conditions accepted by {@link useAllFunnelsLeadIds} — the same four narrowers
 * every other Disparo resolver takes:
 *
 *   - `tagIds`                — lead must have ALL listed tags (intersection)
 *   - `qualificationTier`     — `leads.qualification_tier` ∈ list; empty = all
 *   - `preQualificationTier`  — `leads.pre_qualification_tier` ∈ list; empty=all
 *   - `origin`                — `leads.origin` ∈ list; empty = all
 *
 * There is deliberately NO stage, search or responsible param: the cross-funnel
 * union spans two funnel models with incompatible stage keys (`stage_key` slug
 * vs `stage_id` uuid) and asymmetric responsible storage (system keeps it on the
 * entry metadata, custom does not), so those dimensions cannot be expressed
 * consistently across the union. The wizard never sends them.
 */
export interface AllFunnelsLeadIdsParams {
  tagIds?: string[];
  qualificationTier?: string[];
  preQualificationTier?: string[];
  origin?: string[];
}

/**
 * Resolve EVERY lead_id that sits in ANY funnel of the caller's org — the union
 * of the 3 system pipes (`pipeline_entries`) and every custom pipeline
 * (`custom_pipe_entries`), DEDUPLICATED, then narrowed by the audience
 * conditions. Backs the "Todos os funis" audience source of the Disparos wizard.
 *
 * A lead in three pipes at once counts ONCE — the RPC dedups server-side with a
 * `UNION` (a lead in multiple pipes is a domain invariant, and without dedup the
 * same person would receive the same blast N times).
 *
 * This is NOT "the whole lead base": a lead that never entered a funnel is not
 * in the result. Filtering `leads` directly was considered and rejected.
 *
 * Tenancy is enforced server-side by `get_all_funnels_lead_ids` — the predicate
 * is replicated in BOTH branches of the union, and `p_organization_id` only
 * widens anything for a caller that `is_master_user()` already vouches for
 * (master-ghost: an org the master is not a team_member of). A non-master
 * passing a foreign org gains nothing.
 *
 * @param options.enabled — gate the query off when this resolver is not the
 *   active one. A real `enabled` flag, not a sentinel value: there is no
 *   "matches nothing" argument for this signature, and letting the widest query
 *   in the app run in the background on every keystroke would be wasteful.
 */
export function useAllFunnelsLeadIds(
  params: AllFunnelsLeadIdsParams = {},
  options: { enabled?: boolean } = {},
) {
  const { organizationId } = useOrganization();
  const { tagIds, qualificationTier, preQualificationTier, origin } = params;

  // Empty/omitted → null (the RPC treats null as "all"), matching the
  // normalization in useFilteredLeadIds / useCustomFilteredLeadIds so identical
  // conditions produce identical cache keys across resolvers.
  const pTagIds = tagIds?.length ? tagIds : null;
  const pQualificationTier = qualificationTier?.length ? qualificationTier : null;
  const pPreQualificationTier = preQualificationTier?.length
    ? preQualificationTier
    : null;
  const pOrigin = origin?.length ? origin : null;

  return useQuery({
    queryKey: [
      "all_funnels_lead_ids",
      pTagIds,
      pQualificationTier,
      pPreQualificationTier,
      pOrigin,
      organizationId,
    ],
    queryFn: async (): Promise<string[]> => {
      // `as any` on the RPC name: get_all_funnels_lead_ids is newer than the
      // last generated types.ts (regen after the migration applies). Same
      // pattern as useFilteredLeadIds. Result shape is asserted below.
      const { data, error } = await supabase.rpc("get_all_funnels_lead_ids" as any, {
        p_tag_ids: pTagIds,
        p_qualification_tier: pQualificationTier,
        p_pre_qualification_tier: pPreQualificationTier,
        p_origin: pOrigin,
        // Master-ghost: destrava o ramo master server-side p/ org sem
        // membership (gateado por is_master_user). Ver migration 20270814000000.
        p_organization_id: organizationId,
      });
      if (error) throw error;
      return (data ?? []) as string[];
    },
    enabled: !!organizationId && options.enabled !== false,
  });
}
