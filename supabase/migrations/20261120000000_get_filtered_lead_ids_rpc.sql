-- ============================================================================
-- get_filtered_lead_ids — Disparo "Filtro ativo" audience resolver (issue #705)
-- ============================================================================
-- Returns ALL lead_ids that match the funnel board's currently-active filter for
-- the caller's organization(s) — the second Disparo audience source (after
-- get_stage_lead_ids, #703). Resolved server-side over the WHOLE pipeline (every
-- page), so the wizard count matches what the operator sees on the board after
-- the same filter, not just the loaded kanban page.
--
-- The board's server-resolved superset is produced by get_pipeline_page /
-- get_pipeline_stage_counts (migration 20261105000000). Those RPCs filter
-- pipeline_entries + leads by exactly THREE dimensions:
--     p_search          — ILIKE on leads.name / phone / company
--     p_responsible_id  — entry.metadata pre/sale + leads pre/sale responsible
--     p_tag_ids         — lead must have ALL tags (intersection)
-- This resolver MIRRORS those three dimensions verbatim so the resolved set is
-- identical to the board's. p_stage_key is OPTIONAL: NULL = across the whole
-- pipeline (every stage); non-NULL = a single stage (lets "Filtro ativo" be
-- scoped to one column when the operator wants it).
--
-- ┌─ FILTER COVERAGE (explicit — do not silently diverge from the board) ──────┐
-- │ COVERED  : search, responsible (4-field), tags (ALL), optional stage_key.  │
-- │ OMITTED  : origin, calor/rating, priority, urgency, product-type,          │
-- │            status-multi, "scheduled" (agendados), date-range.              │
-- │ WHY      : the board applies these CLIENT-SIDE on the loaded page only     │
-- │            (PipeWhatsapp filterItemsLocal: origin + scheduled + metrics     │
-- │            range). They are NOT part of get_pipeline_page's server result,  │
-- │            so they never define the board's full (all-pages) set. Honoring  │
-- │            them here would make the wizard count DISAGREE with the board's  │
-- │            server truth. The "Filtro ativo" source therefore covers exactly │
-- │            the dimensions the board itself resolves server-side.            │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- SECURITY (fail-closed) — identical posture to get_stage_lead_ids (#703):
--   * Tenancy derived SERVER-SIDE from auth via get_my_organization_ids()
--     (SECURITY DEFINER helper — bypasses RLS without the inline
--     `SELECT ... FROM team_members` recursion hazard flagged in CLAUDE.md).
--   * No org_id parameter; the client cannot widen scope.
--   * SECURITY INVOKER + leads RLS is the backstop (INNER join hides
--     cross-tenant / trashed rows even if an entry leaked).
--   * Soft-deleted leads (leads.deleted_at IS NOT NULL) excluded; lead_id NOT NULL.
--
-- Pipeline mapping mirrors get_pipeline_page: p_pipeline_type is the system
-- pipeline `slug` (whatsapp | confirmacao | propostas | upsell_*), resolved per
-- org against pipelines WHERE type = 'system'.
-- ============================================================================

-- Reuses idx_pe_pipeline_stage_lead (pipeline_id, stage_key) WHERE lead_id IS
-- NOT NULL from 20261119000000; the optional-stage path also leans on
-- idx_pe_pipeline_stage_created. No new index needed.

CREATE OR REPLACE FUNCTION public.get_filtered_lead_ids(
  p_pipeline_type   TEXT,
  p_stage_key       TEXT    DEFAULT NULL,
  p_search          TEXT    DEFAULT NULL,
  p_responsible_id  UUID    DEFAULT NULL,
  p_tag_ids         UUID[]  DEFAULT NULL
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
    ));
$$;

GRANT EXECUTE ON FUNCTION public.get_filtered_lead_ids(TEXT, TEXT, TEXT, UUID, UUID[]) TO authenticated;
