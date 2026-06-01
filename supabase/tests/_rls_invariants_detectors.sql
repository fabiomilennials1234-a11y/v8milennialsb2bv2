-- supabase/tests/_rls_invariants_detectors.sql
--
-- Shared catalog detectors for the RLS tenant-isolation invariant suite (issue #638).
--
-- Defines four SECURITY INVOKER set-returning functions, one per invariant. Each
-- returns the *violating* rows (empty set == invariant holds). Both the clean
-- suite (rls_invariants.sql) and the deliberately-bad RED fixture
-- (rls_invariants_red_fixture.sql) call these exact functions, so the assertion
-- logic is identical across green and red proofs.
--
-- Scope: schema `public` only (where the multi-tenant model lives). Idempotent:
-- every function is CREATE OR REPLACE and self-contained. Loading this file has
-- no side effects beyond defining functions in a temp-friendly namespace.
--
-- These live in schema `public` under a `_rls_inv_` prefix so pgTAP (which runs
-- in the same session) can reference them. They are test-only helpers; they are
-- never created by a migration and therefore never ship to prod.

-- ---------------------------------------------------------------------------
-- Invariant 1 — No table with an organization_id column has any RLS policy
-- whose roles include public/anon/authenticated AND whose USING qual is the
-- literal `true` (or whose WITH CHECK is the literal `true`).
--
-- A `true` qual on a broad role is a tenant-isolation hole: it lets any logged
-- in user (or anon) read/write every org's rows. Service-role-only policies
-- (roles = {service_role}) are intentionally permissive and are NOT flagged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._rls_inv_open_policies_on_org_tables()
RETURNS TABLE (
  schemaname  name,
  tablename   name,
  policyname  name,
  cmd         text,
  roles       name[],
  qual        text,
  with_check  text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_catalog'
AS $fn$
  SELECT
    p.schemaname,
    p.tablename,
    p.policyname,
    p.cmd,
    p.roles,
    p.qual,
    p.with_check
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    -- restrict to tables that actually carry a tenant key
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = p.schemaname
        AND c.table_name   = p.tablename
        AND c.column_name  = 'organization_id'
    )
    -- policy applies to a broad role (overlap with the dangerous set)
    AND (p.roles && ARRAY['public', 'anon', 'authenticated']::name[])
    -- and the predicate is unconditionally true on USING or WITH CHECK
    AND (
      btrim(lower(coalesce(p.qual, '')))       = 'true'
      OR btrim(lower(coalesce(p.with_check, ''))) = 'true'
    );
$fn$;

-- ---------------------------------------------------------------------------
-- Invariant 2 — No SECURITY DEFINER function that *writes*
-- (body matches INSERT INTO | UPDATE  | DELETE FROM) is EXECUTE-able by anon
-- or by PUBLIC.
--
-- DEFINER functions run with the owner's privileges and bypass RLS. If anon or
-- PUBLIC can execute a writing DEFINER function, that is a cross-tenant write
-- primitive. has_function_privilege evaluates the *effective* grant, which
-- includes the PUBLIC default — so a function with no explicit grants but the
-- default PUBLIC EXECUTE is correctly flagged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._rls_inv_writing_definer_exec_by_anon_or_public()
RETURNS TABLE (
  schemaname           name,
  functionname         name,
  identity_args        text,
  anon_can_execute     boolean,
  public_can_execute   boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_catalog'
AS $fn$
  SELECT
    n.nspname AS schemaname,
    pr.proname AS functionname,
    pg_get_function_identity_arguments(pr.oid) AS identity_args,
    -- anon role only exists in Supabase; guard so the check is portable
    (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
       AND has_function_privilege('anon', pr.oid, 'EXECUTE'))  AS anon_can_execute,
    -- PUBLIC default grant: probe via the catalog acl. A NULL proacl means the
    -- default (PUBLIC EXECUTE) is in force, which is itself a violation.
    (pr.proacl IS NULL
       OR EXISTS (
         SELECT 1
         FROM aclexplode(pr.proacl) ae
         WHERE ae.grantee = 0          -- 0 == PUBLIC pseudo-role
           AND ae.privilege_type = 'EXECUTE'
       )) AS public_can_execute
  FROM pg_proc pr
  JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public'
    AND pr.prosecdef = true                       -- SECURITY DEFINER
    AND pr.prokind = 'f'                           -- plain functions only
    -- Exclude trigger/event-trigger functions: they cannot be invoked via a
    -- direct EXECUTE call (they fire from a trigger as the table owner), so an
    -- EXECUTE grant on them is not a callable cross-tenant write primitive.
    -- This matches the incident-response reasoning ("trigger functions are
    -- unaffected ... they fire as definer regardless of EXECUTE grant").
    AND pr.prorettype NOT IN ('pg_catalog.trigger'::regtype, 'pg_catalog.event_trigger'::regtype)
    AND (
      -- body performs a write. Mirrors the proven incident matcher
      -- (`INSERT INTO|UPDATE |DELETE FROM`) but uses word boundaries so it does
      -- not match column names like `updated_at`.
      pr.prosrc ~* '(insert\s+into|update\s|delete\s+from)'
    )
    -- only surface the rows that are actually reachable by anon or PUBLIC
    AND (
      (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
         AND has_function_privilege('anon', pr.oid, 'EXECUTE'))
      OR pr.proacl IS NULL
      OR EXISTS (
        SELECT 1
        FROM aclexplode(pr.proacl) ae
        WHERE ae.grantee = 0
          AND ae.privilege_type = 'EXECUTE'
      )
    );
$fn$;

-- ---------------------------------------------------------------------------
-- Invariant 3 — Every table with an organization_id column has
-- relrowsecurity = true (RLS enabled). RLS disabled on a tenant table means
-- every policy is dead weight and the table is world-readable to anyone with a
-- table grant.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._rls_inv_org_tables_without_rls()
RETURNS TABLE (
  schemaname     name,
  tablename      name,
  relrowsecurity boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_catalog'
AS $fn$
  SELECT
    n.nspname AS schemaname,
    c.relname AS tablename,
    c.relrowsecurity
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'                            -- ordinary tables only
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns col
      WHERE col.table_schema = n.nspname
        AND col.table_name   = c.relname
        AND col.column_name  = 'organization_id'
    )
    AND c.relrowsecurity = false;
$fn$;

-- ---------------------------------------------------------------------------
-- Invariant 4 — Every SECURITY DEFINER function in schema public has a
-- SET search_path in proconfig. A DEFINER function without a pinned search_path
-- is hijackable: a caller can shadow an unqualified object with one in a schema
-- they control and have the owner execute it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._rls_inv_definer_without_search_path()
RETURNS TABLE (
  schemaname    name,
  functionname  name,
  identity_args text,
  proconfig     text[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_catalog'
AS $fn$
  SELECT
    n.nspname AS schemaname,
    pr.proname AS functionname,
    pg_get_function_identity_arguments(pr.oid) AS identity_args,
    pr.proconfig
  FROM pg_proc pr
  JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public'
    AND pr.prosecdef = true
    AND pr.prokind = 'f'
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(coalesce(pr.proconfig, ARRAY[]::text[])) AS cfg
      WHERE cfg ILIKE 'search_path=%'
    );
$fn$;
