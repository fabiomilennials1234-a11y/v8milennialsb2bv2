-- 20261227000000_pin_definer_search_path.sql
--
-- Security hardening: pin search_path on every SECURITY DEFINER function in public
-- that does not already pin it.
--
-- Why
--   A SECURITY DEFINER function with a mutable search_path runs unqualified name
--   resolution against the CALLER's search_path. That is:
--     1. a privilege-escalation surface (an attacker prepends a schema with a
--        malicious object that shadows an unqualified reference), and
--     2. the cause of the recurring "42883 unqualified call under empty search_path"
--        incidents (e.g. the leads_derive_uf_from_ddd trigger break — a caller running
--        with search_path='' could not resolve unqualified names).
--   Surfaced by the torque-mcp schema.audit_definer tool: 58 such functions on prod.
--
-- Why `public, extensions` (and NOT '')
--   The leads_uf incident was caused by pinning to '' (empty) — that removed `public`
--   and broke unqualified references. `public, extensions` KEEPS public, so that failure
--   mode cannot recur, while still closing the hijack (the path is now FIXED regardless of
--   caller). pg_catalog is always searched first implicitly. Cross-schema references in
--   these functions (net.*, auth.*, cron.*, vault.*) are already schema-qualified, so they
--   resolve regardless of search_path; only unqualified public/extension objects depend on
--   the path, and both schemas are present.
--
-- Mechanics
--   ALTER FUNCTION ... SET search_path does not change function bodies — only the resolution
--   context. It is idempotent here (only unpinned functions are touched) and adapts to each
--   database (dev/prod have different function sets), so no hardcoded signature list to drift.
--   Each ALTER is guarded so one un-alterable function cannot abort the whole migration.

DO $$
DECLARE
  r record;
  pinned int := 0;
  skipped int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.prosecdef = true
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) c
        WHERE c LIKE 'search_path=%'
      )
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', r.sig);
      pinned := pinned + 1;
    EXCEPTION WHEN OTHERS THEN
      skipped := skipped + 1;
      RAISE NOTICE 'pin_definer_search_path: skipped % (%)', r.sig, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'pin_definer_search_path: pinned=%, skipped=%', pinned, skipped;
END
$$;
