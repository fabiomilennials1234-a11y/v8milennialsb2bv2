-- 20270303000001_whatsapp_media_retention_fixes.sql
--
-- Hotfixes applied LIVE to prod during the 2026-07-09 media backfill purge,
-- reconciled into the repo here. Two defects in the original slice
-- (20270303000000) surfaced only against real data / at scale:
--
--   1. list_expired_whatsapp_media returned a TABLE. supabase.rpc() over
--      PostgREST caps table-valued returns at ~1000 rows, so the edge function
--      only ever received 1000 candidates per run regardless of p_limit. Fixed
--      by returning a single jsonb array (not row-capped).
--
--   2. invoke_whatsapp_media_retention() used net.http_post with the default
--      5s timeout; pg_net closed the connection at 5s and the edge runtime
--      killed the function mid-run. Raised to 140s so a run completes its batch.
--
-- The message-marking correlation (per-path message_id extraction) was also
-- wrong — storage paths are `whatsapp-media/{org}/{type}_{hex}_{ts}.{ext}`, not
-- `{message_id}.{ext}` — but that lives in the edge function (index.ts), which
-- now marks set-based by the `timestamp` window instead of per-path.

-- 1. jsonb-returning listing RPC (bypasses PostgREST 1000-row cap)
DROP FUNCTION IF EXISTS public.list_expired_whatsapp_media(integer, integer);

CREATE OR REPLACE FUNCTION public.list_expired_whatsapp_media(
  p_older_than_days integer DEFAULT 30,
  p_limit           integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'path', name,
      'size', COALESCE((metadata ->> 'size')::bigint, 0)
    )),
    '[]'::jsonb
  )
  FROM (
    SELECT name, metadata
    FROM storage.objects
    WHERE bucket_id = 'media'
      AND name LIKE 'whatsapp-media/%'
      AND created_at < now() - make_interval(days => GREATEST(p_older_than_days, 0))
    ORDER BY created_at ASC
    LIMIT GREATEST(p_limit, 0)
  ) s;
$$;

COMMENT ON FUNCTION public.list_expired_whatsapp_media(integer, integer) IS
  'Lists media bucket objects under whatsapp-media/ older than N days as a jsonb '
  'array (single row — avoids the PostgREST 1000-row cap on table returns).';

REVOKE ALL    ON FUNCTION public.list_expired_whatsapp_media(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_expired_whatsapp_media(integer, integer) TO service_role;

-- 2. invoker with a long pg_net timeout so the edge function runs to completion
CREATE OR REPLACE FUNCTION public.invoke_whatsapp_media_retention()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
BEGIN
  SELECT value INTO v_url    FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';
  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING '[whatsapp-media-retention] cron_config incomplete: url_present=%, secret_present=%',
      v_url IS NOT NULL, v_secret IS NOT NULL;
    RETURN;
  END IF;
  v_url := replace(v_url, 'campaign-rule-dispatch', 'whatsapp-media-retention');
  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 140000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[whatsapp-media-retention] invoke failed: %', SQLERRM;
END;
$$;

REVOKE ALL    ON FUNCTION public.invoke_whatsapp_media_retention() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_whatsapp_media_retention() TO service_role;
