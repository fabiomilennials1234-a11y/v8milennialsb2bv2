-- ============================================================================
-- Kanban filters → server-side (count + page parity)
-- ============================================================================
-- Problem: the kanban column count badge (DraggableKanbanBoard) renders
-- `column.totalCount`, which came from get_pipeline_stage_counts knowing ONLY
-- search / responsible / tags. Origin, period, scheduled, urgency, calor,
-- rating(priority), product_type, meeting-time and overdue filters ran
-- client-side AFTER pagination — so the badge kept showing the unfiltered
-- total (e.g. Perdido=21 even after filtering origin=site → 10 cards), and the
-- client filter only ever saw the loaded page (20/stage).
--
-- Fix: push ALL board filters into BOTH RPCs via GENERIC predicate params.
-- Band/bucket/timezone semantics stay in the client (which translates its UI
-- into concrete ranges/arrays); the RPC only applies generic SQL predicates.
-- This keeps count and pagination consistent and kills the bug class for all
-- three system boards (whatsapp / confirmacao / propostas).
--
-- Param defaults mirror the client exactly:
--   calor  → COALESCE(metadata.calor, 5)
--   rating → COALESCE(leads.rating, 0)
-- A NULL param means "filter disabled" (no narrowing). Predicates short-circuit
-- on `p_x IS NULL` so an unfiltered board pays ZERO extra cost.
--
-- The two functions are dropped first because adding parameters changes their
-- signature (CREATE OR REPLACE cannot add args — it would create an overload
-- and make PostgREST resolution ambiguous).
--
-- SECURITY INVOKER preserved: RLS on pipeline_entries / leads /
-- scheduled_user_messages keeps tenant isolation. search_path pinned + every
-- object schema-qualified.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_pipeline_page(TEXT, TEXT, UUID, INT, TIMESTAMPTZ, TEXT, UUID, UUID[]);
DROP FUNCTION IF EXISTS public.get_pipeline_stage_counts(TEXT, UUID, TEXT, UUID, UUID[]);

