-- =====================================================
-- pg_net response queue cleanup
-- =====================================================
--
-- Root cause: pg_net writes every HTTP response into `net._http_response`.
-- Without cleanup, this table grows unbounded. Known Supabase failure mode:
-- once the queue exceeds internal thresholds, pg_net stops issuing new
-- requests silently — and EVERY automation depending on pg_net (workflow
-- cron, campaign dispatch triggers, immediate dispatch, stage_changed
-- triggers) stops working with no visible error.
--
-- Fix: daily cleanup job retaining 7 days of responses. Runs at 03:00 UTC
-- to minimize impact on operational traffic.
--
-- Rollback: `SELECT cron.unschedule('pgnet_response_cleanup');`
-- =====================================================

DO $outer$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping pgnet_response_cleanup schedule';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net not installed — skipping pgnet_response_cleanup schedule';
    RETURN;
  END IF;

  -- Unschedule any pre-existing job with this name (idempotent re-run safe)
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pgnet_response_cleanup') THEN
    PERFORM cron.unschedule('pgnet_response_cleanup');
  END IF;

  PERFORM cron.schedule(
    'pgnet_response_cleanup',
    '0 3 * * *',
    $cleanup$
      DELETE FROM net._http_response
      WHERE created < NOW() - INTERVAL '7 days';
    $cleanup$
  );
END
$outer$;

COMMENT ON EXTENSION pg_net IS
  'pg_net HTTP queue. Daily cleanup at 03:00 UTC via cron job '
  'pgnet_response_cleanup (retains 7d). Without this, queue growth '
  'silently breaks all pg_net-dependent automations.';
