-- ============================================================================
-- Unified Round-Robin Distribution with Advisory Locks
--
-- Replaces 7 inconsistent distribution entry points with 2 core atomic
-- functions protected by pg_advisory_xact_lock, then rewrites the 3 existing
-- RPCs (get_next_campaign_sdr, get_next_campaign_closer, get_next_pipe_sdr)
-- to delegate to them.
--
-- Key changes vs. previous versions:
--   1. Advisory locks prevent concurrent requests from picking the same member
--   2. Campaign distribution counts by responsible_id (not sdr_id / closer_id)
--   3. Member pools are unified — no role filter (all campanha_members qualify)
--   4. Functions are VOLATILE (required for advisory lock side-effects)
--
-- Date: 2026-08-25
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. Core: distribute_campaign_round_robin
--    Atomic least-loaded pick for a single campaign, serialized by advisory lock.
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
  v_chosen UUID;
BEGIN
  -- Serialize all concurrent callers for the same campaign.
  -- The lock is released automatically at transaction end.
  PERFORM pg_advisory_xact_lock(hashtext('camp_dist:' || p_campaign_id::text));

  -- Pick the member with the fewest leads assigned (by responsible_id).
  -- LEFT JOIN ensures members with zero leads still appear with count = 0.
  -- Tiebreak by member UUID ascending for determinism.
  SELECT m.id INTO v_chosen
  FROM unnest(p_member_ids) AS m(id)
  LEFT JOIN public.campanha_leads cl
    ON cl.campanha_id = p_campaign_id
   AND cl.responsible_id = m.id
  GROUP BY m.id
  ORDER BY count(cl.id) ASC, m.id ASC
  LIMIT 1;

  RETURN v_chosen;
END;
$$;

COMMENT ON FUNCTION public.distribute_campaign_round_robin(UUID, UUID[]) IS
  'Atomic least-loaded round-robin for campaigns. Counts responsible_id in campanha_leads, serialized by advisory lock.';


-- ────────────────────────────────────────────────────────────────────────────
-- 2. Core: distribute_pipe_round_robin
--    Atomic least-loaded pick for a pipe table, serialized by advisory lock.
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
  v_chosen    UUID;
  v_min_count BIGINT := 2147483647;
  v_cur_count BIGINT;
  v_mid       UUID;
BEGIN
  -- Serialize all concurrent callers for the same pipe + org.
  PERFORM pg_advisory_xact_lock(
    hashtext('pipe_dist:' || p_pipe_type || ':' || p_organization_id::text)
  );

  -- We must use a FOREACH loop because the target table is dynamic
  -- (pipe_whatsapp, pipe_confirmacao, pipe_propostas).
  FOREACH v_mid IN ARRAY p_member_ids LOOP
    IF p_pipe_type = 'whatsapp' THEN
      SELECT count(*) INTO v_cur_count
      FROM public.pipe_whatsapp
      WHERE organization_id = p_organization_id
        AND responsible_id = v_mid
        AND status NOT IN ('vendido', 'perdido', 'cancelado');

    ELSIF p_pipe_type = 'confirmacao' THEN
      SELECT count(*) INTO v_cur_count
      FROM public.pipe_confirmacao
      WHERE organization_id = p_organization_id
        AND responsible_id = v_mid
        AND status NOT IN ('vendido', 'perdido', 'cancelado');

    ELSIF p_pipe_type = 'propostas' THEN
      SELECT count(*) INTO v_cur_count
      FROM public.pipe_propostas
      WHERE organization_id = p_organization_id
        AND responsible_id = v_mid
        AND status NOT IN ('vendido', 'perdido', 'cancelado');

    ELSE
      RAISE EXCEPTION 'Unknown pipe type: %. Expected whatsapp, confirmacao, or propostas.', p_pipe_type;
    END IF;

    -- Tiebreak: first member in array wins (array is pre-sorted),
    -- so we use strict less-than.
    IF v_cur_count < v_min_count THEN
      v_min_count := v_cur_count;
      v_chosen    := v_mid;
    END IF;
  END LOOP;

  RETURN v_chosen;
