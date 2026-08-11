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

-- ---------------------------------------------------------------------------
-- Invariant 6 — No SECURITY DEFINER function in `public` that anon or
-- authenticated can EXECUTE may lack an authorization gate in its body.
--
-- A DEFINER function runs as its owner and therefore bypasses RLS. If it is
-- reachable by a browser role and never asks "who is calling, and may they
-- touch this tenant?", then every id it accepts is a steering wheel: the caller
-- picks the tenant and the function obeys. The 2026-08-11 audit closed 23 such
-- functions — cross-tenant WhatsApp dispatch, webhook delivery with an
-- attacker-chosen body, writes into `organizations`, and readers that returned
-- lead phone numbers from any organization.
--
-- TWO SCOPING MISTAKES THIS DETECTOR DELIBERATELY DOES NOT REPEAT — both were
-- measured on 2026-08-11, and each one produced a false clean bill of health:
--
--   1. It does NOT filter on "takes organization_id as a parameter".
--      `schedule_rule_steps_from_position` survived three sweeps that way: it
--      takes `whatsapp_instance_id`, not an org id, and let a caller schedule a
--      send through the victim's own WhatsApp number. ANY caller-controlled id
--      is a steering wheel. The population is defined by WHO CAN REACH the
--      function, never by which parameters it happens to accept.
--
--   2. It does NOT filter on "the body writes".
--      The first cut required INSERT/UPDATE/DELETE and was blind to
--      exfiltration: it found 9 where there were 24, and the ones it missed
--      were readers handing back lead phone numbers cross-tenant. Reading the
--      wrong tenant's data is the same breach as writing it.
--
-- WHAT COUNTS AS A GATE — two ways, and the difference between them is the
-- whole point:
--
--   (a) a call to a known authorization helper. The list below is MEASURED, not
--       guessed: every entry either derives the caller's identity from the JWT
--       with no parameter to lie about (`prosrc` references `auth.uid()`,
--       `pronargs = 0`) or is an assertion helper that refuses. Helpers that
--       take an id by parameter and trust it — `has_role`, `is_team_member`,
--       `lead_in_my_org`, `get_org_team_member_ids` — are deliberately NOT on
--       the list: a caller who picks the id being checked has not been gated.
--
--   (b) `auth.uid()` / `auth.org_id()` **in a position that decides something**
--       — inside IF / WHERE / AND / EXISTS / RAISE, within the same statement.
--
-- (b) is not pedantry, and it is the correction that made this detector honest.
-- Stamping the author is one of the most common things a DEFINER function does
-- — `owner_id, auth.uid()` in a VALUES, `created_by := auth.uid()` — and a
-- stamp REFUSES NOTHING. `public.log_activity(...)` is the measured example:
-- its only `auth.uid()` is the value of `owner_id` in an INSERT, while its real
-- gate is `get_user_organization_id()` followed by `IF ... IS NULL THEN RAISE`.
-- Matching the bare token would have called it gated FOR THE WRONG REASON —
-- and, worse, would have kept calling it gated on the day someone deleted the
-- only check it has. An invariant whose verdict is decorrelated from the fact
-- it claims to measure is not a gate; it is a decoration.
--
-- COMMENTS ARE STRIPPED FIRST, and the stripper is iterative because **Postgres
-- block comments NEST**: `/* a /* b */ c */` is one comment, and a single
-- non-greedy `/\*.*?\*/` stops at the first `*/`, leaving ` c */` behind — so
-- `/* nota: /* TODO */ chamar assert_org_access aqui */` would have left the
-- token sitting in prose and bought the pass the stripping exists to deny.
-- `_rls_inv_strip_sql_comments` removes the innermost block repeatedly until it
-- reaches a fixed point, then removes line comments.
--
-- KNOWN IMPRECISION, stated on purpose: this is textual. A function that gates
-- through some other helper not on the list reads as a violation. That is a
-- FALSE POSITIVE — loud, visible, absorbed by the ratchet — and it is the
-- direction we choose. The two silent directions (a stamp read as a gate; a
-- token in a nested comment read as a gate) are the ones closed above.
-- ---------------------------------------------------------------------------

