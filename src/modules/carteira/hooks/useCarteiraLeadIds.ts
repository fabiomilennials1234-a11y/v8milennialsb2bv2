import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

/**
 * Filter params accepted by {@link useCarteiraLeadIds}. The CARTEIRA
 * (post-sale) counterpart of the funnel resolvers' params:
 *
 *   - `segments`              — `upsell_clients.segment` ∈ list
 *                              (ouro|prata|novo|resgate|dormindo); empty = all
 *   - `search`               — ILIKE on lead name / phone / company
 *   - `tagIds`               — lead must have ALL listed tags (intersection)
 *   - `qualificationTier`    — `leads.qualification_tier` ∈ list; empty = all
 *   - `preQualificationTier` — `leads.pre_qualification_tier` ∈ list; empty=all
 *   - `origin`               — `leads.origin` ∈ list; empty = all
 *
 * No `responsibleId`: carteira accounts are owned by `closer_id`, a different
 * surface than the funnel responsible picker; the wizard does not filter
 * carteira by responsible in Phase 1. See the RPC migration (20261123000002).
 */
export interface CarteiraLeadIdsParams {
  segments?: string[];
  search?: string;
  tagIds?: string[];
  qualificationTier?: string[];
  preQualificationTier?: string[];
  origin?: string[];
}

/**
 * Resolve the lead_ids of ACTIVE carteira clients (post-sale portfolio) matching
 * the Disparo wizard's audience conditions, for the caller's org — the carteira
 * audience source for Disparo Phase 1.
 *
 * Returns LEAD_IDS (not upsell_clients ids): each carteira row has a lead_id →
 * leads.phone, and the Quick Blast engine resolves phones from leads exactly as
 * it does for the funnel surfaces, so all three resolvers feed the engine
 * through one contract.
 *
 * Tenancy is enforced server-side: the RPC derives the caller's orgs from auth
 * via `get_my_organization_ids()` and never trusts a client-supplied org.
 *
 * Contract is stable — the Disparo wizard codes against this signature.
 */
export function useCarteiraLeadIds(params: CarteiraLeadIdsParams = {}) {
  const { organizationId } = useOrganization();
  const {
    segments,
    search,
    tagIds,
    qualificationTier,
    preQualificationTier,
    origin,
  } = params;

  const pSegments = segments?.length ? segments : null;
  const pSearch = search || null;
  const pTagIds = tagIds?.length ? tagIds : null;
  const pQualificationTier = qualificationTier?.length ? qualificationTier : null;
  const pPreQualificationTier = preQualificationTier?.length
    ? preQualificationTier
    : null;
  const pOrigin = origin?.length ? origin : null;

  return useQuery({
    queryKey: [
      "carteira_lead_ids",
      pSegments,
      pSearch,
      pTagIds,
      pQualificationTier,
      pPreQualificationTier,
      pOrigin,
      organizationId,
    ],
    queryFn: async (): Promise<string[]> => {
      // `as any` on the RPC name: get_carteira_lead_ids is newer than the last
      // generated types.ts (regen after the migration applies). Same pattern as
      // useFilteredLeadIds. Result shape is asserted below.
      const { data, error } = await supabase.rpc(
        "get_carteira_lead_ids" as any,
        {
          p_segments: pSegments,
          p_search: pSearch,
          p_tag_ids: pTagIds,
          p_qualification_tier: pQualificationTier,
          p_pre_qualification_tier: pPreQualificationTier,
          p_origin: pOrigin,
        },
      );
      if (error) throw error;
      return (data ?? []) as string[];
    },
    enabled: !!organizationId,
  });
}
