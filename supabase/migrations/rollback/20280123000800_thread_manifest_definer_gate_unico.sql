-- Rollback de 20280123000800: volta ao corpo de prod (SQL INVOKER, md5 23437789…)
-- e remove o fingerprint de policies. ACL de prod: postgres, authenticated, service_role.
CREATE OR REPLACE FUNCTION public.whatsapp_thread_manifest(p_organization_id uuid, p_instance_ids uuid[], p_phone text, p_since_timestamp timestamp with time zone DEFAULT NULL::timestamp with time zone, p_since_id uuid DEFAULT NULL::uuid, p_fingerprint text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.whatsapp_thread_manifest(uuid, uuid[], text, timestamp with time zone, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_thread_manifest(uuid, uuid[], text, timestamp with time zone, uuid, text) TO authenticated, service_role;
DROP FUNCTION IF EXISTS private.whatsapp_messages_policy_fingerprint();
NOTIFY pgrst, 'reload schema';