-- Strips SQL comments, handling the nesting Postgres allows in block comments.
-- Innermost-first, repeated to a fixed point; the guard bounds pathological
-- input rather than trusting it.
CREATE OR REPLACE FUNCTION public._rls_inv_strip_sql_comments(p_src text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path TO 'pg_catalog'
AS $fn$
DECLARE
  v_prev  text;
  v_out   text := coalesce(p_src, '');
  v_guard int  := 0;
BEGIN
  LOOP
    v_prev := v_out;
    -- innermost block = one containing neither an opening nor a closing marker
    v_out  := regexp_replace(v_out, '/\*((?!/\*)(?!\*/).)*\*/', ' ', 'gs');
    v_guard := v_guard + 1;
    EXIT WHEN v_out = v_prev OR v_guard > 50;
  END LOOP;
  RETURN regexp_replace(v_out, '--[^\n]*', ' ', 'g');
END;
$fn$;
CREATE OR REPLACE FUNCTION public._rls_inv_definer_without_gate()
RETURNS TABLE (
  schemaname            name,
  functionname          name,
  identity_args         text,
  anon_can_execute      boolean,
  auth_can_execute      boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_catalog'
AS $fn$
  SELECT
    n.nspname  AS schemaname,
    pr.proname AS functionname,
    pg_get_function_identity_arguments(pr.oid) AS identity_args,
    (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
       AND has_function_privilege('anon', pr.oid, 'EXECUTE'))          AS anon_can_execute,
    (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
       AND has_function_privilege('authenticated', pr.oid, 'EXECUTE')) AS auth_can_execute
  FROM pg_proc pr
  JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public'
    AND pr.prosecdef = true
    AND pr.prokind = 'f'
    -- Trigger/event-trigger functions cannot be invoked as an RPC: PostgREST
    -- does not expose them and they fire as the table owner regardless of any
    -- EXECUTE grant. Same carve-out as INV-2.
    AND pr.prorettype NOT IN ('pg_catalog.trigger'::regtype, 'pg_catalog.event_trigger'::regtype)
    -- Extension-owned functions (pgtap, pg_graphql, …) are not ours to gate.
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.objid = pr.oid AND d.deptype = 'e'
    )
    -- REACHABILITY, the only population filter: a browser role can call it.
    AND (
      (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
         AND has_function_privilege('anon', pr.oid, 'EXECUTE'))
      OR (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
         AND has_function_privilege('authenticated', pr.oid, 'EXECUTE'))
    )
    -- ...and the body never establishes who is calling.
    AND NOT (
      -- (a) calls a known authorization helper (measured list — see header)
      public._rls_inv_strip_sql_comments(pr.prosrc) ~* '(assert_org_access|assert_org_member|is_master_user|resolve_org_for_rpc|get_user_organization_id|get_user_org_role|get_my_organization_ids|get_my_admin_organization_ids|get_my_team_member_ids|get_my_org_ids|get_my_gestor_organization_ids|get_my_team_admin_organization_ids|is_user_admin)'
      -- (b) ...or uses auth.uid()/auth.org_id() where it DECIDES something —
      -- inside IF/WHERE/AND/EXISTS/RAISE, bounded to the same statement by
      -- forbidding a `;` in between. A bare `auth.uid()` sitting in a VALUES
      -- list is a stamp, not a gate, and does not satisfy this.
      OR public._rls_inv_strip_sql_comments(pr.prosrc) ~* '(\mif\M|\mwhere\M|\mand\M|\mexists\M|\mraise\M)[^;]{0,200}auth\s*\.\s*(uid|org_id)\s*\('
    );
$fn$;
