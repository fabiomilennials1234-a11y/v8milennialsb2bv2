-- 20261117000010_pin_search_path_all_security_definer.sql
--
-- ISSUE #648 — pin search_path on EVERY SECURITY DEFINER function in schema public.
--
-- WHY (search_path injection risk)
-- --------------------------------------------------------------------------
-- A SECURITY DEFINER function runs with the privileges of its OWNER (here:
-- postgres / supabase_admin), not the caller. If such a function does NOT pin
-- its search_path, it resolves unqualified object names (tables, functions,
-- operators, casts) using the *caller's* runtime search_path. A hostile but
-- low-privileged caller can prepend a schema they own (or simply create
-- objects in a writable schema that appears earlier in resolution) and shadow
-- a built-in or public object — e.g. a malicious `now()`, a fake `leads`
-- table, or a trojan operator. The DEFINER function then executes that object
-- with elevated privileges => privilege escalation / RLS bypass / data theft.
--
-- Pinning `search_path = public, pg_temp` makes name resolution deterministic
-- and independent of the caller. pg_temp is placed LAST (Postgres always
-- searches pg_temp first if it is not listed explicitly, which is itself an
-- attack vector via temp-table shadowing; listing it last neutralizes that).
--
-- WHY THIS IS BODY-SAFE
-- --------------------------------------------------------------------------
-- `ALTER FUNCTION ... SET search_path = ...` only attaches a per-function GUC
-- (stored in pg_proc.proconfig). It does NOT parse, recompile, or alter the
-- function body, signature, ownership, volatility, or permissions. Behavior is
-- unchanged for any function that already qualifies its objects or assumes the
-- public schema — which is the case across this codebase (objects live in
-- public). It only removes the *ability* for a caller to redirect resolution.
--
-- WHY THIS SWEEP (vs. the earlier hand-written list)
-- --------------------------------------------------------------------------
-- 20261014000000_security_definer_search_path.sql pinned an earlier subset by
-- name. This migration is CATALOG-DRIVEN: it reads pg_proc/pg_namespace at
-- apply time and pins whatever SECURITY DEFINER functions are still missing a
-- search_path entry. New unpinned DEFINER functions added since then are
-- swept automatically; already-pinned ones are skipped.
--
-- IDEMPOTENCY
-- --------------------------------------------------------------------------
-- The loop only targets functions where `prosecdef = true` AND proconfig has
-- NO `search_path=...` element. After the ALTER runs, proconfig gains a
-- `search_path=...` element, so on any re-run the same function no longer
-- matches the WHERE clause => zero rows selected => no-op. Re-running the whole
-- migration is therefore a guaranteed no-op (nothing to alter, nothing to
-- undo). Overloads are handled because we iterate by oid and emit the exact
-- signature via `oid::regprocedure`.

DO $$
DECLARE
  r record;
  v_count int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      -- skip functions that ALREADY have a search_path pinned (in any form:
      -- `search_path=public`, `search_path="$user", public`, etc.)
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS cfg
        WHERE cfg ILIKE 'search_path=%'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path = public, pg_temp',
      r.sig
    );
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'pin_search_path: pinned % SECURITY DEFINER function(s) in schema public', v_count;
END;
$$;
