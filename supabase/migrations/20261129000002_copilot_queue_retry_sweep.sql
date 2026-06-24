-- Sweep de retry/reclaim da copilot_message_queue (pg_cron 1min).
-- Complementa o trigger pg_net no insert (entrega imediata) cobrindo:
--   1. retries (pending com next_attempt_at vencido — backoff já passou)
--   2. reclaim de processing preso (worker morreu, claimed_at além do lease)
--   3. safety-net: pending fresco cujo http_post do insert-trigger nunca disparou
--      (queued_at velho, next_attempt_at NULL). Threshold > idle+cap p/ não roubar batching.
CREATE OR REPLACE FUNCTION public.sweep_copilot_queue(p_lease_seconds int DEFAULT 120)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_worker_url text;
  v_secret_val text;
  v_batch text;
  v_count int := 0;
BEGIN
  SELECT value INTO v_worker_url FROM cron_config WHERE key = 'copilot_batch_processor_url';
  SELECT value INTO v_secret_val FROM cron_config WHERE key = 'cron_secret';
  IF v_worker_url IS NULL OR v_worker_url = '' THEN RETURN 0; END IF;

  FOR v_batch IN
    SELECT DISTINCT batch_key
    FROM copilot_message_queue
    WHERE batch_key IS NOT NULL
      AND (
        (status = 'pending' AND next_attempt_at IS NOT NULL AND next_attempt_at <= now())
        OR
        (status = 'processing' AND claimed_at IS NOT NULL
          AND claimed_at < now() - make_interval(secs => p_lease_seconds))
        OR
        (status = 'pending' AND next_attempt_at IS NULL
          AND queued_at < now() - interval '30 seconds')
      )
  LOOP
    PERFORM net.http_post(
      url := v_worker_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', COALESCE(v_secret_val, '')
      ),
      body := jsonb_build_object('batch_key', v_batch, 'force_drain', true)
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

-- Agenda 1min (idempotente via cron.schedule por nome).
SELECT cron.schedule('copilot-queue-sweep', '* * * * *', $$SELECT public.sweep_copilot_queue();$$);
