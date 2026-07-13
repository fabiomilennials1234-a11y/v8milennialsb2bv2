-- ============================================================================
-- get_custom_pipeline_stage_counts — entry count per stage for CUSTOM pipelines
-- ============================================================================
-- Problem: the custom-pipeline kanban column badge renders
-- `column.totalCount ?? column.items.length`. CustomPipelineKanban never set
-- `totalCount`, so it fell back to `items.length` — and the entries loader
-- (`useCustomPipeEntries`) fetches without `.range()`, so PostgREST caps the
-- result at 1000 rows. Any custom stage with >1000 entries froze its badge at
-- 1000 (real case: funil "Prospecção CNAE" stage "Novo" has 2543 → showed 1000).
--
-- Fix: mirror the canonical board's server-side count (get_pipeline_stage_counts,
-- migration 20270101000400) but for the CUSTOM model — `custom_pipe_entries`
-- grouped by `stage_id`, parametrized by `pipeline_id` (NOT type='system', which
-- would blind custom pipelines — ADR-0017 R3). Count-only, so no revenue /
-- attribution / temporal-anchor anti-patterns apply.
--
-- Badge parity: the current client badge counts ALL entries per stage (including
-- entries with lead_id NULL). So without search we count every entry. With an
-- optional search we LEFT JOIN leads and narrow by name/company/phone ILIKE —
-- entries with a NULL lead naturally drop out under search (acceptable; the
-- reported bug is the no-search case, which must be exact). Divergence accepted:
-- ILIKE does not strip accents (NFD) like the client filter — search is
-- approximate, no-search is exact.
--
-- SECURITY INVOKER: RLS on custom_pipe_entries (organization_id via
-- get_my_organization_ids()) keeps tenant isolation — org A cannot count org B's
-- entries even if it passes a foreign p_org_id. search_path pinned + every object
-- schema-qualified. NOT security definer.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_custom_pipeline_stage_counts(
  p_pipeline_id UUID,
  p_org_id UUID,
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
  stage_id UUID,
  cnt BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cpe.stage_id,
    COUNT(*)::BIGINT AS cnt
  FROM public.custom_pipe_entries cpe
  LEFT JOIN public.leads l ON l.id = cpe.lead_id
  WHERE cpe.pipeline_id = p_pipeline_id
    AND cpe.organization_id = p_org_id
    AND (p_search IS NULL OR p_search = '' OR (
      l.name ILIKE '%' || p_search || '%'
      OR l.phone ILIKE '%' || p_search || '%'
      OR l.company ILIKE '%' || p_search || '%'
    ))
  GROUP BY cpe.stage_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_custom_pipeline_stage_counts(UUID, UUID, TEXT) TO authenticated;
