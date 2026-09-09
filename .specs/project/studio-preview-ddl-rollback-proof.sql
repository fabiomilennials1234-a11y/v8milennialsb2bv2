-- psql, CI/preview only. Execute the paired rollback and reapply, then undo rehearsal.
BEGIN;
CREATE TEMP TABLE studio_rollback_before ON COMMIT DROP AS
SELECT id, to_jsonb(p) AS snapshot FROM public.metrics_studio_panels p;
\ir ../../supabase/migrations/rollback/20271017113742_dashboards_viram_templates.sql
DO $$ BEGIN
  IF to_regprocedure('public._metrics_studio_factory_templates()') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'seed_metrics_studio_templates_after_org_insert') THEN
    RAISE EXCEPTION 'Rollback left template DDL installed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM studio_rollback_before b FULL JOIN public.metrics_studio_panels p USING (id)
    WHERE b.snapshot IS DISTINCT FROM to_jsonb(p)
  ) THEN RAISE EXCEPTION 'DDL rollback changed a saved panel'; END IF;
END $$;
\ir ../../supabase/migrations/20271017113742_dashboards_viram_templates.sql
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM studio_rollback_before b FULL JOIN public.metrics_studio_panels p USING (id)
    WHERE b.snapshot IS DISTINCT FROM to_jsonb(p)
  ) THEN RAISE EXCEPTION 'DDL reapply changed a saved panel'; END IF;
END $$;
ROLLBACK;
SELECT 'PASS: executed DDL rollback and reapply preserve every panel' AS result;
