-- 20261230000000_grant_mcp_readonly_schema_migrations.sql
--
-- Torque MCP S6 — migration.diff prerequisite.
--
-- The `mcp_readonly` role (20261226000000) only has USAGE/SELECT in `public`. The migration.diff
-- tool reads the applied-migrations ledger at `supabase_migrations.schema_migrations`, which lives
-- OUTSIDE public, so the read fails with "permission denied for schema supabase_migrations" without
-- these grants.
--
-- Scope is deliberately narrow: USAGE on the schema + SELECT on the single ledger table. No PII, no
-- secret, no credential — `schema_migrations` holds only version prefixes and migration names, so
-- this does not touch the read-only role's secret-table hard wall.
--
-- Idempotent: GRANT is repeatable; the role/table existence is guarded so the migration is a no-op
-- if either is absent (e.g. a fresh DB before the S3 role migration ran).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_readonly')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'supabase_migrations')
  THEN
    EXECUTE 'GRANT USAGE ON SCHEMA supabase_migrations TO mcp_readonly';

    IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
      EXECUTE 'GRANT SELECT ON supabase_migrations.schema_migrations TO mcp_readonly';
    END IF;
  END IF;
END
$$;
