-- ============================================================================
-- Connect pipe_distribution_rules to backend via trigger + Edge Function
--
-- Problem: pipe_distribution_rules/pipe_distribution_members store config
-- that no backend ever consumed. This migration:
--  1. Creates trigger function that calls process-pipe-distribution Edge Function
--  2. Adds AFTER INSERT triggers on all 3 pipe tables
--  3. Inserts cron_config entry for the Edge Function URL
--  4. Fixes pipe_distribution_members role values (sdr/closer → member)
--  5. Updates get_next_pipe_sdr RPC to use least-loaded algorithm
--  6. Deactivates duplicate team_members per user+org
-- ============================================================================

-- ─── 1. Trigger function: call process-pipe-distribution via pg_net ─────────

CREATE OR REPLACE FUNCTION public.trigger_pipe_distribution()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pipe_type TEXT;
  v_distribution_url TEXT;
  v_secret_val TEXT;
  v_has_rule BOOLEAN;
BEGIN
  -- Only fire on INSERT (new lead entering the pipe)
  IF TG_OP != 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_pipe_type := TG_ARGV[0];

  -- Quick check: does this org+pipe have a distribution rule with active mode?
  SELECT EXISTS (
    SELECT 1 FROM public.pipe_distribution_rules
    WHERE organization_id = NEW.organization_id
      AND pipe_type = v_pipe_type
      AND sdr_mode IS NOT NULL
  ) INTO v_has_rule;

  IF NOT v_has_rule THEN
    RETURN NEW;
  END IF;

  -- Skip if responsible_id already assigned (e.g. by campaign import)
  IF NEW.responsible_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Derive Edge Function URL from existing campaign dispatch URL
  BEGIN
    SELECT
      replace(value, 'campaign-rule-dispatch', 'process-pipe-distribution')
    INTO v_distribution_url
    FROM public.cron_config
    WHERE key = 'campaign_rule_dispatch_url';

    SELECT value INTO v_secret_val
    FROM public.cron_config
    WHERE key = 'cron_secret';

    IF v_distribution_url IS NOT NULL AND v_distribution_url != '' THEN
      PERFORM net.http_post(
        url := v_distribution_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', COALESCE(v_secret_val, '')
        ),
        body := jsonb_build_object(
          'organizationId', NEW.organization_id::text,
          'leadId', NEW.lead_id::text,
          'pipeRecordId', NEW.id::text,
          'pipeType', v_pipe_type
        ),
        timeout_milliseconds := 15000
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- pg_net not available or HTTP call failed — silently ignore
    NULL;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trigger_pipe_distribution()
  IS 'Calls process-pipe-distribution Edge Function via pg_net when a lead enters a pipe, if pipe_distribution_rules is configured.';

-- ─── 2. Create triggers on all 3 pipe tables ───────────────────────────────

DROP TRIGGER IF EXISTS trg_pipe_distribution_whatsapp ON public.pipe_whatsapp;
CREATE TRIGGER trg_pipe_distribution_whatsapp
  AFTER INSERT ON public.pipe_whatsapp
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_pipe_distribution('whatsapp');

DROP TRIGGER IF EXISTS trg_pipe_distribution_confirmacao ON public.pipe_confirmacao;
CREATE TRIGGER trg_pipe_distribution_confirmacao
  AFTER INSERT ON public.pipe_confirmacao
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_pipe_distribution('confirmacao');

DROP TRIGGER IF EXISTS trg_pipe_distribution_propostas ON public.pipe_propostas;
CREATE TRIGGER trg_pipe_distribution_propostas
  AFTER INSERT ON public.pipe_propostas
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_pipe_distribution('propostas');

-- ─── 3. Fix pipe_distribution_members: role sdr/closer → member ─────────────

-- The old role values no longer correspond to actual team member roles.
-- After the responsible_id unification, the pool is unified.
-- We add 'member' to the CHECK constraint and migrate existing rows.

ALTER TABLE public.pipe_distribution_members
  DROP CONSTRAINT IF EXISTS pipe_distribution_members_role_check;

ALTER TABLE public.pipe_distribution_members
  ADD CONSTRAINT pipe_distribution_members_role_check
  CHECK (role IN ('sdr', 'closer', 'member'));

UPDATE public.pipe_distribution_members
SET role = 'member'
WHERE role IN ('sdr', 'closer');

-- ─── 4. Update get_next_pipe_sdr to use least-loaded algorithm ──────────────

CREATE OR REPLACE FUNCTION public.get_next_pipe_sdr(
  p_pipe_type TEXT,
  p_organization_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_rule_id UUID;
  v_mode TEXT;
  v_assigned_to UUID;
  v_member_ids UUID[];
  v_chosen UUID;
  v_min_count BIGINT := 2147483647; -- max int
  v_cur_count BIGINT;
  v_mid UUID;
BEGIN
  SELECT id, sdr_mode, sdr_assigned_to
    INTO v_rule_id, v_mode, v_assigned_to
  FROM pipe_distribution_rules
  WHERE organization_id = p_organization_id
    AND pipe_type = p_pipe_type
  LIMIT 1;

  IF v_rule_id IS NULL OR v_mode IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_mode = 'single' AND v_assigned_to IS NOT NULL THEN
    RETURN v_assigned_to;
  END IF;

  -- Unified pool: ignore role column, just get all members for this rule
  SELECT ARRAY_AGG(pdm.team_member_id ORDER BY pdm.created_at, pdm.team_member_id)
    INTO v_member_ids
  FROM pipe_distribution_members pdm
  WHERE pdm.rule_id = v_rule_id;

  IF v_member_ids IS NULL OR array_length(v_member_ids, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_mode = 'random' THEN
    RETURN v_member_ids[1 + floor(random() * array_length(v_member_ids, 1))::int];
  END IF;

  IF v_mode = 'round_robin' THEN
    -- Least-loaded: pick member with fewest active leads
    FOREACH v_mid IN ARRAY v_member_ids LOOP
      IF p_pipe_type = 'whatsapp' THEN
        SELECT count(*) INTO v_cur_count FROM pipe_whatsapp
        WHERE organization_id = p_organization_id
          AND responsible_id = v_mid
          AND status NOT IN ('vendido', 'perdido', 'cancelado');
      ELSIF p_pipe_type = 'confirmacao' THEN
        SELECT count(*) INTO v_cur_count FROM pipe_confirmacao
        WHERE organization_id = p_organization_id
          AND responsible_id = v_mid
          AND status NOT IN ('vendido', 'perdido', 'cancelado');
      ELSIF p_pipe_type = 'propostas' THEN
        SELECT count(*) INTO v_cur_count FROM pipe_propostas
        WHERE organization_id = p_organization_id
          AND responsible_id = v_mid
          AND status NOT IN ('vendido', 'perdido', 'cancelado');
      ELSE
        v_cur_count := 0;
      END IF;

      IF v_cur_count < v_min_count THEN
        v_min_count := v_cur_count;
        v_chosen := v_mid;
      END IF;
    END LOOP;
    RETURN v_chosen;
  END IF;

  RETURN NULL;
END;
$$;

-- ─── 5. Deactivate duplicate team_members (keep most recent per user+org) ───

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, organization_id
           ORDER BY created_at DESC
         ) AS rn
  FROM public.team_members
  WHERE is_active = true
    AND user_id IS NOT NULL
)
UPDATE public.team_members
SET is_active = false
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
