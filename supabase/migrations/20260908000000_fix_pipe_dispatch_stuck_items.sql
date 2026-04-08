-- =============================================================================
-- FIX: Recover stuck pipe dispatch items
--
-- Problem: Worker timeout during batch processing leaves items in 'processing'
-- or 'scheduled' with past scheduled_at. Also items in 'failed' that can be
-- safely retried.
--
-- This migration:
--   1. Resets 'processing' items back to 'scheduled' (crashed workers)
--   2. Retries 'failed' items with transient errors
--   3. Does NOT touch 'waiting_response', 'sent', 'executed', 'cancelled'
--
-- Safe to run multiple times (idempotent).
-- Date: 2026-04-08
-- =============================================================================

-- 0. Fix claim_pipe_dispatch_batch: set scheduled_at = now() on claim
-- Without this, stale detection compares against the original scheduled_at (always in the past),
-- causing concurrent cron ticks to prematurely release legitimately-processing items.
CREATE OR REPLACE FUNCTION public.claim_pipe_dispatch_batch(
  p_pipe_type TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE(claimed_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH batch AS (
    SELECT id
    FROM public.scheduled_pipe_messages
    WHERE status = 'scheduled'
      AND scheduled_at <= now()
      AND (p_pipe_type IS NULL OR pipe_type = p_pipe_type)
    ORDER BY scheduled_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.scheduled_pipe_messages spm
  SET status = 'processing', scheduled_at = now()
  FROM batch
  WHERE spm.id = batch.id
  RETURNING spm.id AS claimed_id;
END;
$$;

-- 1. Reset stuck processing items
UPDATE public.scheduled_pipe_messages
SET status = 'scheduled', scheduled_at = now()
WHERE status = 'processing';

-- 2. Retry failed items with transient errors (rate limit, no instance, send failed)
-- Excludes permanent failures like "Missing template" or "Lead has no phone"
UPDATE public.scheduled_pipe_messages
SET status = 'scheduled', scheduled_at = now(), error_message = 'retried: ' || COALESCE(error_message, '')
WHERE status = 'failed'
  AND error_message IS NOT NULL
  AND error_message NOT LIKE '%Missing template%'
  AND error_message NOT LIKE '%Lead has no phone%'
  AND error_message NOT LIKE '%Missing organization%'
  AND error_message NOT LIKE '%retried:%';

-- 3. Report status
DO $$
DECLARE
  v_scheduled INT;
  v_processing INT;
  v_failed INT;
  v_waiting INT;
  v_sent INT;
BEGIN
  SELECT COUNT(*) INTO v_scheduled FROM public.scheduled_pipe_messages WHERE status = 'scheduled';
  SELECT COUNT(*) INTO v_processing FROM public.scheduled_pipe_messages WHERE status = 'processing';
  SELECT COUNT(*) INTO v_failed FROM public.scheduled_pipe_messages WHERE status = 'failed';
  SELECT COUNT(*) INTO v_waiting FROM public.scheduled_pipe_messages WHERE status = 'waiting_response';
  SELECT COUNT(*) INTO v_sent FROM public.scheduled_pipe_messages WHERE status = 'sent';

  RAISE NOTICE '=== Pipe Dispatch Queue Status After Recovery ===';
  RAISE NOTICE 'scheduled: %', v_scheduled;
  RAISE NOTICE 'processing: %', v_processing;
  RAISE NOTICE 'failed: %', v_failed;
  RAISE NOTICE 'waiting_response: %', v_waiting;
  RAISE NOTICE 'sent: %', v_sent;
END $$;

SELECT status, COUNT(*) as total
FROM public.scheduled_pipe_messages
GROUP BY status
ORDER BY status;
