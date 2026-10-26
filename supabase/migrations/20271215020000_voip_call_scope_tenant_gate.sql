-- CI cross-tenant control exposed a real authorization defect: the global
-- leads.view_all permission could satisfy voip_can_see_call for another tenant.
-- Membership must precede both ordinary lead visibility and co-ownership.
CREATE OR REPLACE FUNCTION public.voip_can_see_call(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_lead_id IS NULL THEN true
    ELSE COALESCE(
      (SELECT
        (COALESCE(public.is_master_user(), false)
          OR l.organization_id IN (SELECT public.get_my_organization_ids()))
        AND (public.can_see_lead_by_permissions(l.pre_sale_responsible_id, l.sale_responsible_id)
          OR public.rls_lead_co_owned(l.id, (SELECT public.rls_my_team_member_ids(false))::uuid[]))
       FROM public.leads l WHERE l.id = p_lead_id),
      false)
  END
$$;
REVOKE ALL ON FUNCTION public.voip_can_see_call(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.voip_can_see_call(uuid) TO authenticated, service_role;
