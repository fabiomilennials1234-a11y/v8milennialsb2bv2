-- =================================================================
-- FIX: wait_response node — timeout never fires, execution stuck
--
-- Problems:
--   1. claim_workflow_executions only picks up 'running' and stale
--      'processing'. Executions in 'waiting_response' with expired
--      next_run_at are never claimed → timeout never fires.
--   2. No mechanism to detect lead reply and resolve the wait.
--
-- Solution:
--   1. Update claim RPC to also pick up 'waiting_response' with
--      expired next_run_at (timeout). Set status to 'processing'
--      and add wait_timeout_resolved flag in context.
--   2. Create resolve_wait_response() function that incoming message
--      handlers can call to mark a waiting execution as replied.
--   3. Update index to cover the new status.
-- =================================================================

-- 1. Drop and recreate the index to include waiting_response
DROP INDEX IF EXISTS idx_workflow_executions_claim;
CREATE INDEX idx_workflow_executions_claim
  ON public.workflow_executions(status, next_run_at)
  WHERE status IN ('running', 'processing', 'waiting_response');

-- 2. Updated claim RPC — also picks up timed-out waiting_response
CREATE OR REPLACE FUNCTION public.claim_workflow_executions(batch_size INT DEFAULT 20)
RETURNS SETOF public.workflow_executions AS $$
  UPDATE public.workflow_executions
  SET
    status = 'processing',
    updated_at = NOW(),
    -- Mark timed-out waits so the executor knows to follow the timeout branch
    context = CASE
      WHEN status = 'waiting_response' AND next_run_at <= NOW()
        THEN COALESCE(context, '{}'::jsonb) || '{"_wait_resolved":"timeout"}'::jsonb
      ELSE context
    END
  WHERE id IN (
    SELECT id FROM public.workflow_executions
    WHERE
      -- Normal: running executions ready to process
      (status = 'running' AND (next_run_at IS NULL OR next_run_at <= NOW()))
      -- Stale: processing stuck for > 10 min
      OR (status = 'processing' AND updated_at < NOW() - INTERVAL '10 minutes')
      -- Timeout: waiting_response with expired deadline
      OR (status = 'waiting_response' AND next_run_at IS NOT NULL AND next_run_at <= NOW())
    ORDER BY started_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$ LANGUAGE sql;

-- 3. Function to resolve a waiting execution when lead replies
--    Called by message ingestion handlers (Edge Functions, triggers)
--    Returns the number of executions resolved.
CREATE OR REPLACE FUNCTION public.resolve_wait_response(
  p_lead_id UUID,
  p_organization_id UUID,
  p_channel TEXT DEFAULT 'any'
) RETURNS INT AS $$
DECLARE
  v_count INT := 0;
  v_exec RECORD;
BEGIN
  FOR v_exec IN
    SELECT id, current_node_id, context
    FROM public.workflow_executions
    WHERE lead_id = p_lead_id
      AND organization_id = p_organization_id
      AND status = 'waiting_response'
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Check channel match: if node configured specific channel, only match that
    -- The channel config is stored in the workflow definition, not in executions.
    -- For simplicity, resolve all waiting executions for this lead.
    -- The executor will verify channel match if needed.
    UPDATE public.workflow_executions
    SET
      status = 'running',
      next_run_at = NOW(),
      updated_at = NOW(),
      context = COALESCE(v_exec.context, '{}'::jsonb)
        || jsonb_build_object(
          '_wait_resolved', 'replied',
          '_replied_at', NOW()::text,
          '_reply_channel', p_channel
        )
    WHERE id = v_exec.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
