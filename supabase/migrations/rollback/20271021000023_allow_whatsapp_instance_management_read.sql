ALTER POLICY whatsapp_instances_linked_read ON public.whatsapp_instances
USING (
  (SELECT public.is_master_user())
  OR id = ANY ((SELECT private.whatsapp_visible_instance_ids())::uuid[])
);
