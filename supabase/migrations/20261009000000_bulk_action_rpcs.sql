-- ============================================================
-- bulk_move_stage: move leads to a different pipeline + stage
-- ============================================================
CREATE OR REPLACE FUNCTION public.bulk_move_stage(
  p_lead_ids UUID[],
  p_target_pipe TEXT,
  p_target_stage TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id UUID;
  v_pipeline_id UUID;
  v_lead_id UUID;
BEGIN
  -- Get caller's org
  SELECT tm.organization_id INTO v_org_id
  FROM public.team_members tm
  WHERE tm.user_id = auth.uid() AND tm.is_active = true
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No active organization membership';
  END IF;

  -- Resolve pipeline_id from slug
  SELECT p.id INTO v_pipeline_id
  FROM public.pipelines p
  WHERE p.slug = p_target_pipe
    AND p.organization_id = v_org_id
    AND p.type = 'system'
  LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'Pipeline not found: %', p_target_pipe;
  END IF;

  -- For each lead, upsert into pipeline_entries
  FOREACH v_lead_id IN ARRAY p_lead_ids LOOP
    -- Verify lead belongs to org and is not deleted
    IF NOT EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = v_lead_id
        AND l.organization_id = v_org_id
        AND l.deleted_at IS NULL
    ) THEN
      CONTINUE;
    END IF;

    -- Upsert: if entry exists for this lead+pipeline, update stage; otherwise insert
    INSERT INTO public.pipeline_entries (
      organization_id, pipeline_id, lead_id, stage_key, stage_changed_at, entered_at
    ) VALUES (
      v_org_id, v_pipeline_id, v_lead_id, p_target_stage, now(), now()
    )
    ON CONFLICT (pipeline_id, lead_id) DO UPDATE SET
      stage_key = EXCLUDED.stage_key,
      stage_changed_at = now(),
      updated_at = now();
  END LOOP;
END;
$$;

-- ============================================================
-- bulk_assign_leads: assign responsible/sdr/closer to leads
-- ============================================================
CREATE OR REPLACE FUNCTION public.bulk_assign_leads(
  p_lead_ids UUID[],
  p_responsible_id UUID DEFAULT NULL,
  p_sdr_id UUID DEFAULT NULL,
  p_closer_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  -- Get caller's org
  SELECT tm.organization_id INTO v_org_id
  FROM public.team_members tm
  WHERE tm.user_id = auth.uid() AND tm.is_active = true
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No active organization membership';
  END IF;

  -- Set fields directly (null = remove assignment)
  UPDATE public.leads
  SET
    responsible_id = p_responsible_id,
    sdr_id = p_sdr_id,
    closer_id = p_closer_id,
    updated_at = now()
  WHERE id = ANY(p_lead_ids)
    AND organization_id = v_org_id
    AND deleted_at IS NULL;
END;
$$;

-- ============================================================
-- bulk_tag_leads: add/remove tags from multiple leads
-- ============================================================
CREATE OR REPLACE FUNCTION public.bulk_tag_leads(
  p_lead_ids UUID[],
  p_add_tag_ids UUID[] DEFAULT '{}',
  p_remove_tag_ids UUID[] DEFAULT '{}'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id UUID;
  v_lead_id UUID;
  v_tag_id UUID;
BEGIN
  -- Get caller's org
  SELECT tm.organization_id INTO v_org_id
  FROM public.team_members tm
  WHERE tm.user_id = auth.uid() AND tm.is_active = true
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No active organization membership';
  END IF;

  -- Remove tags
  IF array_length(p_remove_tag_ids, 1) > 0 THEN
    DELETE FROM public.lead_tags lt
    WHERE lt.lead_id = ANY(p_lead_ids)
      AND lt.tag_id = ANY(p_remove_tag_ids)
      AND lt.lead_id IN (
        SELECT l.id FROM public.leads l
        WHERE l.organization_id = v_org_id AND l.deleted_at IS NULL
      );
  END IF;

  -- Add tags (skip duplicates)
  IF array_length(p_add_tag_ids, 1) > 0 THEN
    FOREACH v_lead_id IN ARRAY p_lead_ids LOOP
      -- Verify lead belongs to org
      IF NOT EXISTS (
        SELECT 1 FROM public.leads l
        WHERE l.id = v_lead_id
          AND l.organization_id = v_org_id
          AND l.deleted_at IS NULL
      ) THEN
        CONTINUE;
      END IF;

      FOREACH v_tag_id IN ARRAY p_add_tag_ids LOOP
        INSERT INTO public.lead_tags (lead_id, tag_id)
        VALUES (v_lead_id, v_tag_id)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END LOOP;
  END IF;
END;
$$;
