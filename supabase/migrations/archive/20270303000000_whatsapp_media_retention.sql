-- 20270303000000_whatsapp_media_retention.sql
--
-- Slice 1 — 30-day retention for WhatsApp chat media + "media expired" state.
--
-- Context: the shared PUBLIC `media` bucket grew to ~108GB, with `whatsapp-media/`
-- accounting for 300k+ files (99.9%) and ~2GB/day growth and NO retention. The
-- storage health was invisible to the DB dossier (`02 — Arquitetura/Dossiê DB —
-- Saúde e Roadmap.md`) which only looked at table/index bloat. Decision (CTO):
-- pure 30-day retention, no cold storage (R2). This migration adds:
--   1. whatsapp_messages.media_expired flag (UI degrade signal)
--   2. list_expired_whatsapp_media() — lists candidate objects (prefix-scoped)
--   3. daily pg_cron job invoking the whatsapp-media-retention edge function
--
-- SCOPE GUARD (critical): retention only ever touches objects under the
-- `whatsapp-media/` prefix. Message templates, campaign assets, avatars and
-- copilot audio share the same bucket under DIFFERENT prefixes and must stay
-- intact. The prefix filter lives in the RPC below AND is re-checked in the
-- edge function (defence in depth).
--
-- IRREVERSIBLE: media older than the CDN window (~14d) has no re-fetch source,
-- so the FIRST prod run MUST be a manual dry-run (see bottom of this file)
-- before the cron is enabled.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. media_expired column
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS media_expired boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.whatsapp_messages.media_expired IS
  'True when the message''s media was purged by the 30-day retention job '
  '(whatsapp-media-retention). media_url is set NULL at the same time. The chat '
  'UI renders a graceful "media expired" state instead of a broken <img>.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. list_expired_whatsapp_media(): candidate objects older than N days
--
-- SECURITY DEFINER because storage.objects is not exposed via PostgREST and is
-- owned by supabase_storage_admin. Reads only — never mutates. Prefix-scoped so
-- it can never surface a non-whatsapp-media object. search_path pinned; the
-- storage table is fully qualified so it does not depend on the search_path.
-- ─────────────────────────────────────────────────────────────────────────────
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
  'Lists `media` bucket objects under the whatsapp-media/ prefix older than N '
  'days (default 30). Read-only, prefix-scoped. Consumed by the '
  'whatsapp-media-retention edge function which deletes via the Storage API.';

-- Least privilege: only service_role (edge function) may call this.
-- NB: REVOKE FROM PUBLIC (not just anon) — anon inherits EXECUTE via the
-- implicit GRANT TO PUBLIC, so REVOKE FROM anon alone is a no-op.
REVOKE ALL    ON FUNCTION public.list_expired_whatsapp_media(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_expired_whatsapp_media(integer, integer) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Cron invoker (pg_net → edge function, x-cron-secret auth)
--
-- Mirrors invoke_whatsapp_media_retry(): derives the function URL from the
-- shared cron_config template and swaps the function name.
-- ─────────────────────────────────────────────────────────────────────────────
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
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body    := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[whatsapp-media-retention] invoke failed: %', SQLERRM;
END;
$$;

REVOKE ALL    ON FUNCTION public.invoke_whatsapp_media_retention() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_whatsapp_media_retention() TO service_role;

COMMENT ON FUNCTION public.invoke_whatsapp_media_retention() IS
  'Invokes whatsapp-media-retention daily via pg_net. Deletes whatsapp-media/ '
  'objects older than 30 days and marks the corresponding messages expired.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Schedule — daily 04:00 (off-peak).
--
-- IMPORTANT: enabling this makes the first scheduled run DELETE. In PROD, run a
-- manual dry-run first and eyeball the counts:
--   curl -X POST 'https://<ref>.supabase.co/functions/v1/whatsapp-media-retention?dryRun=1' \
--        -H 'x-cron-secret: <CRON_SECRET>'
-- Only after the dry-run looks sane should this schedule be left in place.
-- (The schedule is created idempotently by name here; unschedule it manually if
-- the dry-run is not yet approved for a given environment.)
-- ─────────────────────────────────────────────────────────────────────────────
DO $outer$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping whatsapp_media_retention schedule';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp_media_retention') THEN
    PERFORM cron.unschedule('whatsapp_media_retention');
  END IF;

  PERFORM cron.schedule(
    'whatsapp_media_retention',
    '0 4 * * *',
    'SELECT public.invoke_whatsapp_media_retention()'
  );
END
$outer$;
