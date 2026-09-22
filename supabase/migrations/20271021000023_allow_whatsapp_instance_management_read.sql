-- Management of connection settings is distinct from permission to read chats.
-- The existing permissive organization policy still bounds every SELECT.
ALTER POLICY whatsapp_instances_linked_read ON public.whatsapp_instances
USING (
  (SELECT public.is_master_user())
  OR public.can_manage_whatsapp_instances(organization_id)
  OR id = ANY ((SELECT private.whatsapp_visible_instance_ids())::uuid[])
);
