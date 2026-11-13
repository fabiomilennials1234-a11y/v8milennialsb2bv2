-- Local integration database only: production stores leads in private.leads,
-- whereas the clean baseline still creates the underlying table in public.
-- Preserve the production can_view_lead implementation and test every access
-- outcome against the same seeded rows; do not replace the RPC or skip tests.
DO $$
BEGIN
  IF current_setting('app.ci_local_fixture', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'This fixture requires the explicit local CI guard';
  END IF;
  IF to_regclass('private.leads') IS NULL THEN
    CREATE SCHEMA IF NOT EXISTS private;
    CREATE VIEW private.leads WITH (security_invoker = true) AS SELECT * FROM public.leads;
    REVOKE ALL ON private.leads FROM PUBLIC, anon, authenticated;
  END IF;
END $$;
