-- Roll this migration back BEFORE strict_lead_owner_access.
DO $rollback$
DECLARE r record; v_oid oid;
BEGIN
  FOR r IN SELECT * FROM private.strict_lead_rpc_restore LOOP
    v_oid:=to_regprocedure(r.signature);
    IF v_oid IS NULL OR pg_get_functiondef(v_oid)<>r.hardened_definition THEN
      RAISE EXCEPTION 'RPC changed after rollout; review before restoring: %',r.signature;
    END IF;
    EXECUTE r.original_definition;
  END LOOP;
  FOR r IN SELECT * FROM private.strict_lead_scope_manifest LOOP
    IF r.added_policy THEN
      EXECUTE format('DROP POLICY strict_owner_related_select ON public.%I',r.relation_name);
    END IF;
    EXECUTE format('DROP VIEW private.%I',r.relation_name);
  END LOOP;
END $rollback$;
DROP TABLE private.strict_lead_rpc_restore;
DROP TABLE private.strict_lead_scope_manifest;
DROP FUNCTION private.strict_lead_owned_by(uuid,uuid,uuid);
DROP FUNCTION private.strict_lead_ref_visible(uuid);
DROP FUNCTION private.strict_channel_visible(uuid,uuid,text,text,text);
DROP FUNCTION private.strict_phone_visible(uuid,uuid,text);
