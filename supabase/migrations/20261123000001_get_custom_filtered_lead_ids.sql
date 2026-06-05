-- ============================================================================
-- get_custom_filtered_lead_ids — CUSTOM-funnel audience resolver (Disparo P1)
-- ============================================================================
-- The custom-funnel sibling of get_filtered_lead_ids. Resolves ALL lead_ids in
-- a CUSTOM pipeline (custom_pipe_entries → custom_pipelines, NOT type='system')
-- matching the Disparo wizard's audience conditions, for the caller's org. The
-- resolved ids feed the Quick Blast engine (it re-queries leads, normalizes
-- phones, dedups and applies the org cap) — same contract as the system RPC.
--
-- Source: custom_pipe_entries (stage_id uuid, NOT stage_key slug like the
-- system model) joined to leads + lead_tags. Scoped by:
--     p_pipeline_id  — REQUIRED: the custom pipeline (custom_pipelines.id).
--     p_stage_id     — OPTIONAL: a single custom_pipeline_stages.id; NULL =
--                      every stage of the pipeline.
-- plus the SHARED CONDITION SET (identical to get_filtered_lead_ids):
--     p_search / p_responsible_id / p_tag_ids /
--     p_qualification_tier / p_pre_qualification_tier / p_origin.
--
-- RESPONSIBLE: custom_pipe_entries has no pre/sale metadata JSON like the
-- system entries; it carries assigned_to (a profiles.id, not team_members.id),
-- which is a different identity space than the wizard's responsible picker
-- (team_members). So responsible here matches the LEAD columns only
-- (pre_sale_responsible_id / sale_responsible_id) — the canonical lead owner,
-- consistent with how the system RPC's lead-column branch resolves it.
--
-- SECURITY (fail-closed) — identical posture to get_filtered_lead_ids:
--   * SECURITY INVOKER + leads RLS backstop (INNER join hides cross-tenant /
--     trashed rows). Tenancy server-derived via get_my_organization_ids().
--   * No org_id parameter; the client cannot widen scope.
--   * SET search_path = ''. Soft-deleted leads excluded; lead_id NOT NULL.
--
-- Indexes reused: idx_custom_pipe_entries_pipeline (pipeline_id) +
-- idx_custom_pipe_entries_stage (stage_id) from 20260627000000. No new index.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_custom_filtered_lead_ids(
  p_pipeline_id            UUID,
  p_stage_id               UUID    DEFAULT NULL,
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
  SELECT ce.lead_id
  FROM public.custom_pipe_entries ce
  JOIN public.leads l
    ON l.id = ce.lead_id
   AND l.deleted_at IS NULL
  WHERE ce.lead_id IS NOT NULL
    AND ce.pipeline_id = p_pipeline_id
    -- Tenancy: server-derived caller orgs (SECURITY DEFINER helper).
    AND ce.organization_id IN (SELECT public.get_my_organization_ids())
    -- Optional stage scope: NULL = whole pipeline (every stage).
    AND (p_stage_id IS NULL OR ce.stage_id = p_stage_id)
    -- Search filter (mirrors get_filtered_lead_ids: name / phone / company).
    AND (p_search IS NULL OR p_search = '' OR (
      l.name    ILIKE '%' || p_search || '%'
      OR l.phone   ILIKE '%' || p_search || '%'
      OR l.company ILIKE '%' || p_search || '%'
    ))
    -- Responsible filter (lead columns only — see header note on assigned_to).
    AND (p_responsible_id IS NULL OR (
      l.pre_sale_responsible_id = p_responsible_id
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

GRANT EXECUTE ON FUNCTION public.get_custom_filtered_lead_ids(
  UUID, UUID, TEXT, UUID, UUID[], TEXT[], TEXT[], TEXT[]
) TO authenticated;
