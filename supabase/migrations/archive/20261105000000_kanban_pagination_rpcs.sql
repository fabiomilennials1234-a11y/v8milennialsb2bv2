-- ============================================================================
-- Kanban Server-Side Pagination RPCs
-- ============================================================================
-- Two RPCs for paginated kanban views:
--   1. get_pipeline_page   — cursor-paginated entries for a single stage
--   2. get_pipeline_stage_counts — entry count per stage (for column headers)
-- ============================================================================

-- Index: covers the main pagination query (pipeline + stage + created_at DESC)
CREATE INDEX IF NOT EXISTS idx_pe_pipeline_stage_created
  ON public.pipeline_entries (pipeline_id, stage_key, created_at DESC)
  WHERE lead_id IS NOT NULL;

-- ============================================================================
-- 1. get_pipeline_page
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_pipeline_page(
  p_pipeline_slug TEXT,
  p_stage_id TEXT,
  p_org_id UUID,
  p_page_size INT DEFAULT 20,
  p_cursor TIMESTAMPTZ DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_responsible_id UUID DEFAULT NULL,
  p_tag_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  pipeline_id UUID,
  lead_id UUID,
  stage_key TEXT,
  assigned_to UUID,
  notes TEXT,
  metadata JSONB,
  entered_at TIMESTAMPTZ,
  stage_changed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  lead JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_pipeline_id UUID;
BEGIN
  -- Resolve pipeline_id from slug + org
  SELECT p.id INTO v_pipeline_id
  FROM public.pipelines p
  WHERE p.slug = p_pipeline_slug
    AND p.type = 'system'
    AND p.organization_id = p_org_id;

  IF v_pipeline_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    pe.id,
    pe.pipeline_id,
    pe.lead_id,
    pe.stage_key,
    pe.assigned_to,
    pe.notes,
    pe.metadata,
    pe.entered_at,
    pe.stage_changed_at,
    pe.created_at,
    pe.updated_at,
    jsonb_build_object(
      'id', l.id,
      'name', l.name,
      'company', l.company,
      'email', l.email,
      'phone', l.phone,
      'rating', l.rating,
      'origin', l.origin,
      'segment', l.segment,
      'faturamento', l.faturamento,
      'urgency', l.urgency,
      'notes', l.notes,
      'compromisso_date', l.compromisso_date,
      'ai_disabled', l.ai_disabled,
      'avatar_url', l.avatar_url,
      'pre_qualification_tier', l.pre_qualification_tier,
      'qualification_tier', l.qualification_tier,
      'sdr_id', l.sdr_id,
      'closer_id', l.closer_id,
      'responsible_id', l.responsible_id,
      'pre_sale_responsible_id', l.pre_sale_responsible_id,
      'sale_responsible_id', l.sale_responsible_id,
      'responsible', CASE WHEN tm_resp.id IS NOT NULL
        THEN jsonb_build_object('id', tm_resp.id, 'name', tm_resp.name, 'avatar_url', tm_resp.avatar_url)
        ELSE NULL END,
      'sdr', CASE WHEN tm_sdr.id IS NOT NULL
        THEN jsonb_build_object('id', tm_sdr.id, 'name', tm_sdr.name, 'avatar_url', tm_sdr.avatar_url)
        ELSE NULL END,
      'closer', CASE WHEN tm_closer.id IS NOT NULL
        THEN jsonb_build_object('id', tm_closer.id, 'name', tm_closer.name, 'avatar_url', tm_closer.avatar_url)
        ELSE NULL END,
      'pre_sale_responsible', CASE WHEN tm_pre.id IS NOT NULL
        THEN jsonb_build_object('id', tm_pre.id, 'name', tm_pre.name, 'avatar_url', tm_pre.avatar_url)
        ELSE NULL END,
      'sale_responsible', CASE WHEN tm_sale.id IS NOT NULL
        THEN jsonb_build_object('id', tm_sale.id, 'name', tm_sale.name, 'avatar_url', tm_sale.avatar_url)
        ELSE NULL END,
      'lead_tags', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'tag', jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color)
        ))
        FROM public.lead_tags lt
        JOIN public.tags t ON t.id = lt.tag_id
        WHERE lt.lead_id = l.id
      ), '[]'::jsonb)
    ) AS lead
  FROM public.pipeline_entries pe
  JOIN public.leads l ON l.id = pe.lead_id
  LEFT JOIN public.team_members tm_resp ON tm_resp.id = l.responsible_id
  LEFT JOIN public.team_members tm_sdr ON tm_sdr.id = l.sdr_id
  LEFT JOIN public.team_members tm_closer ON tm_closer.id = l.closer_id
  LEFT JOIN public.team_members tm_pre ON tm_pre.id = l.pre_sale_responsible_id
  LEFT JOIN public.team_members tm_sale ON tm_sale.id = l.sale_responsible_id
  WHERE pe.pipeline_id = v_pipeline_id
    AND pe.stage_key = p_stage_id
    AND pe.organization_id = p_org_id
    AND pe.lead_id IS NOT NULL
    -- Cursor pagination
    AND (p_cursor IS NULL OR pe.created_at < p_cursor)
    -- Search filter
    AND (p_search IS NULL OR p_search = '' OR (
      l.name ILIKE '%' || p_search || '%'
      OR l.phone ILIKE '%' || p_search || '%'
      OR l.company ILIKE '%' || p_search || '%'
    ))
    -- Responsible filter (dual fields: entry metadata + lead columns)
    AND (p_responsible_id IS NULL OR (
      (pe.metadata->>'pre_sale_responsible_id')::UUID = p_responsible_id
      OR (pe.metadata->>'sale_responsible_id')::UUID = p_responsible_id
      OR l.pre_sale_responsible_id = p_responsible_id
      OR l.sale_responsible_id = p_responsible_id
    ))
    -- Tag filter (intersection: lead must have ALL specified tags)
    AND (p_tag_ids IS NULL OR array_length(p_tag_ids, 1) IS NULL OR NOT EXISTS (
      SELECT unnest(p_tag_ids)
      EXCEPT
      SELECT lt2.tag_id FROM public.lead_tags lt2 WHERE lt2.lead_id = l.id
    ))
  ORDER BY pe.created_at DESC
  LIMIT p_page_size;
