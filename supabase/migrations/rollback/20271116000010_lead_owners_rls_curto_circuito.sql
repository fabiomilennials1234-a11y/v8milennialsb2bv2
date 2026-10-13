-- Rollback de 20271116000010: volta ao ramo de co-dono sem o initplan.
BEGIN;
SET LOCAL lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public.can_update_lead(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.leads
     WHERE leads.id = p_lead_id
       AND deleted_at IS NULL
       AND organization_id IN (SELECT public.get_my_organization_ids())
       AND (
         (SELECT public.is_user_admin())
         OR (SELECT public.has_feature_permission('leads.view_all'))
         OR organization_id = ANY ((SELECT public.rls_my_orgs_with_feature('leads.view_all'))::uuid[])
         OR pre_sale_responsible_id = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
         OR sale_responsible_id     = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
         OR sdr_id                  = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
         OR closer_id               = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
         OR (
           sdr_id IS NULL AND closer_id IS NULL
           AND (SELECT public.user_has_org_permission('see_unassigned_cards'))
         )
         OR (
           (SELECT public.user_has_org_permission('see_subordinates_cards'))
           AND (
             sdr_id    = ANY ((SELECT public.rls_my_same_org_team_member_ids())::uuid[])
             OR closer_id = ANY ((SELECT public.rls_my_same_org_team_member_ids())::uuid[])
           )
         )
         OR (
           cardinality((SELECT public.rls_my_team_member_ids(false))) > 0
           AND public.rls_lead_co_owned(leads.id, (SELECT public.rls_my_team_member_ids(false))::uuid[])
         )
         OR (
           cardinality((SELECT public.rls_my_team_member_ids(true))) > 0
           AND public.rls_lead_in_my_pipes(leads.id, (SELECT public.rls_my_team_member_ids(true)))
         )
       )
  )
$fn$;

REVOKE ALL ON FUNCTION public.can_update_lead(uuid) FROM PUBLIC, anon, authenticated;

ALTER POLICY "leads_select_by_responsibility_and_permissions"
ON public.leads
TO authenticated
USING (
  deleted_at IS NULL
  AND organization_id IN (SELECT public.get_my_organization_ids())
  AND (
    (SELECT public.is_user_admin())
    OR organization_id IN (SELECT public.get_my_gestor_organization_ids())
    OR (SELECT public.has_feature_permission('leads.view_all'))
    OR organization_id = ANY ((SELECT public.rls_my_orgs_with_feature('leads.view_all'))::uuid[])
    OR pre_sale_responsible_id = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
    OR sale_responsible_id     = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
    OR sdr_id                  = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
    OR closer_id               = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
    OR (
      sdr_id IS NULL AND closer_id IS NULL
      AND (SELECT public.user_has_org_permission('see_unassigned_cards'))
    )
    OR (
      (SELECT public.user_has_org_permission('see_subordinates_cards'))
      AND (
        sdr_id    = ANY ((SELECT public.rls_my_same_org_team_member_ids())::uuid[])
        OR closer_id = ANY ((SELECT public.rls_my_same_org_team_member_ids())::uuid[])
      )
    )
    OR (
      cardinality((SELECT public.rls_my_team_member_ids(false))) > 0
      AND public.rls_lead_co_owned(id, (SELECT public.rls_my_team_member_ids(false))::uuid[])
    )
    OR (
      cardinality((SELECT public.rls_my_team_member_ids(true))) > 0
      AND public.rls_lead_in_my_pipes(id, (SELECT public.rls_my_team_member_ids(true)))
    )
  )
);

-- WITH CHECK continua NULL (o USING vale para a linha nova), como em prod.
ALTER POLICY "leads_update_by_responsibility_and_permissions"
ON public.leads
TO authenticated
USING (
  deleted_at IS NULL
  AND organization_id IN (SELECT public.get_my_organization_ids())
  AND (
    (SELECT public.is_user_admin())
    OR (SELECT public.has_feature_permission('leads.view_all'))
    OR organization_id = ANY ((SELECT public.rls_my_orgs_with_feature('leads.view_all'))::uuid[])
    OR pre_sale_responsible_id = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
    OR sale_responsible_id     = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
    OR sdr_id                  = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
    OR closer_id               = ANY ((SELECT public.rls_my_team_member_ids(false))::uuid[])
    OR (
      sdr_id IS NULL AND closer_id IS NULL
      AND (SELECT public.user_has_org_permission('see_unassigned_cards'))
    )
    OR (
      (SELECT public.user_has_org_permission('see_subordinates_cards'))
      AND (
        sdr_id    = ANY ((SELECT public.rls_my_same_org_team_member_ids())::uuid[])
        OR closer_id = ANY ((SELECT public.rls_my_same_org_team_member_ids())::uuid[])
      )
    )
    OR (
      cardinality((SELECT public.rls_my_team_member_ids(false))) > 0
      AND public.rls_lead_co_owned(id, (SELECT public.rls_my_team_member_ids(false))::uuid[])
    )
    OR (
      cardinality((SELECT public.rls_my_team_member_ids(true))) > 0
      AND public.rls_lead_in_my_pipes(id, (SELECT public.rls_my_team_member_ids(true)))
    )
  )
);

DROP FUNCTION IF EXISTS public.rls_my_has_co_ownership();

COMMIT;
