-- 20271107150000_leads_select_rls_initplan.sql
--
-- Leads RLS: per-row DEFINER calls → InitPlans (same semantics, same rows).
--
-- WHY
--   Prod fell over (OOM, 2026-10-05) because the SELECT policy on leads called
--   SECURITY DEFINER plpgsql/sql functions PER ROW: has_feature_permission,
--   is_user_responsible, can_see_lead_by_permissions (which itself fans out to
--   is_user_responsible/has_no_responsible/is_responsible_in_same_org/
--   user_has_org_permission/has_feature_permission) and
--   is_user_responsible_in_any_pipe. A restricted member scanning an org paid
--   15–30 SPI queries per non-matching row. Every SELECT on leads pays it,
--   including get_pipeline_page (SECURITY INVOKER).
--
-- MEASURED in prod (2026-10-06, read-only, EXPLAIN ANALYZE as authenticated
-- with request.jwt.claims; pg_stat_statements since 2026-10-05 15:55 UTC):
--   * 50.2% of total exec time is statements on leads; top one (PostgREST list
--     + exact count) mean 7.1 s.
--   * count(*) of one org's list (13k leads) as a restricted member: 18,088 ms,
--     876k buffer hits, 852 rows kept / 12,132 removed by the policy filter;
--     the same query as that org's admin: 20 ms (is_user_admin short-circuits).
--   * same query with this file's expression inlined (pipe probe still the old
--     2-query plpgsql function = upper bound): 463 ms, 77k buffers, same 852 rows.
--   All 16 functions involved were already STABLE SECURITY DEFINER: volatility
--   is not the cause; DEFINER functions are never inlined, so each call per row
--   is a full SPI round trip.
--
-- WHAT
--   * 4 new helpers (SQL, STABLE, SECURITY DEFINER, search_path pinned to '',
--     EXECUTE only for authenticated). They depend only on auth.uid(), never on
--     the row, so the policy wraps them in (SELECT …) → one InitPlan per
--     statement instead of one call per row.
--   * ALTER POLICY (atomic) on
--       leads_select_by_responsibility_and_permissions
--       leads_update_by_responsibility_and_permissions
--     rewriting only the expression; TO authenticated instead of public.
--   * No existing function, grant, index or other policy is touched.
--
-- SEMANTICS — copied literally from prod (2026-10-05, pg_get_functiondef md5
-- in the rollback file), including two rules that look wrong and are tracked
-- as separate follow-ups, NOT fixed here:
--   - has_feature_permission('leads.view_all') with ONE argument resolves the
--     user's OLDEST active org; if it grants view_all there, the user sees every
--     lead of every org they belong to (term kept verbatim below).
--   - is_user_responsible(...) ignores team_members.is_active and org; the
--     "my team member ids" set used below therefore has p_active_only = false.
--
--   Term-by-term mapping (old, per row → new):
--     has_feature_permission('leads.view_all', organization_id)
--       → organization_id = ANY((SELECT rls_my_orgs_with_feature('leads.view_all')))
--         (array = orgs o ∈ get_my_organization_ids() with
--          has_feature_permission(key, o); the outer org gate already restricts
--          the row to that same set, so the result is identical)
--     is_user_responsible(pre, sale)
--       → pre = ANY(T) OR sale = ANY(T),       T = rls_my_team_member_ids(false)
--     can_see_lead_by_permissions(sdr, closer) =
--       is_user_responsible(sdr, closer, NULL)
--         → sdr = ANY(T) OR closer = ANY(T)
--       OR has_no_responsible(sdr, closer, NULL) AND user_has_org_permission('see_unassigned_cards')
--         → sdr IS NULL AND closer IS NULL AND (SELECT user_has_org_permission(...))
--       OR is_responsible_in_same_org(sdr, closer) AND user_has_org_permission('see_subordinates_cards')
--         → (SELECT user_has_org_permission(...)) AND (sdr = ANY(S) OR closer = ANY(S)),
--           S = rls_my_same_org_team_member_ids()
--       OR has_feature_permission('leads.view_all')            (1 arg)
--         → (SELECT has_feature_permission('leads.view_all'))
--     is_user_responsible_in_any_pipe(id)
--       → cardinality(A) > 0 AND rls_lead_in_my_pipes(id, A),
--         A = rls_my_team_member_ids(true)  (active only, as the old function)
--
--   NULL vs false: `NULL = ANY(T)` is NULL where the old function returned
--   false. A policy (USING, and the implicit WITH CHECK of the UPDATE policy)
--   admits a row only when the expression is TRUE, so NULL ≡ false here. The
--   equivalence suite compares COALESCE(old,false) = COALESCE(new,false) per row
--   and the exact visible id set per user.
--
--   OR order: scalars/org first → column comparisons → the only per-row probe
--   (pipeline_entries) last, so it runs only when nothing else matched.
--
-- ROLES — TO authenticated vs public: every role that holds SELECT/UPDATE on
-- leads in prod other than authenticated is BYPASSRLS (postgres, service_role,
-- mcp_readonly, supabase_admin, supabase_etl_admin, supabase_read_only_user;
-- pg_read_all_data/pg_write_all_data have only bypassrls members). anon has no
-- grant on leads. So the effective rule is unchanged for every existing role,
-- and anon's query no longer even expands this expression.
--
-- LOCK — ALTER POLICY takes ACCESS EXCLUSIVE on leads. lock_timeout 3s below:
-- if it cannot get the lock it aborts cleanly (retry). Apply OFF-PEAK (not the
-- 08:00–11:00 BRT morning peak).
--
-- ROLLBACK — supabase/migrations/rollback/20271107150000_leads_select_rls_initplan.sql
-- (restores the literal prod policy bodies and drops the 4 helpers).
--
-- TIMESTAMP is provisional: renumber against the prod ledger when applying.

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- My team_member ids. p_active_only = false → every row of mine (mirrors
-- is_user_responsible, which ignores is_active). NULL is treated as true
-- (smaller set: fail closed).
CREATE FUNCTION public.rls_my_team_member_ids(p_active_only boolean)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT ARRAY(
    SELECT tm.id
    FROM public.team_members tm
    WHERE tm.user_id = auth.uid()
      AND (p_active_only IS FALSE OR tm.is_active)
    ORDER BY tm.id
  )
