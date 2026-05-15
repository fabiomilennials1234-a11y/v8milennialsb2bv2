-- =============================================================================
-- CRITICAL SECURITY FIX: W0-1 + W0-5
-- =============================================================================
--
-- W0-1: Multiple "service role" RLS policies are missing the `TO service_role`
-- clause. Without it, Postgres applies the policy to ALL roles (authenticated,
-- anon, service_role). Combined with `USING (true) WITH CHECK (true)`, this
-- gives every user full read/write/delete on these tables — bypassing all
-- tenant isolation.
--
-- Affected tables: agent_decision_logs, conversation_summaries,
-- webhook_dead_letters, outbound_dispatch_log, system_alerts, audit_log,
-- workflow_executions, workflow_execution_steps.
--
-- conversations and conversation_messages were already fixed in migration
-- 20260128050000 (auth.role() = 'service_role' pattern).
--
-- W0-5: generate_api_key() is SECURITY DEFINER but performs zero caller
-- authorization. Any authenticated user can mint API keys for ANY org.
-- Fix: validate caller is org admin or master user before generating.
--
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- W0-1: Fix service_role policies
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. agent_decision_logs
-- Original: "Service role can insert decision logs" (FOR INSERT, no TO)
-- Also: "service_role_decision_logs_all" (FOR ALL, no TO) from 20260125000002
DROP POLICY IF EXISTS "Service role can insert decision logs" ON public.agent_decision_logs;
DROP POLICY IF EXISTS "service_role_decision_logs_all" ON public.agent_decision_logs;

CREATE POLICY "agent_decision_logs_service_role"
  ON public.agent_decision_logs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 2. conversation_summaries
-- Original: "Service role can manage summaries" (FOR ALL, no TO)
DROP POLICY IF EXISTS "Service role can manage summaries" ON public.conversation_summaries;

CREATE POLICY "conversation_summaries_service_role"
  ON public.conversation_summaries
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 3. webhook_dead_letters
-- Original: "Service role manages dead letters" (FOR ALL, no TO)
DROP POLICY IF EXISTS "Service role manages dead letters" ON public.webhook_dead_letters;

CREATE POLICY "webhook_dead_letters_service_role"
  ON public.webhook_dead_letters
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4. outbound_dispatch_log
-- Original: "service_role_all" (FOR ALL, no TO)
DROP POLICY IF EXISTS "service_role_all" ON public.outbound_dispatch_log;

CREATE POLICY "outbound_dispatch_log_service_role"
  ON public.outbound_dispatch_log
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 5. system_alerts
-- Original: "service_role_all" (FOR ALL, no TO)
DROP POLICY IF EXISTS "service_role_all" ON public.system_alerts;

CREATE POLICY "system_alerts_service_role"
  ON public.system_alerts
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 6. audit_log
-- Original: "service_role_all_audit" (FOR ALL, no TO)
DROP POLICY IF EXISTS "service_role_all_audit" ON public.audit_log;

CREATE POLICY "audit_log_service_role"
  ON public.audit_log
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 7. workflow_executions
-- Original: "workflow_executions_service_role" (FOR ALL, no TO)
DROP POLICY IF EXISTS "workflow_executions_service_role" ON public.workflow_executions;

CREATE POLICY "workflow_executions_service_role"
  ON public.workflow_executions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 8. workflow_execution_steps
-- Original: "workflow_execution_steps_service_role" (FOR ALL, no TO)
DROP POLICY IF EXISTS "workflow_execution_steps_service_role" ON public.workflow_execution_steps;

CREATE POLICY "workflow_execution_steps_service_role"
  ON public.workflow_execution_steps
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- ─────────────────────────────────────────────────────────────────────────────
-- W0-1 supplementary: Ensure authenticated SELECT policies exist
-- ─────────────────────────────────────────────────────────────────────────────

-- conversation_summaries: already has "Users can view summaries from their
-- organization" (20260127100001) — no action needed.

-- agent_decision_logs: original SELECT policy "Users can view decision logs
-- from their organization" was dropped in 20260303000000 and replaced with
-- "agent_decision_logs_select_org". Verify it exists; recreate if not.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agent_decision_logs'
      AND policyname = 'agent_decision_logs_select_org'
  ) THEN
    CREATE POLICY "agent_decision_logs_select_org"
      ON public.agent_decision_logs FOR SELECT
      USING (
        organization_id IN (
          SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- W0-5: Fix generate_api_key — add caller authorization
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.generate_api_key(
  p_org_id UUID,
  p_name TEXT,
  p_created_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw_key TEXT;
  v_key_hash TEXT;
  v_key_prefix TEXT;
  v_id UUID;
BEGIN
  -- ── Authorization check ──────────────────────────────────────────────────
  -- Caller must be org admin or master user. Without this, any authenticated
  -- user could mint keys for any organization.
  IF NOT (
    public.is_master_user()
    OR EXISTS (
      SELECT 1 FROM public.team_members
      WHERE user_id = auth.uid()
        AND organization_id = p_org_id
        AND role = 'admin'
    )
  ) THEN
    RAISE EXCEPTION 'Forbidden: must be org admin';
  END IF;

  -- Generate raw key: tq_live_ + 32 hex chars (16 random bytes)
  v_raw_key := 'tq_live_' || encode(gen_random_bytes(16), 'hex');

  -- SHA-256 hash for storage
  v_key_hash := encode(digest(v_raw_key, 'sha256'), 'hex');

  -- Prefix for fast lookup (first 12 chars: "tq_live_xxxx")
  v_key_prefix := left(v_raw_key, 12);

  -- Insert the key record
  INSERT INTO public.api_keys (organization_id, name, key_hash, key_prefix, created_by)
  VALUES (p_org_id, p_name, v_key_hash, v_key_prefix, p_created_by)
  RETURNING id INTO v_id;

  -- Return the raw key (shown once only) plus metadata
  RETURN jsonb_build_object(
    'key_id', v_id,
    'raw_key', v_raw_key,
    'prefix', v_key_prefix
  );
END;
$$;

COMMIT;
