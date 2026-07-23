-- ============================================================================
-- Fix Round-Robin: sequential rotation by last assignment order
--
-- Previous implementation used "least-loaded" (member with fewest leads).
-- Correct behavior: true sequential round-robin — find who was last assigned,
-- pick the NEXT member in the ordered array, wrapping around.
--
-- Date: 2026-08-26
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. Core: distribute_campaign_round_robin
--    True sequential round-robin for campaigns.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.distribute_campaign_round_robin(
  p_campaign_id UUID,
  p_member_ids  UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_last_assigned UUID;
  v_last_idx      INT;
  v_arr_len       INT;
BEGIN
  -- Serialize concurrent callers for the same campaign.
  PERFORM pg_advisory_xact_lock(hashtext('camp_dist:' || p_campaign_id::text));

  v_arr_len := array_length(p_member_ids, 1);
  IF v_arr_len IS NULL OR v_arr_len = 0 THEN
    RETURN NULL;
  END IF;

  -- Find who was last assigned in this campaign (most recent campanha_leads).
  SELECT cl.responsible_id INTO v_last_assigned
  FROM public.campanha_leads cl
  WHERE cl.campanha_id = p_campaign_id
    AND cl.responsible_id = ANY(p_member_ids)
  ORDER BY cl.created_at DESC
  LIMIT 1;

  -- No previous assignment → pick first member.
  IF v_last_assigned IS NULL THEN
    RETURN p_member_ids[1];
  END IF;

  -- Find position of last assigned member in the array.
  v_last_idx := NULL;
  FOR i IN 1..v_arr_len LOOP
    IF p_member_ids[i] = v_last_assigned THEN
      v_last_idx := i;
      EXIT;
    END IF;
  END LOOP;

  -- If last assigned member is no longer in the pool, start from first.
  IF v_last_idx IS NULL THEN
    RETURN p_member_ids[1];
  END IF;

  -- Next in rotation (wrap around to 1 if at end).
  IF v_last_idx >= v_arr_len THEN
    RETURN p_member_ids[1];
  ELSE
    RETURN p_member_ids[v_last_idx + 1];
  END IF;
END;
$$;

COMMENT ON FUNCTION public.distribute_campaign_round_robin(UUID, UUID[]) IS
  'Sequential round-robin for campaigns. Finds last assigned member and picks the next in rotation order. Serialized by advisory lock.';


-- ────────────────────────────────────────────────────────────────────────────
-- 2. Core: distribute_pipe_round_robin
--    True sequential round-robin for pipes.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.distribute_pipe_round_robin(
  p_pipe_type       TEXT,
  p_organization_id UUID,
  p_member_ids      UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_last_assigned UUID;
  v_last_idx      INT;
  v_arr_len       INT;
BEGIN
  -- Serialize concurrent callers for the same pipe + org.
  PERFORM pg_advisory_xact_lock(
    hashtext('pipe_dist:' || p_pipe_type || ':' || p_organization_id::text)
  );

  v_arr_len := array_length(p_member_ids, 1);
  IF v_arr_len IS NULL OR v_arr_len = 0 THEN
    RETURN NULL;
  END IF;

  -- Find who was last assigned in this pipe (most recent record by created_at).
  IF p_pipe_type = 'whatsapp' THEN
    SELECT pw.responsible_id INTO v_last_assigned
    FROM public.pipe_whatsapp pw
    WHERE pw.organization_id = p_organization_id
      AND pw.responsible_id = ANY(p_member_ids)
    ORDER BY pw.created_at DESC
    LIMIT 1;

  ELSIF p_pipe_type = 'confirmacao' THEN
    SELECT pc.responsible_id INTO v_last_assigned
    FROM public.pipe_confirmacao pc
    WHERE pc.organization_id = p_organization_id
      AND pc.responsible_id = ANY(p_member_ids)
    ORDER BY pc.created_at DESC
    LIMIT 1;

  ELSIF p_pipe_type = 'propostas' THEN
    SELECT pp.responsible_id INTO v_last_assigned
    FROM public.pipe_propostas pp
    WHERE pp.organization_id = p_organization_id
      AND pp.responsible_id = ANY(p_member_ids)
    ORDER BY pp.created_at DESC
    LIMIT 1;

  ELSE
    RAISE EXCEPTION 'Unknown pipe type: %. Expected whatsapp, confirmacao, or propostas.', p_pipe_type;
  END IF;

  -- No previous assignment → pick first member.
  IF v_last_assigned IS NULL THEN
    RETURN p_member_ids[1];
  END IF;

  -- Find position of last assigned member in the array.
  v_last_idx := NULL;
  FOR i IN 1..v_arr_len LOOP
    IF p_member_ids[i] = v_last_assigned THEN
      v_last_idx := i;
      EXIT;
    END IF;
  END LOOP;

  -- If last assigned member is no longer in the pool, start from first.
  IF v_last_idx IS NULL THEN
    RETURN p_member_ids[1];
  END IF;

  -- Next in rotation (wrap around to 1 if at end).
  IF v_last_idx >= v_arr_len THEN
    RETURN p_member_ids[1];
  ELSE
    RETURN p_member_ids[v_last_idx + 1];
  END IF;
END;
$$;

COMMENT ON FUNCTION public.distribute_pipe_round_robin(TEXT, UUID, UUID[]) IS
  'Sequential round-robin for pipes. Finds last assigned member and picks the next in rotation order. Serialized by advisory lock.';


-- ────────────────────────────────────────────────────────────────────────────
-- 3. Validation
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'distribute_campaign_round_robin'
  ) THEN
    RAISE EXCEPTION 'VALIDATION FAILED: distribute_campaign_round_robin does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'distribute_pipe_round_robin'
  ) THEN
    RAISE EXCEPTION 'VALIDATION FAILED: distribute_pipe_round_robin does not exist';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: both round-robin functions updated to sequential rotation.';
END;
$$;