$function$;

-- Every team_member id that shares an organization with ANY of my team_member
-- rows (active or not) — the set is_responsible_in_same_org(sdr, closer) tests.
CREATE FUNCTION public.rls_my_same_org_team_member_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT ARRAY(
    SELECT tm_resp.id
    FROM public.team_members tm_resp
    WHERE tm_resp.organization_id IN (
      SELECT tm_user.organization_id
      FROM public.team_members tm_user
      WHERE tm_user.user_id = auth.uid()
    )
    ORDER BY tm_resp.id
  )
$function$;

-- Orgs I can reach (get_my_organization_ids) where the 2-arg
-- has_feature_permission grants p_feature_key. One call per org, not per row.
CREATE FUNCTION public.rls_my_orgs_with_feature(p_feature_key text)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT ARRAY(
    SELECT o.org_id
    FROM public.get_my_organization_ids() AS o(org_id)
    WHERE public.has_feature_permission(p_feature_key, o.org_id)
    ORDER BY o.org_id
  )
$function$;

-- Same EXISTS as is_user_responsible_in_any_pipe(p_lead_id), same 6 keys, same
-- order, same ::uuid casts — over p_tm_ids INTERSECTED with my active
-- team_member ids. The intersection is mandatory: without it this DEFINER
-- function would be an oracle ("does lead X have a pipeline entry assigned to
-- team member Y?") for any Y the caller passes. The ownership probe only runs
-- for keys that already matched p_tm_ids, so a non-matching lead costs one
-- index probe on pipeline_entries(lead_id).
CREATE FUNCTION public.rls_lead_in_my_pipes(p_lead_id uuid, p_tm_ids uuid[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.pipeline_entries pe
    CROSS JOIN LATERAL (
      VALUES
        (pe.assigned_to),
        ((pe.metadata->>'sdr_id')::uuid),
        ((pe.metadata->>'responsible_id')::uuid),
        ((pe.metadata->>'closer_id')::uuid),
        ((pe.metadata->>'pre_sale_responsible_id')::uuid),
        ((pe.metadata->>'sale_responsible_id')::uuid)
    ) AS k(tm_id)
    WHERE pe.lead_id = p_lead_id
      AND k.tm_id = ANY (p_tm_ids)
      AND EXISTS (
        SELECT 1
        FROM public.team_members tm
        WHERE tm.id = k.tm_id
          AND tm.user_id = auth.uid()
          AND tm.is_active = true
      )
  )
$function$;

-- Default privileges in this project grant EXECUTE on new functions to anon,
-- authenticated and service_role by name; REVOKE FROM PUBLIC alone does not
-- reach those. Only authenticated evaluates these policies.
REVOKE ALL ON FUNCTION public.rls_my_team_member_ids(boolean)      FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.rls_my_same_org_team_member_ids()    FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.rls_my_orgs_with_feature(text)       FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.rls_lead_in_my_pipes(uuid, uuid[])   FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.rls_my_team_member_ids(boolean)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.rls_my_same_org_team_member_ids()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rls_my_orgs_with_feature(text)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.rls_lead_in_my_pipes(uuid, uuid[]) TO authenticated;

COMMENT ON FUNCTION public.rls_my_team_member_ids(boolean) IS
  'RLS helper (leads). Caller''s team_member ids; false = all rows (mirrors is_user_responsible), true = active only. Use as (SELECT …) InitPlan.';
COMMENT ON FUNCTION public.rls_my_same_org_team_member_ids() IS
  'RLS helper (leads). Team member ids sharing an org with any of the caller''s team_member rows (mirrors is_responsible_in_same_org). Use as (SELECT …) InitPlan.';
COMMENT ON FUNCTION public.rls_my_orgs_with_feature(text) IS
  'RLS helper (leads). Orgs in get_my_organization_ids() where has_feature_permission(key, org). Use as (SELECT …) InitPlan.';
COMMENT ON FUNCTION public.rls_lead_in_my_pipes(uuid, uuid[]) IS
  'RLS helper (leads). is_user_responsible_in_any_pipe over p_tm_ids ∩ caller''s active team_member ids (intersection closes the DEFINER oracle).';

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
-- `col = ANY ((SELECT f())::uuid[])`: the cast is load-bearing. Without it the
-- parser reads `ANY ((SELECT …))` as the subquery form of ANY (compare col to
-- each ROW, i.e. uuid = uuid[] → error). With it, the scalar subquery is one
-- InitPlan and ANY scans the array.

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

COMMENT ON POLICY "leads_select_by_responsibility_and_permissions" ON public.leads IS
  'Tenant membership plus responsibility/permission visibility. Gestores read every Lead only inside organizations explicitly bound through gestor_organizations (ADR-0021). Row-independent checks run once per statement as InitPlans (20271107150000); semantics identical to the per-row function version.';

-- WITH CHECK stays NULL on purpose: the UPDATE policy keeps using USING as the
-- new-row check, exactly as in prod. No gestor branch (literal copy).
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

COMMIT;