-- ============================================================================
-- 1. get_pipeline_page — cursor-paginated entries for a single stage
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_pipeline_page(
  p_pipeline_slug TEXT,
  p_stage_id TEXT,
  p_org_id UUID,
  p_page_size INT DEFAULT 20,
  p_cursor TIMESTAMPTZ DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_responsible_id UUID DEFAULT NULL,
  p_tag_ids UUID[] DEFAULT NULL,
  -- generic filter params (client maps its UI → these)
  p_origins TEXT[] DEFAULT NULL,
  p_rating_min INT DEFAULT NULL,
  p_rating_max INT DEFAULT NULL,
  p_calor_min INT DEFAULT NULL,
  p_calor_max INT DEFAULT NULL,
  p_urgency TEXT DEFAULT NULL,
  p_product_type TEXT DEFAULT NULL,
  p_meeting_after TIMESTAMPTZ DEFAULT NULL,
  p_meeting_before TIMESTAMPTZ DEFAULT NULL,
  p_period_after TIMESTAMPTZ DEFAULT NULL,
  p_period_before TIMESTAMPTZ DEFAULT NULL,
  p_closed_status_keys TEXT[] DEFAULT NULL,
  p_updated_before TIMESTAMPTZ DEFAULT NULL,
  p_overdue_exclude_status_keys TEXT[] DEFAULT NULL,
  p_status_keys TEXT[] DEFAULT NULL,
  p_scheduled BOOLEAN DEFAULT NULL
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
SET search_path = ''
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
    AND (p_cursor IS NULL OR pe.created_at < p_cursor)
    -- ── search / responsible / tags (unchanged) ──────────────────────────
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
    -- ── generic board filters (client maps its UI → these) ───────────────
    AND (p_origins IS NULL OR array_length(p_origins, 1) IS NULL OR l.origin::TEXT = ANY(p_origins))
    AND (p_rating_min IS NULL OR COALESCE(l.rating, 0) >= p_rating_min)
    AND (p_rating_max IS NULL OR COALESCE(l.rating, 0) <= p_rating_max)
    AND (p_calor_min IS NULL OR COALESCE(NULLIF(pe.metadata->>'calor', '')::INT, 5) >= p_calor_min)
    AND (p_calor_max IS NULL OR COALESCE(NULLIF(pe.metadata->>'calor', '')::INT, 5) <= p_calor_max)
    AND (p_urgency IS NULL OR l.urgency = p_urgency)
    AND (p_product_type IS NULL OR pe.metadata->>'product_type' = p_product_type)
    AND (p_meeting_after IS NULL OR NULLIF(pe.metadata->>'meeting_date', '')::TIMESTAMPTZ >= p_meeting_after)
    AND (p_meeting_before IS NULL OR NULLIF(pe.metadata->>'meeting_date', '')::TIMESTAMPTZ <= p_meeting_before)
    AND (p_period_after IS NULL OR (
      CASE WHEN p_closed_status_keys IS NOT NULL AND pe.stage_key = ANY(p_closed_status_keys)
        THEN COALESCE(NULLIF(pe.metadata->>'metrics_period_at', '')::TIMESTAMPTZ, pe.updated_at)
        ELSE pe.created_at END) >= p_period_after)
    AND (p_period_before IS NULL OR (
      CASE WHEN p_closed_status_keys IS NOT NULL AND pe.stage_key = ANY(p_closed_status_keys)
        THEN COALESCE(NULLIF(pe.metadata->>'metrics_period_at', '')::TIMESTAMPTZ, pe.updated_at)
        ELSE pe.created_at END) <= p_period_before)
    AND (p_updated_before IS NULL OR (
      pe.updated_at <= p_updated_before
      AND (p_overdue_exclude_status_keys IS NULL OR pe.stage_key <> ALL(p_overdue_exclude_status_keys))
    ))
    AND (p_status_keys IS NULL OR array_length(p_status_keys, 1) IS NULL OR pe.stage_key = ANY(p_status_keys))
    AND (NOT COALESCE(p_scheduled, FALSE) OR EXISTS (
      SELECT 1 FROM public.scheduled_user_messages sm
      WHERE sm.lead_id = l.id AND sm.organization_id = p_org_id AND sm.status = 'scheduled'
    ))
  ORDER BY pe.created_at DESC
  LIMIT p_page_size;
END;
$$;

-- ============================================================================
-- 2. get_pipeline_stage_counts — entry count per stage (column header badge)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_pipeline_stage_counts(
  p_pipeline_slug TEXT,
  p_org_id UUID,
  p_search TEXT DEFAULT NULL,
  p_responsible_id UUID DEFAULT NULL,
  p_tag_ids UUID[] DEFAULT NULL,
  p_origins TEXT[] DEFAULT NULL,
  p_rating_min INT DEFAULT NULL,
  p_rating_max INT DEFAULT NULL,
  p_calor_min INT DEFAULT NULL,
  p_calor_max INT DEFAULT NULL,
  p_urgency TEXT DEFAULT NULL,
  p_product_type TEXT DEFAULT NULL,
  p_meeting_after TIMESTAMPTZ DEFAULT NULL,
  p_meeting_before TIMESTAMPTZ DEFAULT NULL,
  p_period_after TIMESTAMPTZ DEFAULT NULL,
  p_period_before TIMESTAMPTZ DEFAULT NULL,
  p_closed_status_keys TEXT[] DEFAULT NULL,
  p_updated_before TIMESTAMPTZ DEFAULT NULL,
  p_overdue_exclude_status_keys TEXT[] DEFAULT NULL,
  p_status_keys TEXT[] DEFAULT NULL,
  p_scheduled BOOLEAN DEFAULT NULL
)
RETURNS TABLE (
  stage_key TEXT,
  cnt BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
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
    -- ── search / responsible / tags (unchanged) ──────────────────────────
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
    -- ── generic board filters (mirror get_pipeline_page) ─────────────────
    AND (p_origins IS NULL OR array_length(p_origins, 1) IS NULL OR l.origin::TEXT = ANY(p_origins))
    AND (p_rating_min IS NULL OR COALESCE(l.rating, 0) >= p_rating_min)
    AND (p_rating_max IS NULL OR COALESCE(l.rating, 0) <= p_rating_max)
    AND (p_calor_min IS NULL OR COALESCE(NULLIF(pe.metadata->>'calor', '')::INT, 5) >= p_calor_min)
    AND (p_calor_max IS NULL OR COALESCE(NULLIF(pe.metadata->>'calor', '')::INT, 5) <= p_calor_max)
    AND (p_urgency IS NULL OR l.urgency = p_urgency)
    AND (p_product_type IS NULL OR pe.metadata->>'product_type' = p_product_type)
    AND (p_meeting_after IS NULL OR NULLIF(pe.metadata->>'meeting_date', '')::TIMESTAMPTZ >= p_meeting_after)
    AND (p_meeting_before IS NULL OR NULLIF(pe.metadata->>'meeting_date', '')::TIMESTAMPTZ <= p_meeting_before)
    AND (p_period_after IS NULL OR (
      CASE WHEN p_closed_status_keys IS NOT NULL AND pe.stage_key = ANY(p_closed_status_keys)
        THEN COALESCE(NULLIF(pe.metadata->>'metrics_period_at', '')::TIMESTAMPTZ, pe.updated_at)
        ELSE pe.created_at END) >= p_period_after)
    AND (p_period_before IS NULL OR (
      CASE WHEN p_closed_status_keys IS NOT NULL AND pe.stage_key = ANY(p_closed_status_keys)
        THEN COALESCE(NULLIF(pe.metadata->>'metrics_period_at', '')::TIMESTAMPTZ, pe.updated_at)
        ELSE pe.created_at END) <= p_period_before)
    AND (p_updated_before IS NULL OR (
      pe.updated_at <= p_updated_before
      AND (p_overdue_exclude_status_keys IS NULL OR pe.stage_key <> ALL(p_overdue_exclude_status_keys))
    ))
    AND (p_status_keys IS NULL OR array_length(p_status_keys, 1) IS NULL OR pe.stage_key = ANY(p_status_keys))
    AND (NOT COALESCE(p_scheduled, FALSE) OR EXISTS (
      SELECT 1 FROM public.scheduled_user_messages sm
      WHERE sm.lead_id = l.id AND sm.organization_id = p_org_id AND sm.status = 'scheduled'
    ))
  GROUP BY pe.stage_key;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pipeline_page TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pipeline_stage_counts TO authenticated;
