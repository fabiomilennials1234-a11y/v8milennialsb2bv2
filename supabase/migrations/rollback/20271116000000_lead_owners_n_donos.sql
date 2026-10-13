-- Rollback de 20271116000000_lead_owners_n_donos.sql (Chamado 793f4b05 · PR1/5)
--
-- ANTES de rodar: volte o frontend e as edge functions para uma versão que
-- não lê `lead_owners` nem chama lead_owner_add/remove/transfer (PR2+), senão
-- o PostgREST devolve 404/PGRST202/PGRST200.
--
-- PERDE DADO: todos os co-donos (role='co') e a autoria/origem das linhas.
-- Os donos principais continuam nas colunas de `leads`, que nunca foram
-- tocadas pela migration. Quem só via o lead por ser co-dono deixa de ver.
-- Exporte antes:  COPY (SELECT * FROM public.lead_owners WHERE role = 'co') TO ...
--
-- Remove também a flag `lead_owners_n_donos` de todas as orgs.
--
-- Policies e can_update_lead voltam ao texto LITERAL de antes
-- (20271107150000 e 20271110000000, = pg_policies/pg_get_functiondef de prod
-- em 09/10). Policies primeiro: dependem de rls_lead_co_owned.

BEGIN;

SET LOCAL lock_timeout = '3s';

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
      cardinality((SELECT public.rls_my_team_member_ids(true))) > 0
      AND public.rls_lead_in_my_pipes(id, (SELECT public.rls_my_team_member_ids(true)))
    )
  )
);

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
      cardinality((SELECT public.rls_my_team_member_ids(true))) > 0
      AND public.rls_lead_in_my_pipes(id, (SELECT public.rls_my_team_member_ids(true)))
    )
  )
);

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
           cardinality((SELECT public.rls_my_team_member_ids(true))) > 0
           AND public.rls_lead_in_my_pipes(leads.id, (SELECT public.rls_my_team_member_ids(true)))
         )
       )
  )
$fn$;

COMMENT ON FUNCTION public.can_update_lead(uuid) IS
  'Espelho literal do USING de leads_update_by_responsibility_and_permissions, para RPCs SECURITY DEFINER. Divergência é pega pelo pgTAP lead_documents_test.sql.';

DROP TRIGGER IF EXISTS trg_lead_owners_sync_primary_ins ON public.leads;
DROP TRIGGER IF EXISTS trg_lead_owners_sync_primary_upd ON public.leads;

DROP FUNCTION IF EXISTS public.lead_owner_transfer(uuid, uuid, text, boolean);
DROP FUNCTION IF EXISTS public.lead_owner_remove(uuid, uuid);
DROP FUNCTION IF EXISTS public.lead_owner_add(uuid, uuid);
DROP FUNCTION IF EXISTS public.lead_owner_list(uuid);
DROP FUNCTION IF EXISTS public.lead_owner_assert_member(uuid, uuid);
DROP FUNCTION IF EXISTS public.lead_owner_authorize(uuid);
DROP FUNCTION IF EXISTS public.rls_lead_co_owned(uuid, uuid[]);
DROP FUNCTION IF EXISTS public.fn_lead_owners_sync_primary();

DROP TABLE IF EXISTS public.lead_owners;

DROP FUNCTION IF EXISTS public.fn_lead_owners_guard();
DROP FUNCTION IF EXISTS public.lead_owners_backfill(uuid);
DROP FUNCTION IF EXISTS public.lead_owners_enabled(uuid);

-- A flag sai de TODAS as orgs: sem a tabela ela mentiria para o front
-- (useFeatureFlag), que mostraria a UI de N donos sobre RPCs inexistentes.
UPDATE public.organizations
   SET feature_flags = feature_flags - 'lead_owners_n_donos'
 WHERE feature_flags ? 'lead_owners_n_donos';

COMMIT;
