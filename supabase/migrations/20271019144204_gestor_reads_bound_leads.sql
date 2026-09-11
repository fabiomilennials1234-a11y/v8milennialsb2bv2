-- ADR-0021: a Gestor de Portfólio is an Org Admin inside bound organizations.
-- The tenant helper already includes those organizations, but the Leads SELECT
-- policy has a second responsibility gate. Add the missing Gestor branch there
-- without widening the outer tenant boundary.

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
    OR organization_id IN (SELECT public.get_my_gestor_organization_ids())
  )
);

COMMENT ON POLICY "leads_select_by_responsibility_and_permissions" ON public.leads IS
  'Tenant membership plus responsibility/permission visibility. Gestores read every Lead only inside organizations explicitly bound through gestor_organizations (ADR-0021).';
