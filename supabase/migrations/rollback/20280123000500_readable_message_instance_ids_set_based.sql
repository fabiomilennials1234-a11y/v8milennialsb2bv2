-- Rollback de 20280123000500: volta ao corpo de prod (md5 bb799a16…).
CREATE OR REPLACE FUNCTION private.whatsapp_readable_message_instance_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(array_agg(DISTINCT history.id), ARRAY[]::uuid[])
  FROM public.get_my_organization_ids() AS org(id)
  CROSS JOIN LATERAL unnest(public.whatsapp_readable_instance_ids(org.id)) AS box(id)
  CROSS JOIN LATERAL unnest(public.whatsapp_chip_instance_ids(org.id, box.id)) AS history(id)
  WHERE auth.uid() IS NOT NULL;
$function$
;

REVOKE ALL ON FUNCTION private.whatsapp_readable_message_instance_ids() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION private.whatsapp_readable_message_instance_ids() TO authenticated;
