-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260709210102  name: 20270309000000_revoke_media_retention_fns
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- Onda 0 / Slice 0.1 — close anon-executable vector on media-retention fns (ADV-1).
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
    LIMIT LEAST(GREATEST(p_limit, 0), 5000)
  ) s;
$$;

COMMENT ON FUNCTION public.list_expired_whatsapp_media(integer, integer) IS
  'Lists media bucket objects under whatsapp-media/ older than N days as a jsonb '
  'array (single row — avoids the PostgREST 1000-row cap). p_limit hard-capped at '
  '5000. service_role only (edge function whatsapp-media-retention).';

REVOKE EXECUTE ON FUNCTION public.list_expired_whatsapp_media(integer, integer)
  FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.list_expired_whatsapp_media(integer, integer)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.invoke_whatsapp_media_retention()
  FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.invoke_whatsapp_media_retention()
  TO service_role;
