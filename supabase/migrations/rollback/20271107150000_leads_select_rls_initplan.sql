-- rollback/20271107150000_leads_select_rls_initplan.sql
--
-- Restores the two leads policies to the literal prod bodies read on
-- 2026-10-05 (pg_policies, before the apply) and drops the 4 helpers.
-- Roles go back to {public}. No existing function was altered by the forward
-- migration, so nothing else needs restoring.
--
-- Prod pg_get_functiondef md5 of the functions the restored policies call
-- (unchanged by the forward migration; compare after rollback):
--   can_see_lead_by_permissions(uuid,uuid)     4f36e5d394a307215d69451155fb03b7
--   get_my_gestor_organization_ids()           a342535bf36d39ce5dba59fd8441e122
--   get_my_organization_ids()                  72fb9e49c1956386ac3eca3d96325a5a
--   get_user_organization_id()                 833c3f54359e0ef60924b9e333fe78f6
--   has_feature_permission(text,uuid)          7e2cfbc44d0eac9e31919783c735898c
--   has_feature_permission(text)               78973ce76491257315788143ebddf057
--   has_no_responsible(uuid,uuid,uuid)         94c337ac25e16447e372c280410a0a11
--   has_role(uuid,app_role)                    a3b8be480ffca96c1fd266ef1dfc7309
--   is_master_user(uuid)                       0fdb47977f7bc6a3b19a4c892e350075
--   is_responsible_in_same_org(uuid,uuid)      218f98d00a5d634b5caa555f098bf5cd
--   is_user_admin()                            d2c767591da0cc2a7391614322b52538
--   is_user_responsible_in_any_pipe(uuid)      2526bf603c67860b8aae00704eb2af15
--   is_user_responsible(uuid,uuid,uuid)        7994faaf4a6903512dcb3d5046f1cf3f
--   is_user_responsible(uuid,uuid)             ce40007aecbd8b6f8785b0734f80bddf
--   org_access_blocked(uuid)                   b9120fe946711aa617fc84ad921a11a7
--   user_has_org_permission(text)              843a1c0896c12b4757961a7e619f4c89
--
-- ⚠ Rolling back brings the per-row cost (and the OOM risk) back. Same lock
--   rules as the forward file: ACCESS EXCLUSIVE on leads, off-peak.

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER POLICY "leads_select_by_responsibility_and_permissions"
ON public.leads
TO public
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

ALTER POLICY "leads_update_by_responsibility_and_permissions"
ON public.leads
TO public
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

DROP FUNCTION public.rls_lead_in_my_pipes(uuid, uuid[]);
DROP FUNCTION public.rls_my_orgs_with_feature(text);
DROP FUNCTION public.rls_my_same_org_team_member_ids();
DROP FUNCTION public.rls_my_team_member_ids(boolean);

COMMIT;
