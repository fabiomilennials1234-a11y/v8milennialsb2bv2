-- ============================================================
-- Migration: Update leads DELETE policy to respect
--   can_delete_leads org permission (Fase 1 RLS enforcement).
--
-- Before: leads_delete_admin_only — admin only.
-- After:  is_user_admin() OR user_has_org_permission('can_delete_leads')
--         (both gated by membership in the lead's organization).
--
-- The existing leads_delete_configurable (migration 20261020000000) also
-- enforces can_delete_lead() helper, which already routes through the
-- same RPC. We standardize on user_has_org_permission for parity with
-- the Permissions tab.
-- ============================================================

DROP POLICY IF EXISTS leads_delete_admin_only ON public.leads;
DROP POLICY IF EXISTS leads_delete_configurable ON public.leads;

CREATE POLICY leads_delete_admin_or_permission ON public.leads
  FOR DELETE
  USING (
    deleted_at IS NULL
    AND organization_id IN (SELECT public.get_my_organization_ids())
    AND (
      public.is_user_admin()
      OR public.is_master_user()
      OR public.user_has_org_permission('can_delete_leads')
    )
  );

COMMENT ON POLICY leads_delete_admin_or_permission ON public.leads IS
  'Pitstop Permissions tab Fase 1 — DELETE allowed for admin/master OR member with can_delete_leads enabled.';
