-- =====================================================
-- Consolidate workflow RPC overloads
-- =====================================================
--
-- Root cause: migration churn produced two coexisting overloads of two
-- critical RPCs, and the simpler 1-arg / 4-arg versions silently regressed
-- the hardening fixes (race-safety, per-org cap, chain-depth guard).
--
-- Timeline of `claim_workflow_executions`:
--   20260426000004 (hardening)        — (int,int) with per_org_cap + race-fix
--   20260426000005 (drop legacy)      — DROP (integer) 1-arg
--   20260427000000 (race fix refine)  — refines (int,int) predicate replication
--   20260802000000 (executor infra)   — RECREATES (int) 1-arg simple
--   20260803000000 (timeouts/dedup)   — re-stomps (int) 1-arg
--   20260901100000 (wait_response)    — re-stomps (int) 1-arg with waiting_response
--                                       BUT lost per_org_cap + race-fix predicate
--
-- PostgREST resolves `.rpc("claim_workflow_executions", { batch_size: 20 })`
-- to the 1-arg version (more specific match), so prod has been hitting the
-- regressed RPC — losing per-org fairness and race-safety.
--
-- Timeline of `fire_workflow_trigger`:
--   20260426000004 (hardening)   — (uuid,text,uuid,jsonb,uuid) with chain_depth guard
--   20260426000005 (drop legacy) — DROP (uuid,text,uuid,jsonb) 4-arg
--   20260818000000 (executor fix)— RECREATES (uuid,text,uuid,jsonb) 4-arg WITHOUT chain_depth
--
-- PG triggers that fire from row events still call the 4-arg version → loop
-- guard bypassed.
--
-- Fix: drop ALL overloads, recreate ONE canonical version per RPC. Defaults
-- preserve backward-compatible call signatures (callers passing fewer args
-- still work).
-- =====================================================

-- ─── 1. claim_workflow_executions ───────────────────────────────────────────

DROP FUNCTION IF EXISTS public.claim_workflow_executions(int);
DROP FUNCTION IF EXISTS public.claim_workflow_executions(int, int);

CREATE OR REPLACE FUNCTION public.claim_workflow_executions(
  batch_size int DEFAULT 20,
  per_org_cap int DEFAULT 5
)
RETURNS SETOF public.workflow_executions
LANGUAGE sql
AS $$
  WITH eligible AS (
    SELECT id, organization_id, started_at,
           ROW_NUMBER() OVER (PARTITION BY organization_id ORDER BY started_at ASC) AS rn_org
    FROM public.workflow_executions
    WHERE
      (status = 'running' AND (next_run_at IS NULL OR next_run_at <= NOW()))
      OR (status = 'processing' AND updated_at < NOW() - INTERVAL '10 minutes')
      OR (status = 'waiting_response' AND next_run_at IS NOT NULL AND next_run_at <= NOW())
  ),
  capped AS (
    SELECT id FROM eligible WHERE rn_org <= per_org_cap
  ),
  picked AS (
    SELECT we.id
    FROM public.workflow_executions we
    WHERE we.id IN (SELECT id FROM capped)
    ORDER BY we.started_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.workflow_executions w
  SET
    status = 'processing',
    updated_at = NOW(),
    context = CASE
      WHEN w.status = 'waiting_response' AND w.next_run_at <= NOW()
        THEN COALESCE(w.context, '{}'::jsonb) || '{"_wait_resolved":"timeout"}'::jsonb
      ELSE w.context
    END
  WHERE w.id IN (SELECT id FROM picked)
    AND (
      (w.status = 'running' AND (w.next_run_at IS NULL OR w.next_run_at <= NOW()))
      OR (w.status = 'processing' AND w.updated_at < NOW() - INTERVAL '10 minutes')
      OR (w.status = 'waiting_response' AND w.next_run_at IS NOT NULL AND w.next_run_at <= NOW())
    )
  RETURNING w.*;
$$;

COMMENT ON FUNCTION public.claim_workflow_executions(int, int) IS
  'Canonical claim RPC: per_org_cap fairness + race-safe predicate replication '
  'in UPDATE WHERE (prevents double-claim under READ COMMITTED) + waiting_response '
  'timeout reclaim. Consolidated 2026-05-12.';

-- ─── 2. fire_workflow_trigger ───────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.fire_workflow_trigger(uuid, text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.fire_workflow_trigger(uuid, text, uuid, jsonb, uuid);

CREATE OR REPLACE FUNCTION public.fire_workflow_trigger(
  p_organization_id uuid,
  p_trigger_type text,
  p_lead_id uuid,
  p_context jsonb DEFAULT '{}'::jsonb,
  p_triggered_by_execution_id uuid DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workflow record;
  v_count int := 0;
  v_parent_depth smallint := 0;
  v_new_depth smallint;
  MAX_CHAIN_DEPTH constant smallint := 5;
BEGIN
  -- Chain depth guard (Onda 1 / T1.2.2 hardening)
  IF p_triggered_by_execution_id IS NOT NULL THEN
    SELECT chain_depth INTO v_parent_depth
    FROM public.workflow_executions
    WHERE id = p_triggered_by_execution_id;
    v_parent_depth := COALESCE(v_parent_depth, 0);
  END IF;

  v_new_depth := v_parent_depth + 1;

  IF v_new_depth > MAX_CHAIN_DEPTH THEN
    RAISE NOTICE 'fire_workflow_trigger blocked: chain_depth % > %',
      v_new_depth, MAX_CHAIN_DEPTH;
    RETURN 0;
  END IF;

  FOR v_workflow IN
    SELECT id, trigger_config
    FROM public.workflows
    WHERE organization_id = p_organization_id
      AND trigger_type = p_trigger_type
      AND is_active = true
  LOOP
    -- Include trigger_config in context so executor can validate match (20260818 behavior)
    INSERT INTO public.workflow_executions (
      workflow_id, organization_id, lead_id, status, context,
      triggered_by_execution_id, chain_depth
    ) VALUES (
      v_workflow.id, p_organization_id, p_lead_id, 'running',
      p_context || jsonb_build_object(
        'trigger_type', p_trigger_type,
        'trigger_config', v_workflow.trigger_config
      ),
      p_triggered_by_execution_id, v_new_depth
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.fire_workflow_trigger(uuid, text, uuid, jsonb, uuid) IS
  'Canonical trigger RPC: chain_depth guard (max 5) + trigger_config in context. '
  'p_triggered_by_execution_id defaults NULL for retrocompat with PG triggers '
  'that call with 4 args. Consolidated 2026-05-12.';

-- ─── 3. Verification — fail migration if any overload duplication remains ───

DO $verify$
DECLARE
  v_dup_count int;
  v_dup_names text;
BEGIN
  SELECT count(*), string_agg(proname, ', ') INTO v_dup_count, v_dup_names
  FROM (
    SELECT proname
    FROM pg_proc
    WHERE proname IN ('claim_workflow_executions', 'fire_workflow_trigger')
      AND pronamespace = 'public'::regnamespace
    GROUP BY proname
    HAVING count(*) > 1
  ) dups;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION 'Consolidation failed: % duplicate overload(s) still exist: %',
      v_dup_count, v_dup_names;
  END IF;
END
$verify$;
