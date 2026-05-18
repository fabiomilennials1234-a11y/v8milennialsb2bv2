-- Cleanup function for copilot batching tables
CREATE OR REPLACE FUNCTION public.cleanup_copilot_message_queue()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_queue int;
  v_deleted_locks int;
BEGIN
  -- Delete done queue entries older than 7 days
  DELETE FROM copilot_message_queue
  WHERE status = 'done' AND processed_at < now() - interval '7 days';
  GET DIAGNOSTICS v_deleted_queue = ROW_COUNT;

  -- Delete stale locks older than 24 hours
  DELETE FROM copilot_processing_locks
  WHERE locked_at < now() - interval '24 hours';
  GET DIAGNOSTICS v_deleted_locks = ROW_COUNT;

  IF v_deleted_queue > 0 OR v_deleted_locks > 0 THEN
    RAISE LOG 'copilot_cleanup: queue=% locks=%', v_deleted_queue, v_deleted_locks;
  END IF;
END;
$$;

-- Schedule daily at 03:00 UTC
SELECT cron.schedule(
  'cleanup-copilot-batching',
  '0 3 * * *',
  $$SELECT public.cleanup_copilot_message_queue()$$
);
