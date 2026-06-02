-- 20261117000000_security_reconcile_anon_write_grants.sql
--
-- Reconciliation (issue #640): bring the repo in line with the anon grant
-- hardening that was applied LIVE to prod during the 2026-06-01 tenant-isolation
-- incident but never captured by a migration. A fresh `db push` to a clean env
-- (dev mirror) must reproduce prod's hardened grant state.
--
-- main already has the per-policy / per-function security work (20261013/14/15/16,
-- 20261114*, 20261115, 20261116, ...). The pieces still MISSING from the repo:
--   (1) the blanket revoke of anon table WRITES + a default-privilege block so new
--       tables don't re-grant (anon held INSERT/UPDATE/DELETE on 213 tables);
--   (2) a class-based anon/PUBLIC EXECUTE revoke covering EVERY org-param and
--       writer SECURITY DEFINER function (the repo only revokes specific named fns);
--   (3) deny-all for anon on secret/credential tables.
--
-- Fully idempotent (REVOKE / ALTER DEFAULT PRIVILEGES / GRANT). Safe to re-run and
-- safe where main's other migrations already cover part of it.

-- (1) anon table writes ------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon;

-- (2) class-based anon/PUBLIC EXECUTE revoke on org-param + writer DEFINER fns --
DO $$
DECLARE r record;
BEGIN
  -- org-param readers/writers: keep authenticated (UI) + service_role (cron)
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND (pg_get_function_arguments(p.oid) ILIKE '%p_org_id%'
        OR pg_get_function_arguments(p.oid) ILIKE '%p_organization_id%'
        OR pg_get_function_arguments(p.oid) ILIKE '%org_id %')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;

  -- every anon-executable SECURITY DEFINER writer (triggers unaffected; keep auth+sr)
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND pg_get_functiondef(p.oid) ~* '(INSERT INTO|UPDATE |DELETE FROM)'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;

-- transfer_lead_to_human is unguarded + edge-only -> service_role only
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'transfer_lead_to_human'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- (3) secret/credential tables: anon deny-all (mirror whatsapp_instance_secrets) -
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['api_keys','email_accounts','google_calendar_tokens',
                           'meta_connections','tinyerp_connections','whatsapp_rate_tracking']
  LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END IF;
  END LOOP;
END $$;
