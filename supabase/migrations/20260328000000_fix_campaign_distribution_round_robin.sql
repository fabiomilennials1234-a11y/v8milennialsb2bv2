-- Fix: Replace count-based modulo round_robin with "least loaded" algorithm.
-- The old approach assigned all concurrent leads to the same SDR/Closer
-- because they all saw the same count. "Least loaded" is self-correcting.
-- Date: 2026-03-28

-- ============================================
-- 1. Fix get_next_campaign_sdr
-- ============================================

CREATE OR REPLACE FUNCTION public.get_next_campaign_sdr(p_campaign_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_mode TEXT;
  v_assigned_to UUID;
  v_member_ids UUID[];
  v_chosen UUID;
BEGIN
  -- Get campaign distribution settings
  SELECT c.lead_distribution_mode, c.lead_assigned_to
    INTO v_mode, v_assigned_to
  FROM public.campanhas c
  WHERE c.id = p_campaign_id
  LIMIT 1;

  IF v_mode IS NULL THEN
    RETURN v_assigned_to;
  END IF;

  IF v_mode = 'single' AND v_assigned_to IS NOT NULL THEN
    RETURN v_assigned_to;
  END IF;

  -- For random and round_robin: use campanha_members WHERE role = 'sdr'
  SELECT ARRAY_AGG(cm.team_member_id ORDER BY cm.created_at, cm.team_member_id)
    INTO v_member_ids
  FROM public.campanha_members cm
  WHERE cm.campanha_id = p_campaign_id
    AND cm.role = 'sdr';

  IF v_member_ids IS NULL OR array_length(v_member_ids, 1) IS NULL OR array_length(v_member_ids, 1) = 0 THEN
    RETURN NULL;
  END IF;

  IF v_mode = 'random' THEN
    RETURN v_member_ids[1 + floor(random() * array_length(v_member_ids, 1))::int];
  END IF;

  IF v_mode = 'round_robin' THEN
    -- "Least loaded": pick the SDR with fewest leads in this campaign
    SELECT m.id INTO v_chosen
    FROM unnest(v_member_ids) AS m(id)
    LEFT JOIN public.campanha_leads cl
      ON cl.campanha_id = p_campaign_id AND cl.sdr_id = m.id
    GROUP BY m.id
    ORDER BY count(cl.id) ASC, m.id ASC
    LIMIT 1;
    RETURN v_chosen;
  END IF;

  RETURN NULL;
END;
$$;

-- ============================================
-- 2. Fix get_next_campaign_closer
-- ============================================

CREATE OR REPLACE FUNCTION public.get_next_campaign_closer(p_campaign_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_mode TEXT;
  v_assigned_to UUID;
  v_member_ids UUID[];
  v_chosen UUID;
BEGIN
  -- Get campaign closer distribution settings
  SELECT c.closer_distribution_mode, c.closer_assigned_to
    INTO v_mode, v_assigned_to
  FROM public.campanhas c
  WHERE c.id = p_campaign_id
  LIMIT 1;

  IF v_mode IS NULL THEN
    RETURN v_assigned_to;
  END IF;

  IF v_mode = 'single' AND v_assigned_to IS NOT NULL THEN
    RETURN v_assigned_to;
  END IF;

  -- For random and round_robin: use campanha_members WHERE role = 'closer'
  SELECT ARRAY_AGG(cm.team_member_id ORDER BY cm.created_at, cm.team_member_id)
    INTO v_member_ids
  FROM public.campanha_members cm
  WHERE cm.campanha_id = p_campaign_id
    AND cm.role = 'closer';

  IF v_member_ids IS NULL OR array_length(v_member_ids, 1) IS NULL OR array_length(v_member_ids, 1) = 0 THEN
    RETURN NULL;
  END IF;

  IF v_mode = 'random' THEN
    RETURN v_member_ids[1 + floor(random() * array_length(v_member_ids, 1))::int];
  END IF;

  IF v_mode = 'round_robin' THEN
    -- "Least loaded": pick the Closer with fewest leads in this campaign
    SELECT m.id INTO v_chosen
    FROM unnest(v_member_ids) AS m(id)
    LEFT JOIN public.campanha_leads cl
      ON cl.campanha_id = p_campaign_id AND cl.closer_id = m.id
    GROUP BY m.id
    ORDER BY count(cl.id) ASC, m.id ASC
    LIMIT 1;
    RETURN v_chosen;
  END IF;

  RETURN NULL;
END;
$$;