END;
$$;

COMMENT ON FUNCTION public.distribute_pipe_round_robin(TEXT, UUID, UUID[]) IS
  'Atomic least-loaded round-robin for pipes. Counts active leads by responsible_id, serialized by advisory lock.';


-- ────────────────────────────────────────────────────────────────────────────
-- 3. RPC rewrite: get_next_campaign_sdr
--    Now uses unified pool (all campanha_members, no role filter) and
--    delegates round_robin to distribute_campaign_round_robin.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_next_campaign_sdr(p_campaign_id UUID)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_mode        TEXT;
  v_assigned_to UUID;
  v_member_ids  UUID[];
BEGIN
  -- Read campaign distribution settings
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

  -- Unified pool: ALL campanha_members, no role filter
  SELECT ARRAY_AGG(cm.team_member_id ORDER BY cm.created_at, cm.team_member_id)
    INTO v_member_ids
  FROM public.campanha_members cm
  WHERE cm.campanha_id = p_campaign_id;

  IF v_member_ids IS NULL OR array_length(v_member_ids, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_mode = 'random' THEN
    RETURN v_member_ids[1 + floor(random() * array_length(v_member_ids, 1))::int];
  END IF;

  IF v_mode = 'round_robin' THEN
    RETURN public.distribute_campaign_round_robin(p_campaign_id, v_member_ids);
  END IF;

  RETURN NULL;
END;
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. RPC rewrite: get_next_campaign_closer
--    Same unified pool approach, reads closer_distribution_mode.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_next_campaign_closer(p_campaign_id UUID)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_mode        TEXT;
  v_assigned_to UUID;
  v_member_ids  UUID[];
BEGIN
  -- Read campaign closer distribution settings
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

  -- Unified pool: ALL campanha_members, no role filter
  SELECT ARRAY_AGG(cm.team_member_id ORDER BY cm.created_at, cm.team_member_id)
    INTO v_member_ids
  FROM public.campanha_members cm
  WHERE cm.campanha_id = p_campaign_id;

  IF v_member_ids IS NULL OR array_length(v_member_ids, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_mode = 'random' THEN
    RETURN v_member_ids[1 + floor(random() * array_length(v_member_ids, 1))::int];
  END IF;

  IF v_mode = 'round_robin' THEN
    RETURN public.distribute_campaign_round_robin(p_campaign_id, v_member_ids);
  END IF;

  RETURN NULL;
END;
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. RPC rewrite: get_next_pipe_sdr
--    Now delegates round_robin to distribute_pipe_round_robin.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_next_pipe_sdr(
  p_pipe_type       TEXT,
  p_organization_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_rule_id     UUID;
  v_mode        TEXT;
  v_assigned_to UUID;
  v_member_ids  UUID[];
BEGIN
  SELECT id, sdr_mode, sdr_assigned_to
    INTO v_rule_id, v_mode, v_assigned_to
  FROM public.pipe_distribution_rules
  WHERE organization_id = p_organization_id
    AND pipe_type = p_pipe_type
  LIMIT 1;

  IF v_rule_id IS NULL OR v_mode IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_mode = 'single' AND v_assigned_to IS NOT NULL THEN
    RETURN v_assigned_to;
  END IF;

  -- Unified pool: all members for this rule, no role filter
  SELECT ARRAY_AGG(pdm.team_member_id ORDER BY pdm.created_at, pdm.team_member_id)
    INTO v_member_ids
  FROM public.pipe_distribution_members pdm
  WHERE pdm.rule_id = v_rule_id;

  IF v_member_ids IS NULL OR array_length(v_member_ids, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_mode = 'random' THEN
    RETURN v_member_ids[1 + floor(random() * array_length(v_member_ids, 1))::int];
  END IF;

  IF v_mode = 'round_robin' THEN
    RETURN public.distribute_pipe_round_robin(p_pipe_type, p_organization_id, v_member_ids);
  END IF;

  RETURN NULL;
END;
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- 6. Validation: assert both core functions exist
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

  RAISE NOTICE 'VALIDATION PASSED: both core distribution functions exist.';
END;
$$;
