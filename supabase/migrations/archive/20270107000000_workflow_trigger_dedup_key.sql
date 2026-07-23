-- Atomic dedup for workflow triggers (stage_changed and others).
--
-- Root cause (incident 2026-07-03, Motor 100; earlier Bertin 2026-05-22):
-- fireTrigger() does a check-then-insert — it reads active executions, then
-- inserts a new one. When N near-simultaneous stage_changed events fire for the
-- same lead (a user re-dropping a lead into a "disparo" column, or the workflow's
-- own stage moves), each fireTrigger call reads "no active execution" before any
-- of them inserts → N executions are created → the full flow (text + audio +
-- image) is re-dispatched N times. Leads were blasted 7-12x.
--
-- The dormant workflow-trigger-dedup.ts computed a deterministic dedup key for
-- exactly this, but was never wired and this column never existed. This makes the
-- dedup ATOMIC: fireTrigger now stamps trigger_dedup_key and inserts with
-- ON CONFLICT DO NOTHING against the partial unique index below, so only the first
-- of N racing triggers wins.
--
-- Complements the application-level "skip if an execution is already in-flight"
-- guard (workflow-trigger.ts): that covers long-lived executions (wait_response
-- can stay active 72-120h, past any dedup window); this index closes the
-- check-then-insert race window that the application guard cannot.

ALTER TABLE public.workflow_executions
  ADD COLUMN IF NOT EXISTS trigger_dedup_key text;

COMMENT ON COLUMN public.workflow_executions.trigger_dedup_key IS
  'Deterministic key (triggerType:payloadHash:windowBucket) for atomic trigger '
  'dedup. NULL for executions created outside fireTrigger (retries, manual, '
  'scheduled_date). See workflow-trigger-dedup.ts.';

-- Non-partial unique index so PostgREST reliably infers it for ON CONFLICT.
-- Correctness relies on Postgres default NULLS DISTINCT: executions created
-- outside fireTrigger carry trigger_dedup_key = NULL and therefore NEVER collide
-- with each other (each NULL is distinct), while two racing fireTrigger inserts
-- that computed the SAME key for the same (workflow_id, lead_id) collide → the
-- second is dropped by ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_exec_trigger_dedup
  ON public.workflow_executions (workflow_id, lead_id, trigger_dedup_key);

-- ── PG path: fire_workflow_trigger ──────────────────────────────────────────
-- The SECOND execution-creation path (custom pipelines call this PG function
-- directly; system pipes hop through the edge fireTrigger, patched separately).
-- Same check-then-loop-insert race. Stamp the same-shaped dedup key and add
-- ON CONFLICT DO NOTHING so concurrent identical fires collapse atomically.
--
-- Key shape mirrors workflow-trigger-dedup.ts semantics
-- (`triggerType:payloadHash16:windowBucket`) but uses md5 over the canonical
-- jsonb text (pgcrypto-free). The two paths never create executions for the same
-- (lead, transition) at once, so cross-path hash-format parity is unnecessary —
-- each path only needs to collapse its OWN racing fires.
CREATE OR REPLACE FUNCTION public.fire_workflow_trigger(
  p_organization_id uuid,
  p_trigger_type text,
  p_lead_id uuid,
  p_context jsonb DEFAULT '{}'::jsonb,
  p_triggered_by_execution_id uuid DEFAULT NULL::uuid
)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_workflow RECORD;
  v_count INT := 0;
  v_parent_depth SMALLINT := 0;
  v_new_depth SMALLINT;
  v_window INT;
  v_dedup_key TEXT;
  v_inserted uuid;
  MAX_CHAIN_DEPTH CONSTANT SMALLINT := 5;
BEGIN
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

  -- 300s dedup window for stage_changed (re-dispatching the same lead within
  -- 5min is never intended); 60s for everything else.
  v_window := CASE WHEN p_trigger_type = 'stage_changed' THEN 300 ELSE 60 END;
  v_dedup_key := p_trigger_type
    || ':' || substr(md5(COALESCE(p_context, '{}'::jsonb)::text), 1, 16)
    || ':' || floor(extract(epoch FROM now()) / v_window)::text;

  FOR v_workflow IN
    SELECT id, trigger_config
    FROM public.workflows
    WHERE organization_id = p_organization_id
      AND trigger_type = p_trigger_type
      AND is_active = true
  LOOP
    IF NOT matches_workflow_trigger_config(p_trigger_type, v_workflow.trigger_config, p_context) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.workflow_executions (
      workflow_id, organization_id, lead_id, status, context,
      triggered_by_execution_id, chain_depth, trigger_dedup_key
    ) VALUES (
      v_workflow.id, p_organization_id, p_lead_id, 'running',
      p_context || jsonb_build_object(
        'trigger_type', p_trigger_type,
        'trigger_config', v_workflow.trigger_config
      ),
      p_triggered_by_execution_id, v_new_depth, v_dedup_key
    )
    ON CONFLICT (workflow_id, lead_id, trigger_dedup_key) DO NOTHING
    RETURNING id INTO v_inserted;

    IF v_inserted IS NOT NULL THEN
      v_count := v_count + 1;
      v_inserted := NULL;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;
