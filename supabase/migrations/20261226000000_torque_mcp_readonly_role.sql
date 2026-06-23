-- 20261226000000_torque_mcp_readonly_role.sql
--
-- Torque MCP S3 — db.read_sql containment.
--
-- Creates a dedicated, write-incapable role `mcp_readonly` and a SECURITY DEFINER RPC
-- `mcp_exec_readonly_sql` that runs an arbitrary caller-supplied SELECT *as that role*,
-- inside a READ ONLY transaction with a statement timeout. Containment is layered:
--   1. master-only: the RPC refuses non-master callers (is_master_user()).
--   2. parse guard: single statement, must start with SELECT/WITH (mirrors the edge guard).
--   3. role: mcp_readonly has SELECT only — never INSERT/UPDATE/DELETE/DDL — and SELECT is
--      revoked on secret/credential/token tables, so it physically cannot read them.
--   4. txn: SET TRANSACTION READ ONLY blocks any write at the engine level.
--   5. timeout: statement_timeout bounds runaway queries.
--
-- BYPASSRLS is intentional: this is an internal ops/diagnostic tool used by the ops-master,
-- so cross-org visibility is the goal — but the secret-table revokes are the hard wall.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_readonly') THEN
    CREATE ROLE mcp_readonly NOLOGIN BYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO mcp_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mcp_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO mcp_readonly;

-- Hard wall: revoke SELECT on any secret/credential/token table (self-maintaining by name).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename ~* '(secret|credential|token|password)'
  LOOP
    EXECUTE format('REVOKE SELECT ON public.%I FROM mcp_readonly', r.tablename);
  END LOOP;
END
$$;

-- Belt-and-suspenders explicit revokes for the two known secret tables.
DO $$
BEGIN
  IF to_regclass('public.whatsapp_instance_secrets') IS NOT NULL THEN
    EXECUTE 'REVOKE SELECT ON public.whatsapp_instance_secrets FROM mcp_readonly';
  END IF;
  IF to_regclass('public.google_calendar_tokens') IS NOT NULL THEN
    EXECUTE 'REVOKE SELECT ON public.google_calendar_tokens FROM mcp_readonly';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.mcp_exec_readonly_sql(
  p_sql text,
  p_max_rows integer DEFAULT 1000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_result jsonb;
  v_clean text := btrim(p_sql);
  v_rows int := greatest(1, least(coalesce(p_max_rows, 1000), 5000));
BEGIN
  -- 1. master-only
  IF NOT public.is_master_user() THEN
    RAISE EXCEPTION 'mcp_exec_readonly_sql: master only';
  END IF;

  -- 2. parse guard (mirror of the edge-side isReadOnlySql)
  v_clean := btrim(regexp_replace(v_clean, ';+\s*$', ''));  -- strip a trailing ';'
  IF v_clean = '' THEN
    RAISE EXCEPTION 'empty query';
  END IF;
  IF position(';' IN v_clean) > 0 THEN
    RAISE EXCEPTION 'only a single statement is allowed';
  END IF;
  IF lower(v_clean) !~ '^(select|with)\s' THEN
    RAISE EXCEPTION 'only SELECT / WITH read-only queries are allowed';
  END IF;

  -- 3+4+5. contained execution.
  -- The function is OWNED BY mcp_readonly (see ALTER below) and SECURITY DEFINER, so the whole
  -- body already runs AS mcp_readonly — no SET ROLE (which Postgres forbids inside a
  -- security-definer function). The role's SELECT-only grants + secret-table revokes are the wall.
  SET LOCAL TRANSACTION READ ONLY;
  SET LOCAL statement_timeout = '5000';

  EXECUTE format(
    'SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (SELECT * FROM (%s) _q LIMIT %s) t',
    v_clean,
    v_rows
  )
  INTO v_result;

  RETURN v_result;
END
$$;

COMMENT ON FUNCTION public.mcp_exec_readonly_sql(text, integer) IS
  'Torque MCP db.read_sql — runs a single read-only SELECT as mcp_readonly in a READ ONLY txn. Master-only.';

-- Set privileges while the migration runner still owns the function, then transfer ownership.
REVOKE ALL ON FUNCTION public.mcp_exec_readonly_sql(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_exec_readonly_sql(text, integer) TO authenticated, service_role;

-- The migration runner needs SET-capable membership in mcp_readonly to reassign ownership to it
-- (PG16). INHERIT FALSE so the runner does not silently absorb the role's BYPASSRLS.
DO $$
BEGIN
  EXECUTE format('GRANT mcp_readonly TO %I WITH INHERIT FALSE, SET TRUE', current_user);
EXCEPTION
  WHEN OTHERS THEN NULL;  -- already a member, or grant not needed
END
$$;

-- Owner = mcp_readonly so the SECURITY DEFINER body executes with that role's privileges
-- (SELECT-only, secret tables revoked) without an in-function SET ROLE (which PG forbids there).
ALTER FUNCTION public.mcp_exec_readonly_sql(text, integer) OWNER TO mcp_readonly;
