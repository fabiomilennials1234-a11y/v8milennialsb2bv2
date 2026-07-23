-- Onda 1 / P2 — Hardening: turn_count atomic, loop guard, per-org cap
--
-- Consolida:
--   T1.2.1 — RPC increment_conversation_turn (race em SELECT+UPDATE separado)
--   T1.2.2 — workflow_executions.{triggered_by_execution_id, chain_depth}
--            + fire_workflow_trigger com guard de profundidade
--   T1.2.3 — claim_workflow_executions com per-org cap (window function)
--   T1.2.4 — claim_pending_ai_actions com per-org cap (window function)

-- ─────────────────────────────────────────────────────────────────────────────
-- T1.2.1: RPC atomic increment_conversation_turn
-- ─────────────────────────────────────────────────────────────────────────────
-- Substitui SELECT turn_count + UPDATE em queries separadas (agent-engine.ts:2962-2981).
-- Race condition: 2 mensagens simultâneas leem turn_count=N, ambas escrevem N+1
-- (perde 1 incremento). Telemetria: drift residual em sample de conversa
-- (turn_count=31 vs esperado 26).

CREATE OR REPLACE FUNCTION public.increment_conversation_turn(
  p_conversation_id uuid,
  p_new_state text DEFAULT NULL
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.conversations
  SET turn_count = COALESCE(turn_count, 0) + 1,
      state = COALESCE(p_new_state, state),
      last_message_at = NOW(),
      updated_at = NOW()
  WHERE id = p_conversation_id;
$$;

REVOKE ALL ON FUNCTION public.increment_conversation_turn(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_conversation_turn(uuid, text) TO service_role;

COMMENT ON FUNCTION public.increment_conversation_turn(uuid, text) IS
  'Onda 1 T1.2.1: incremento atômico de turn_count + state opcional. '
  'Substitui SELECT+UPDATE separado em agent-engine updateConversationState.';

-- ─────────────────────────────────────────────────────────────────────────────
-- T1.2.2: trigger loop guard (chain_depth)
-- ─────────────────────────────────────────────────────────────────────────────
-- Hoje workflow A pode disparar B que dispara A indefinidamente.
-- loop_limit individual é por execução, não por chain. Adicionamos:
--   triggered_by_execution_id — referência ao parent
--   chain_depth — calculado +1 do parent
-- fire_workflow_trigger recusa se depth >= 5.

ALTER TABLE public.workflow_executions
  ADD COLUMN IF NOT EXISTS triggered_by_execution_id uuid
    REFERENCES public.workflow_executions(id) ON DELETE SET NULL;

ALTER TABLE public.workflow_executions
  ADD COLUMN IF NOT EXISTS chain_depth smallint NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_workflow_executions_triggered_by
  ON public.workflow_executions(triggered_by_execution_id)
  WHERE triggered_by_execution_id IS NOT NULL;

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
    INSERT INTO public.workflow_executions (
      workflow_id, organization_id, lead_id, status, context,
      triggered_by_execution_id, chain_depth
    ) VALUES (
      v_workflow.id, p_organization_id, p_lead_id, 'running',
      p_context || jsonb_build_object('trigger_type', p_trigger_type),
      p_triggered_by_execution_id, v_new_depth
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.fire_workflow_trigger(uuid, text, uuid, jsonb, uuid) IS
  'Onda 1 T1.2.2: aceita parent execution id + bloqueia chain_depth > 5.';

-- ─────────────────────────────────────────────────────────────────────────────
-- T1.2.3: claim_workflow_executions com per-org cap
-- ─────────────────────────────────────────────────────────────────────────────
-- Hoje org com 1000 jobs domina batch=20. Outras orgs esperam.
-- Per-org cap distribui via ROW_NUMBER() OVER (PARTITION BY organization_id).

CREATE OR REPLACE FUNCTION public.claim_workflow_executions(
  batch_size INT DEFAULT 20,
  per_org_cap INT DEFAULT 5
)
RETURNS SETOF public.workflow_executions
LANGUAGE sql AS $$
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
  UPDATE public.workflow_executions
  SET
    status = 'processing',
    updated_at = NOW(),
    context = CASE
      WHEN status = 'waiting_response' AND next_run_at <= NOW()
        THEN COALESCE(context, '{}'::jsonb) || '{"_wait_resolved":"timeout"}'::jsonb
      ELSE context
    END
  WHERE id IN (SELECT id FROM picked)
  RETURNING *;
$$;

COMMENT ON FUNCTION public.claim_workflow_executions(int, int) IS
  'Onda 1 T1.2.3: per-org cap previne uma org sozinha consumir batch inteiro.';

-- ─────────────────────────────────────────────────────────────────────────────
-- T1.2.4: claim_pending_ai_actions com per-org cap
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.claim_pending_ai_actions(
  batch_size INT DEFAULT 10,
  per_org_cap INT DEFAULT 3
)
RETURNS SETOF public.pending_ai_actions
LANGUAGE sql AS $$
  WITH eligible AS (
    SELECT id, organization_id, created_at,
           ROW_NUMBER() OVER (PARTITION BY organization_id ORDER BY created_at ASC) AS rn_org
    FROM public.pending_ai_actions
    WHERE (status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= NOW()))
       OR (status = 'processing' AND updated_at < NOW() - INTERVAL '10 minutes')
  ),
  capped AS (
    SELECT id FROM eligible WHERE rn_org <= per_org_cap
  ),
  picked AS (
    SELECT pa.id
    FROM public.pending_ai_actions pa
    WHERE pa.id IN (SELECT id FROM capped)
    ORDER BY pa.created_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.pending_ai_actions
  SET status = 'processing', updated_at = NOW()
  WHERE id IN (SELECT id FROM picked)
  RETURNING *;
$$;

COMMENT ON FUNCTION public.claim_pending_ai_actions(int, int) IS
  'Onda 1 T1.2.4: per-org cap (default 3 de 10) previne starvation entre orgs.';
