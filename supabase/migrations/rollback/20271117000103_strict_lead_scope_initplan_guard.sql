-- Roll this migration back BEFORE 20271117000102. Restores the per-row predicates.
DO $rollback$
DECLARE r record; v_old text;
BEGIN
  FOR r IN SELECT relation_name, predicate, added_policy FROM private.strict_lead_scope_manifest LOOP
    IF r.predicate ~ '^NOT \(organization_id=ANY\(\(SELECT private\.strict_lead_member_orgs\(\)\)::uuid\[\]\)\) OR \(private\.strict_(phone|channel)_visible\(' THEN
      -- The guard has no " OR (" of its own: strip it and the wrapping parentheses.
      v_old := left(substr(r.predicate, position(' OR (' IN r.predicate) + 5), -1);
    ELSIF r.predicate ~ '^private\.strict_lead_ref_visible_in\(' THEN
      v_old := format('private.strict_lead_ref_visible(%s)',
        substring(r.predicate FROM '^private\.strict_lead_ref_visible_in\(([a-z_]+),'));
    ELSE
      CONTINUE;
    END IF;
    EXECUTE format(
      'CREATE OR REPLACE VIEW private.%I WITH (security_invoker=true) AS SELECT * FROM public.%I WHERE %s',
      r.relation_name, r.relation_name, v_old);
    IF r.added_policy THEN
      EXECUTE format('ALTER POLICY strict_owner_related_select ON public.%I USING (%s)',
        r.relation_name, v_old);
    END IF;
    UPDATE private.strict_lead_scope_manifest SET predicate = v_old WHERE relation_name = r.relation_name;
  END LOOP;
END $rollback$;
DROP FUNCTION private.strict_lead_ref_visible_in(uuid,uuid[]);
