-- =====================================================
-- Fix: Claim RPCs with timeout for stale "processing" items
-- Fix: Remove duplicate cron job (process_outbound_dispatches)
-- =====================================================

-- 1. Ensure updated_at column exists on workflow_executions
ALTER TABLE public.workflow_executions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 2. Ensure updated_at column exists on pending_ai_actions
ALTER TABLE public.pending_ai_actions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 3. Fix claim_pending_ai_actions — include stale "processing" items (> 10 min)
CREATE OR REPLACE FUNCTION public.claim_pending_ai_actions(batch_size INT DEFAULT 10)
RETURNS SETOF public.pending_ai_actions AS $$
  UPDATE public.pending_ai_actions
  SET status = 'processing', updated_at = NOW()
  WHERE id IN (
    SELECT id FROM public.pending_ai_actions
    WHERE (status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= NOW()))
       OR (status = 'processing' AND updated_at < NOW() - INTERVAL '10 minutes')
    ORDER BY created_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$ LANGUAGE sql;

-- 4. Fix claim_workflow_executions — include stale "processing" items (> 10 min)
CREATE OR REPLACE FUNCTION public.claim_workflow_executions(batch_size INT DEFAULT 20)
RETURNS SETOF public.workflow_executions AS $$
  UPDATE public.workflow_executions
  SET status = 'processing', updated_at = NOW()
  WHERE id IN (
    SELECT id FROM public.workflow_executions
    WHERE (status = 'running' AND (next_run_at IS NULL OR next_run_at <= NOW()))
       OR (status = 'processing' AND updated_at < NOW() - INTERVAL '10 minutes')
    ORDER BY started_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$ LANGUAGE sql;

-- 5. Remove duplicate cron job if exists (underscore variant)
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process_outbound_dispatches') THEN
      PERFORM cron.unschedule('process_outbound_dispatches');
    END IF;
  END IF;
END $outer$;
