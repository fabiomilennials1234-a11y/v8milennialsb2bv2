-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260709144708  name: whatsapp_media_retention_ddl
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- Slice 1 (DDL-only) — media_expired column + read-only listing RPC + invoker fn.
-- The destructive cron is intentionally NOT scheduled here; it is armed in a
-- separate step only after a manual dry-run is reviewed. Non-destructive.

-- 1. media_expired column (metadata-only, instant with constant default)
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS media_expired boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.whatsapp_messages.media_expired IS
  'True when the message''s media was purged by the 30-day retention job. media_url is set NULL at the same time. Chat UI renders a graceful expired state.';

-- 2. list_expired_whatsapp_media(): read-only, prefix-scoped candidate list
CREATE OR REPLACE FUNCTION public.list_expired_whatsapp_media(
  p_older_than_days integer DEFAULT 30,
  p_limit           integer DEFAULT 200
)
RETURNS TABLE (path text, size_bytes bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    o.name AS path,
    COALESCE((o.metadata ->> 'size')::bigint, 0) AS size_bytes
  FROM storage.objects o
  WHERE o.bucket_id = 'media'
    AND o.name LIKE 'whatsapp-media/%'
    AND o.created_at < now() - make_interval(days => GREATEST(p_older_than_days, 0))
  ORDER BY o.created_at ASC
  LIMIT GREATEST(p_limit, 0);
$$;

COMMENT ON FUNCTION public.list_expired_whatsapp_media(integer, integer) IS
  'Lists media bucket objects under whatsapp-media/ older than N days. Read-only, prefix-scoped.';

REVOKE ALL    ON FUNCTION public.list_expired_whatsapp_media(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_expired_whatsapp_media(integer, integer) TO service_role;

-- 3. Cron invoker (defined but NOT scheduled here)
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
    body    := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[whatsapp-media-retention] invoke failed: %', SQLERRM;
END;
$$;

REVOKE ALL    ON FUNCTION public.invoke_whatsapp_media_retention() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_whatsapp_media_retention() TO service_role;

COMMENT ON FUNCTION public.invoke_whatsapp_media_retention() IS
  'Invokes whatsapp-media-retention via pg_net. Scheduled separately after dry-run review.';
