-- RPC: get_next_campaign_sdr(p_campaign_id)
-- Returns the team_member_id (UUID) to assign to the next lead in the campaign,
-- following the campaign's lead_distribution_mode (round_robin, random, single).
-- Used by the front when adding a lead with "Distribuir automaticamente".
-- Logic mirrors supabase/functions/_shared/campaign-distribution.ts

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
  v_count BIGINT;
  v_next_index INT;
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

  -- For random and round_robin we need campanha_members (ordered for stable round_robin)
  SELECT ARRAY_AGG(cm.team_member_id ORDER BY cm.created_at, cm.team_member_id)
    INTO v_member_ids
  FROM public.campanha_members cm
  WHERE cm.campanha_id = p_campaign_id;

  IF v_member_ids IS NULL OR array_length(v_member_ids, 1) IS NULL OR array_length(v_member_ids, 1) = 0 THEN
    RETURN NULL;
  END IF;

  IF v_mode = 'random' THEN
    RETURN v_member_ids[1 + floor(random() * array_length(v_member_ids, 1))::int];
  END IF;

  IF v_mode = 'round_robin' THEN
    SELECT count(*) INTO v_count
    FROM public.campanha_leads cl
    WHERE cl.campanha_id = p_campaign_id;
    v_next_index := (COALESCE(v_count, 0) % array_length(v_member_ids, 1)) + 1;
    RETURN v_member_ids[v_next_index];
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.get_next_campaign_sdr(UUID) IS
  'Returns team_member_id to assign to the next lead in the campaign (round_robin, random, or single). Used by front when adding lead with auto-distribute.';