END;
$$;

-- ============================================================================
-- 2. get_pipeline_stage_counts
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_pipeline_stage_counts(
  p_pipeline_slug TEXT,
  p_org_id UUID,
  p_search TEXT DEFAULT NULL,
  p_responsible_id UUID DEFAULT NULL,
  p_tag_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (
  stage_key TEXT,
  cnt BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_pipeline_id UUID;
BEGIN
  SELECT p.id INTO v_pipeline_id
  FROM public.pipelines p
  WHERE p.slug = p_pipeline_slug
    AND p.type = 'system'
    AND p.organization_id = p_org_id;

  IF v_pipeline_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    pe.stage_key,
    COUNT(*)::BIGINT AS cnt
  FROM public.pipeline_entries pe
  JOIN public.leads l ON l.id = pe.lead_id
  WHERE pe.pipeline_id = v_pipeline_id
    AND pe.organization_id = p_org_id
    AND pe.lead_id IS NOT NULL
    AND (p_search IS NULL OR p_search = '' OR (
      l.name ILIKE '%' || p_search || '%'
      OR l.phone ILIKE '%' || p_search || '%'
      OR l.company ILIKE '%' || p_search || '%'
    ))
    AND (p_responsible_id IS NULL OR (
      (pe.metadata->>'pre_sale_responsible_id')::UUID = p_responsible_id
      OR (pe.metadata->>'sale_responsible_id')::UUID = p_responsible_id
      OR l.pre_sale_responsible_id = p_responsible_id
      OR l.sale_responsible_id = p_responsible_id
    ))
    AND (p_tag_ids IS NULL OR array_length(p_tag_ids, 1) IS NULL OR NOT EXISTS (
      SELECT unnest(p_tag_ids)
      EXCEPT
      SELECT lt2.tag_id FROM public.lead_tags lt2 WHERE lt2.lead_id = l.id
    ))
  GROUP BY pe.stage_key;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_pipeline_page TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pipeline_stage_counts TO authenticated;
