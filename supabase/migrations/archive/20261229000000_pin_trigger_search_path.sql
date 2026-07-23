-- 20261229000000_pin_trigger_search_path.sql
--
-- (Re-timestamped from 20261228000000 to resolve a version collision: a parallel
--  migration 20261228000000_disparo_audience_rpcs_master_branch.sql took that version
--  and was already applied to prod. Same content; new version so both register.)
--
-- Security/robustness hardening: pin search_path on every TRIGGER function in public
-- that does not already pin it.
--
-- Why
--   This closes the rest of the "42883 unqualified call under a hardened caller" class.
--   A trigger function with no pinned search_path runs unqualified name resolution against
--   the search_path of whatever statement fired it. Normal DML (PostgREST) has public in the
--   path, so it works — but a SECURITY DEFINER RPC that runs with `SET search_path = ''`
--   (e.g. bulk_delete_leads, restore_lead) fires these same triggers under an empty path, and
--   any unqualified public reference then fails with 42883 and aborts the whole operation.
--   That is exactly the leads_derive_uf_from_ddd outage (fixed in 20261224000000); this pins
--   the remaining unpinned trigger functions so the class cannot recur on another path.
--
--   The companion 20261227000000 covered SECURITY DEFINER functions (prosecdef=true). That
--   audit missed these because they are non-definer trigger functions — surfaced by running
--   the real lead delete/restore path against prod, which broke on a non-definer trigger.
--   Sweep at authoring time: 35 unpinned trigger functions on prod, 0 referencing any non-
--   public schema, so `public, extensions` preserves every resolution that works today.
--
-- Why `public, extensions` (and NOT '')
--   Keeping `public` means the leads_uf failure mode (an empty pin that removed public and
--   broke unqualified references) cannot recur, while the path is now FIXED regardless of the
--   firing statement. pg_catalog is always searched first implicitly; extensions covers
--   unqualified extension functions.
--
-- Mechanics
--   ALTER FUNCTION ... SET search_path does not change function bodies and is reversible
--   (RESET search_path). Dynamic + idempotent (only unpinned trigger functions; already-pinned
--   ones — including the definer triggers pinned by 20261227000000 — are skipped), adapts to
--   each database, per-function guarded so one un-alterable function cannot abort the run.

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
      AND p.prorettype = 'pg_catalog.trigger'::regtype
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
      RAISE NOTICE 'pin_trigger_search_path: skipped % (%)', r.sig, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'pin_trigger_search_path: pinned=%, skipped=%', pinned, skipped;
END
$$;
