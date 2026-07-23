-- ============================================================================
-- get_carteira_lead_ids — CARTEIRA (post-sale) audience resolver (Disparo P1)
-- ============================================================================
-- The third Disparo audience surface: the post-sale portfolio. Resolves the
-- lead_ids of ACTIVE carteira clients (upsell_clients.is_active = true) for the
-- caller's org, optionally narrowed by portfolio segment, plus the SHARED
-- CONDITION SET applied on the underlying lead.
--
-- Returns LEAD_IDS (not upsell_clients ids): every upsell_clients row has a
-- NOT-NULL lead_id → leads.phone, and the Quick Blast engine resolves phones
-- from leads exactly as it does for the funnel surfaces. Keeping the output a
-- lead_id SETOF makes all three resolvers feed the engine through one contract.
--
-- Scoped by:
--     p_segments  — OPTIONAL: upsell_clients.segment = ANY(...);
--                   NULL/empty = all segments (ouro|prata|novo|resgate|dormindo).
-- plus the SHARED CONDITION SET (identical to the funnel RPCs):
--     p_search / p_tag_ids /
--     p_qualification_tier / p_pre_qualification_tier / p_origin.
-- (No responsible param: carteira accounts are owned by closer_id on
--  upsell_clients, a different surface than the funnel responsible picker; the
--  wizard does not filter carteira by responsible in Phase 1.)
--
-- One lead can theoretically back more than one active carteira row only if the
-- (organization_id, lead_id) UNIQUE constraint were absent — it is NOT (see
-- 20260500000000_upsell_module.sql), so lead_ids are already distinct per org.
--
-- SECURITY (fail-closed) — identical posture to get_filtered_lead_ids:
--   * SECURITY INVOKER + leads RLS backstop (INNER join hides cross-tenant /
--     trashed rows). Tenancy server-derived via get_my_organization_ids().
--   * No org_id parameter; the client cannot widen scope.
--   * SET search_path = ''. Soft-deleted leads excluded; lead_id NOT NULL.
--
-- Indexes reused: idx_upsell_clients_active (organization_id, is_active) +
-- idx_upsell_clients_segment (organization_id, segment). No new index.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_carteira_lead_ids(
  p_segments               TEXT[]  DEFAULT NULL,
  p_search                 TEXT    DEFAULT NULL,
  p_tag_ids                UUID[]  DEFAULT NULL,
  p_qualification_tier     TEXT[]  DEFAULT NULL,
  p_pre_qualification_tier TEXT[]  DEFAULT NULL,
  p_origin                 TEXT[]  DEFAULT NULL
)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT uc.lead_id
  FROM public.upsell_clients uc
  JOIN public.leads l
    ON l.id = uc.lead_id
   AND l.deleted_at IS NULL
  WHERE uc.is_active = true
    AND uc.lead_id IS NOT NULL
    -- Tenancy: server-derived caller orgs (SECURITY DEFINER helper).
    AND uc.organization_id IN (SELECT public.get_my_organization_ids())
    -- Optional segment scope: NULL/empty = all segments.
    AND (p_segments IS NULL OR array_length(p_segments, 1) IS NULL
      OR uc.segment = ANY(p_segments))
    -- Search filter (mirrors the funnel RPCs: name / phone / company).
    AND (p_search IS NULL OR p_search = '' OR (
      l.name    ILIKE '%' || p_search || '%'
      OR l.phone   ILIKE '%' || p_search || '%'
      OR l.company ILIKE '%' || p_search || '%'
    ))
    -- Tag filter (intersection: lead must have ALL specified tags).
    AND (p_tag_ids IS NULL OR array_length(p_tag_ids, 1) IS NULL OR NOT EXISTS (
      SELECT unnest(p_tag_ids)
      EXCEPT
      SELECT lt.tag_id FROM public.lead_tags lt WHERE lt.lead_id = l.id
    ))
    -- Qualification tier (sale-side) — text membership, NULL/empty = all.
    AND (p_qualification_tier IS NULL OR array_length(p_qualification_tier, 1) IS NULL
      OR l.qualification_tier::text = ANY(p_qualification_tier))
    -- Pre-qualification tier — text membership, NULL/empty = all.
    AND (p_pre_qualification_tier IS NULL OR array_length(p_pre_qualification_tier, 1) IS NULL
      OR l.pre_qualification_tier::text = ANY(p_pre_qualification_tier))
    -- Origin — text membership, NULL/empty = all.
    AND (p_origin IS NULL OR array_length(p_origin, 1) IS NULL
      OR l.origin::text = ANY(p_origin));
$$;

GRANT EXECUTE ON FUNCTION public.get_carteira_lead_ids(
  TEXT[], TEXT, UUID[], TEXT[], TEXT[], TEXT[]
) TO authenticated;
