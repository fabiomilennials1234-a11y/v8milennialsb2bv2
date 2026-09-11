-- Explicit CTO authorization required. One-shot, never overwrite an old snapshot.
-- Keeps customer configuration inside the database backup domain, not on a laptop.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.metrics_studio_panels, public.metric_custom_definitions IN SHARE MODE;
CREATE SCHEMA IF NOT EXISTS backup;
CREATE TABLE backup.metrics_studio_panels_20260908 AS TABLE public.metrics_studio_panels;
CREATE TABLE backup.metric_custom_definitions_20260908 AS TABLE public.metric_custom_definitions;
ALTER TABLE backup.metrics_studio_panels_20260908 ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup.metric_custom_definitions_20260908 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE backup.metrics_studio_panels_20260908, backup.metric_custom_definitions_20260908
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE backup.metrics_studio_panels_20260908 IS 'Before metrics templates rollout #2040. Preserve until CTO approves retention cleanup. Restore only reviewed IDs.';
COMMENT ON TABLE backup.metric_custom_definitions_20260908 IS 'Custom metric definitions referenced by the #2040 pre-rollout panel snapshots. No API access.';
DO $verify$
DECLARE target text; principal text;
BEGIN
  FOREACH target IN ARRAY ARRAY['backup.metrics_studio_panels_20260908', 'backup.metric_custom_definitions_20260908'] LOOP
    FOREACH principal IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF has_table_privilege(principal, target, 'SELECT,INSERT,UPDATE,DELETE') THEN
        RAISE EXCEPTION 'Backup exposed: % can access %', principal, target;
      END IF;
    END LOOP;
  END LOOP;
END;
$verify$;
SELECT now() AS captured_at,
       (SELECT count(*) FROM backup.metrics_studio_panels_20260908) AS panels,
       (SELECT count(*) FROM backup.metric_custom_definitions_20260908) AS custom_definitions;
COMMIT;
