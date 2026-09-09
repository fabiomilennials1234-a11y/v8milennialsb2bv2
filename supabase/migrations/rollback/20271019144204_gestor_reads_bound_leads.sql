-- Restore the prior Leads SELECT policy without the Gestor responsibility
-- bypass. The outer tenant boundary remains unchanged.

ALTER POLICY "leads_select_by_responsibility_and_permissions"
ON public.leads
USING (
  deleted_at IS NULL
  AND organization_id IN (SELECT public.get_my_organization_ids())
  AND (
    (SELECT public.is_user_admin())
    OR public.has_feature_permission('leads.view_all', organization_id)
    OR public.is_user_responsible(pre_sale_responsible_id, sale_responsible_id)
    OR public.can_see_lead_by_permissions(sdr_id, closer_id)
    OR public.is_user_responsible_in_any_pipe(id)
  )
);

COMMENT ON POLICY "leads_select_by_responsibility_and_permissions" ON public.leads IS NULL;
