-- ============================================================================
-- get_filtered_lead_ids — richer audience conditions (Disparo Phase 1)
-- ============================================================================
-- Extends the "Filtro ativo" system-funnel audience resolver (issue #705,
-- migration 20261120000000) with three additional lead-level dimensions the
-- Disparo wizard now filters on, alongside the existing search / responsible /
-- tags / optional-stage surface:
--
--     p_qualification_tier      — leads.qualification_tier::text     = ANY(...)
--     p_pre_qualification_tier  — leads.pre_qualification_tier::text = ANY(...)
--     p_origin                  — leads.origin::text                 = ANY(...)
--
-- These three are the SHARED CONDITION SET applied identically across the three
-- Disparo audience surfaces (system funnels here, custom funnels in
-- get_custom_filtered_lead_ids, carteira in get_carteira_lead_ids). Each is
-- NULL/empty → not applied. They use ::text = ANY(...) so the caller passes
-- plain text[] (no enum-cast coupling on the client).
--
-- Adding parameters CHANGES THE SIGNATURE. Postgres would otherwise leave the
-- old 5-arg function in place as an OVERLOAD, and PostgREST cannot disambiguate
-- two candidates that differ only by trailing defaulted args. So we DROP the
-- old function explicitly and CREATE the single 8-arg replacement. The
-- search / responsible / tags / stage logic is preserved VERBATIM — only the
-- three new conditions are added.
--
-- SECURITY (fail-closed) — UNCHANGED posture from 20261120000000:
--   * SECURITY INVOKER + leads RLS backstop (INNER join hides cross-tenant /
--     trashed rows even if a pipeline_entries row leaked).
--   * Tenancy derived SERVER-SIDE from auth via get_my_organization_ids()
--     (SECURITY DEFINER helper — avoids the inline team_members recursion
--     hazard). No org_id parameter; the client cannot widen scope.
--   * SET search_path = ''. Soft-deleted leads excluded; lead_id NOT NULL.
-- ============================================================================

-- Drop the 5-arg version (issue #705) so we don't leave an overloaded pair that
-- breaks PostgREST candidate resolution.
DROP FUNCTION IF EXISTS public.get_filtered_lead_ids(TEXT, TEXT, TEXT, UUID, UUID[]);

CREATE FUNCTION public.get_filtered_lead_ids(
  p_pipeline_type          TEXT,
  p_stage_key              TEXT    DEFAULT NULL,
  p_search                 TEXT    DEFAULT NULL,
  p_responsible_id         UUID    DEFAULT NULL,
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
  SELECT pe.lead_id
  FROM public.pipeline_entries pe
  JOIN public.pipelines p
    ON p.id = pe.pipeline_id
   AND p.type = 'system'
   AND p.slug = p_pipeline_type
  JOIN public.leads l
    ON l.id = pe.lead_id
   AND l.deleted_at IS NULL
  WHERE pe.lead_id IS NOT NULL
    -- Tenancy: server-derived caller orgs (SECURITY DEFINER helper).
    AND pe.organization_id IN (SELECT public.get_my_organization_ids())
    -- Optional stage scope: NULL = whole pipeline (every stage).
    AND (p_stage_key IS NULL OR pe.stage_key = p_stage_key)
    -- Search filter (mirrors get_pipeline_page: name / phone / company).
    AND (p_search IS NULL OR p_search = '' OR (
      l.name    ILIKE '%' || p_search || '%'
      OR l.phone   ILIKE '%' || p_search || '%'
      OR l.company ILIKE '%' || p_search || '%'
    ))
    -- Responsible filter (dual fields: entry metadata + lead columns).
    AND (p_responsible_id IS NULL OR (
      (pe.metadata->>'pre_sale_responsible_id')::UUID = p_responsible_id
      OR (pe.metadata->>'sale_responsible_id')::UUID = p_responsible_id
      OR l.pre_sale_responsible_id = p_responsible_id
      OR l.sale_responsible_id = p_responsible_id
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

GRANT EXECUTE ON FUNCTION public.get_filtered_lead_ids(
  TEXT, TEXT, TEXT, UUID, UUID[], TEXT[], TEXT[], TEXT[]
) TO authenticated;
