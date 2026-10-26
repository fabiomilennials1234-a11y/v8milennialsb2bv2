-- Restores the prior function for explicit rollback only. This reopens the
-- cross-tenant boolean visibility defect; prefer forward repair.
CREATE OR REPLACE FUNCTION public.voip_can_see_call(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_lead_id IS NULL THEN true
    ELSE COALESCE(
      (SELECT (public.can_see_lead_by_permissions(l.pre_sale_responsible_id, l.sale_responsible_id)
              OR public.rls_lead_co_owned(l.id, (SELECT public.rls_my_team_member_ids(false))::uuid[]))
         FROM public.leads l
        WHERE l.id = p_lead_id),
      false)
  END
$$;

