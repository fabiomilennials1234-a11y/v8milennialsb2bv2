SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='60s';
-- Performance fix for 20271117000102 (prod 2026-10-13 15:31 UTC).
--
-- strict_phone_visible / strict_channel_visible / strict_lead_ref_visible are
-- SQL SECURITY DEFINER, so the planner never inlines them: every scanned row
-- paid a function call plus a fresh strict_lead_member_orgs() evaluation, even
-- in organizations without the flag. Chat RPCs (get_unread_counts,
-- get_whatsapp_conversation_list_multi, ...) went from p50 ~40 ms to the 15 s
-- statement timeout for every tenant.
--
-- Fix: strict_lead_member_orgs() is evaluated once per statement as an
-- uncorrelated scalar subquery (InitPlan) and handed to the row check.
--   * Relations with organization_id: the first disjunct of
--     strict_phone_visible / strict_channel_visible is hoisted into the
--     predicate, so rows of non-strict organizations never reach the call.
--   * Relations keyed only by lead_id: strict_lead_member_orgs() lists every
--     flagged organization the caller does not administer (not only the
--     caller's own), so it is non-empty for almost everyone. Those rows call
--     strict_lead_ref_visible_in(lead, strict_orgs), which is
--     strict_lead_ref_visible with the array passed in: one leads PK lookup.
-- Semantics are identical to 20271117000102; views and RESTRICTIVE policies
-- come from the same manifest, so both read paths get the same predicate.

CREATE OR REPLACE FUNCTION private.strict_lead_ref_visible_in(p_lead uuid, p_strict_orgs uuid[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT cardinality(p_strict_orgs)=0 OR NOT EXISTS (
    SELECT 1 FROM public.leads l WHERE l.id=p_lead
      AND l.organization_id=ANY(p_strict_orgs)
      AND NOT private.strict_lead_is_owned(l.organization_id,l.id)
  )
$$;
REVOKE ALL ON FUNCTION private.strict_lead_ref_visible_in(uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.strict_lead_ref_visible_in(uuid,uuid[]) TO authenticated,service_role;

DO $guard$
DECLARE
  r record;
  v_strict constant text := '(SELECT private.strict_lead_member_orgs())::uuid[]';
  v_col text;
  v_new text;
BEGIN
  FOR r IN
    SELECT m.relation_name, m.predicate, m.added_policy
    FROM private.strict_lead_scope_manifest m
    WHERE m.predicate ~ '^private\.strict_(phone|channel|lead_ref)_visible\('
  LOOP
    IF r.predicate ~ '^private\.strict_(phone|channel)_visible\(organization_id,' THEN
      v_new := format('NOT (organization_id=ANY(%s)) OR (%s)', v_strict, r.predicate);
    ELSE
      v_col := substring(r.predicate FROM '^private\.strict_lead_ref_visible\(([a-z_]+)\)$');
      IF v_col IS NULL THEN
        RAISE EXCEPTION 'Unexpected strict predicate on %: %', r.relation_name, r.predicate;
      END IF;
      v_new := format('private.strict_lead_ref_visible_in(%I,%s)', v_col, v_strict);
    END IF;

    EXECUTE format(
      'CREATE OR REPLACE VIEW private.%I WITH (security_invoker=true) AS SELECT * FROM public.%I WHERE %s',
      r.relation_name, r.relation_name, v_new);
    IF r.added_policy THEN
      EXECUTE format(
        'ALTER POLICY strict_owner_related_select ON public.%I USING (%s)',
        r.relation_name, v_new);
    END IF;
    UPDATE private.strict_lead_scope_manifest
      SET predicate = v_new WHERE relation_name = r.relation_name;
  END LOOP;
END $guard$;
