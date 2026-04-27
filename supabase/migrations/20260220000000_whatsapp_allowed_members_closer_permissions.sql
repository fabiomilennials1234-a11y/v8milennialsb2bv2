-- Description: Closers podem gerenciar vendedores por instância WhatsApp (como admin).
-- Depende de is_admin_or_closer() da migration 20260219000000.

-- whatsapp_instance_allowed_members: INSERT/UPDATE/DELETE para admin OU closer
DROP POLICY IF EXISTS "allowed_members_insert_admin" ON public.whatsapp_instance_allowed_members;
DROP POLICY IF EXISTS "allowed_members_insert_admin_or_closer" ON public.whatsapp_instance_allowed_members;
CREATE POLICY "allowed_members_insert_admin_or_closer"
  ON public.whatsapp_instance_allowed_members FOR INSERT
  WITH CHECK (
    whatsapp_instance_id IN (
      SELECT wi.id FROM public.whatsapp_instances wi
      JOIN public.team_members tm ON tm.organization_id = wi.organization_id
      WHERE tm.user_id = auth.uid()
    )
    AND public.is_admin_or_closer()
  );

DROP POLICY IF EXISTS "allowed_members_update_admin" ON public.whatsapp_instance_allowed_members;
DROP POLICY IF EXISTS "allowed_members_update_admin_or_closer" ON public.whatsapp_instance_allowed_members;
CREATE POLICY "allowed_members_update_admin_or_closer"
  ON public.whatsapp_instance_allowed_members FOR UPDATE
  USING (
    whatsapp_instance_id IN (
      SELECT wi.id FROM public.whatsapp_instances wi
      JOIN public.team_members tm ON tm.organization_id = wi.organization_id
      WHERE tm.user_id = auth.uid()
    )
    AND public.is_admin_or_closer()
  );

DROP POLICY IF EXISTS "allowed_members_delete_admin" ON public.whatsapp_instance_allowed_members;
DROP POLICY IF EXISTS "allowed_members_delete_admin_or_closer" ON public.whatsapp_instance_allowed_members;
CREATE POLICY "allowed_members_delete_admin_or_closer"
  ON public.whatsapp_instance_allowed_members FOR DELETE
  USING (
    whatsapp_instance_id IN (
      SELECT wi.id FROM public.whatsapp_instances wi
      JOIN public.team_members tm ON tm.organization_id = wi.organization_id
      WHERE tm.user_id = auth.uid()
    )
    AND public.is_admin_or_closer()
  );
