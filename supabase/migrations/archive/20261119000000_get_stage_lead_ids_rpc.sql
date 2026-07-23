-- ============================================================================
-- get_stage_lead_ids — Disparo F1 stage audience resolver (issue #703)
-- ============================================================================
-- Returns ALL lead_ids sitting in a given (pipeline_type, stage_key) for the
-- caller's organization(s). Feeds the Quick Blast engine, which re-queries the
-- leads, normalizes phones, dedups and applies the org cap — so this resolver
-- only needs to hand back the raw lead_id set (no pagination, no joins).
--
-- SECURITY (fail-closed):
--   * Tenancy is derived SERVER-SIDE from auth via get_my_organization_ids()
--     (SECURITY DEFINER helper — bypasses RLS without the inline
--     `SELECT ... FROM team_members` recursion hazard flagged in CLAUDE.md).
--   * No org_id parameter is accepted; the client cannot widen scope.
--   * Only rows whose pipeline_entries.organization_id is in the caller's orgs
--     are returned. A caller in org B gets nothing for an org A stage.
--   * SECURITY INVOKER + leads RLS is the backstop: the lead join is INNER and
--     leads RLS hides cross-tenant / trashed rows even if an entry leaked.
--   * Soft-deleted leads (leads.deleted_at IS NOT NULL) are excluded.
--
-- Pipeline mapping mirrors get_pipeline_page: p_pipeline_type is the system
-- pipeline `slug` (whatsapp | confirmacao | propostas | upsell_*), resolved per
-- org against pipelines WHERE type = 'system'.
-- ============================================================================

-- Covers the resolver's filter: pipeline + stage + non-null lead.
CREATE INDEX IF NOT EXISTS idx_pe_pipeline_stage_lead
  ON public.pipeline_entries (pipeline_id, stage_key)
  WHERE lead_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_stage_lead_ids(
  p_pipeline_type TEXT,
  p_stage_key TEXT
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
  WHERE pe.stage_key = p_stage_key
    AND pe.lead_id IS NOT NULL
    -- Tenancy: server-derived caller orgs (SECURITY DEFINER helper).
    AND pe.organization_id IN (SELECT public.get_my_organization_ids());
$$;

GRANT EXECUTE ON FUNCTION public.get_stage_lead_ids(TEXT, TEXT) TO authenticated;
