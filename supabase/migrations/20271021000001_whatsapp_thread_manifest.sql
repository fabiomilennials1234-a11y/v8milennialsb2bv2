-- Read-only reconciliation. RLS applies exactly as on whatsapp_messages.
-- xmin identifies visible row versions without adding writes/triggers to ingestion.
CREATE OR REPLACE FUNCTION public.whatsapp_thread_manifest(
  p_organization_id uuid, p_instance_ids uuid[], p_phone text,
  p_since_timestamp timestamptz DEFAULT NULL, p_since_id uuid DEFAULT NULL,
  p_fingerprint text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  WITH visible AS (
    SELECT m.id, m.xmin::text AS revision, m.timestamp
    FROM public.whatsapp_messages m
    WHERE m.organization_id = p_organization_id
      AND m.instance_id = ANY(p_instance_ids)
      AND m.normalized_phone = p_phone
      AND (p_since_timestamp IS NULL OR (m.timestamp, m.id) >= (p_since_timestamp, p_since_id))
    ORDER BY m.timestamp DESC, m.id DESC
    LIMIT CASE WHEN p_since_timestamp IS NULL THEN 100 ELSE NULL END
  ), snapshot AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'revision', revision)
      ORDER BY timestamp, id), '[]'::jsonb) AS manifest,
      md5(COALESCE(string_agg(id::text || ':' || revision, ',' ORDER BY timestamp, id), '')) AS fingerprint
    FROM visible
  ) SELECT jsonb_build_object('fingerprint', fingerprint,
    'unchanged', fingerprint IS NOT DISTINCT FROM p_fingerprint,
    'manifest', CASE WHEN fingerprint IS NOT DISTINCT FROM p_fingerprint THEN NULL ELSE manifest END)
  FROM snapshot;
$$;
REVOKE ALL ON FUNCTION public.whatsapp_thread_manifest(uuid, uuid[], text, timestamptz, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_thread_manifest(uuid, uuid[], text, timestamptz, uuid, text) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
