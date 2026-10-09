-- 20271116000010_lead_owners_rls_curto_circuito.sql
--
-- Chamado 793f4b05 · PR1/5 — custo do ramo de co-dono na RLS de `leads`.
--
-- Medido em prod em 09/10, logo depois de 20271116000000, como membro
-- restrito da Café Jurerê, sobre os ~13 mil leads da org:
--   - leitura de `leads`: ~606 ms;
--   - rls_lead_co_owned sozinho: ~306 ms (uma chamada DEFINER por linha);
--   - rls_lead_in_my_pipes (ramo antigo): ~289 ms.
-- O ramo novo dobrava o custo da RLS para usuário restrito em TODAS as orgs,
-- mesmo sem nenhuma linha `co` (a sonda roda linha a linha de qualquer jeito).
--
-- Correção: um initplan barato — "o caller é co-dono de ALGUM lead?" —
-- avaliado uma vez por consulta, antes da sonda por linha. Sem co-donos
-- (hoje: todo mundo), o AND corta e o custo por linha volta a zero.
-- Semântica idêntica: sem linha `co` do caller, rls_lead_co_owned seria falso
-- em toda linha. `can_update_lead` recebe o mesmo atalho.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE FUNCTION public.rls_my_has_co_ownership()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.lead_owners o
      JOIN public.team_members tm ON tm.id = o.team_member_id
     WHERE o.role = 'co'
       AND tm.user_id = auth.uid()
  )
$fn$;

COMMENT ON FUNCTION public.rls_my_has_co_ownership() IS
  'RLS helper (leads): o caller é co-dono de algum lead? Initplan que curto-circuita rls_lead_co_owned. Chamado 793f4b05.';

REVOKE ALL ON FUNCTION public.rls_my_has_co_ownership() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.rls_my_has_co_ownership() TO authenticated;

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
           (SELECT public.rls_my_has_co_ownership())
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

-- Policies de `leads` por último (ACCESS EXCLUSIVE dura o mínimo).
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
      (SELECT public.rls_my_has_co_ownership())
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
      (SELECT public.rls_my_has_co_ownership())
      AND public.rls_lead_co_owned(id, (SELECT public.rls_my_team_member_ids(false))::uuid[])
    )
    OR (
      cardinality((SELECT public.rls_my_team_member_ids(true))) > 0
      AND public.rls_lead_in_my_pipes(id, (SELECT public.rls_my_team_member_ids(true)))
    )
  )
);

COMMIT;
