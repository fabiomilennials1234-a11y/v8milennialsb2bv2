-- 20261117000100_sensitive_access_log_foundation.sql
--
-- ISSUE #651 — Sensitive-read audit log (foundation slice).
--
-- Durable, append-only audit trail for sensitive READS (PII export, portfolio
-- dumps, etc). Today we only audit MASTER writes (master_audit_logs). There is
-- no record of an org-admin pulling the full customer portfolio or exporting
-- leads. This slice builds the foundation + wires ONE representative guarded
-- reader as the integration pattern.
--
-- Design:
--   1. public.sensitive_access_log — append-only table. RLS: service_role full;
--      org-admins SELECT only their own org's rows; NOBODY can UPDATE/DELETE
--      (no policy granted for those verbs => denied even with RLS enabled).
--   2. public.log_sensitive_access(...) — SECURITY DEFINER inserter. Uses
--      auth.uid() as actor. EXECUTE granted ONLY to authenticated + service_role
--      (revoked from PUBLIC/anon). SET search_path hardens against hijack.
--   3. get_portfolio_clients — re-created body-preserving, adding (a) the
--      already-standard assert_org_access() guard it was missing, then (b) the
--      log call right after the guard passes.
--
-- Fully idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS,
-- CREATE OR REPLACE FUNCTION, catalog-driven grant revocation.

-- =============================================================================
-- 1. Append-only audit table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.sensitive_access_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action          text NOT NULL,
  target_type     text NOT NULL,
  target_id       uuid,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sensitive_access_log IS
  'Append-only audit trail for sensitive READS (PII export, portfolio dumps). '
  'No UPDATE/DELETE policy => immutable for non-service_role. Writes go through '
  'public.log_sensitive_access().';

CREATE INDEX IF NOT EXISTS idx_sensitive_access_log_org_created
  ON public.sensitive_access_log (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sensitive_access_log_actor
  ON public.sensitive_access_log (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_sensitive_access_log_target
  ON public.sensitive_access_log (target_type, target_id);

ALTER TABLE public.sensitive_access_log ENABLE ROW LEVEL SECURITY;
-- NOTE: deliberately NOT FORCE RLS. The SECURITY DEFINER inserter
-- (log_sensitive_access) is owned by the privileged migration role, which is
-- exempt from non-forced RLS — that is exactly how it writes rows without the
-- caller holding INSERT. This mirrors the proven master_audit_logs pattern.

-- service_role: full access (backend / jobs / the inserter function's grantee).
DROP POLICY IF EXISTS sensitive_access_log_service_all ON public.sensitive_access_log;
CREATE POLICY sensitive_access_log_service_all ON public.sensitive_access_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- org-admins (and masters) may SELECT their own org's audit rows.
-- get_my_admin_organization_ids() is SECURITY DEFINER (bypasses team_members
-- RLS) — mandatory to avoid Realtime apply_rls recursion (see project gotchas).
DROP POLICY IF EXISTS sensitive_access_log_admin_select ON public.sensitive_access_log;
CREATE POLICY sensitive_access_log_admin_select ON public.sensitive_access_log
  FOR SELECT
  TO authenticated
  USING (
    public.is_master_user()
    OR organization_id IN (SELECT public.get_my_admin_organization_ids())
  );

-- NO INSERT/UPDATE/DELETE policy for authenticated => those verbs are denied
-- for org-admins/members (append-only from their perspective). Inserts happen
-- exclusively through log_sensitive_access() (SECURITY DEFINER, owner-exempt).

-- Base table grants: authenticated may only SELECT (RLS narrows to own org).
-- The inserter function is SECURITY DEFINER so it does not rely on the caller
-- holding INSERT. service_role keeps full DML for backend use.
REVOKE ALL ON public.sensitive_access_log FROM PUBLIC;
GRANT SELECT ON public.sensitive_access_log TO authenticated;
GRANT ALL ON public.sensitive_access_log TO service_role;

-- =============================================================================
-- 2. SECURITY DEFINER inserter
-- =============================================================================
-- Records one audit row. actor = auth.uid() (NULL for service_role/cron, which
-- is fine — metadata can carry a 'source' marker). SECURITY DEFINER so the
-- write succeeds regardless of the caller's table grants; SET search_path
-- prevents object-resolution hijack. Idempotent via CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.log_sensitive_access(
  p_action      text,
  p_target_type text,
  p_target_id   uuid,
  p_org_id      uuid,
  p_metadata    jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'log_sensitive_access: p_org_id is required'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.sensitive_access_log (
    organization_id, actor_user_id, action, target_type, target_id, metadata
  ) VALUES (
    p_org_id,
    auth.uid(),
    p_action,
    p_target_type,
    p_target_id,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.log_sensitive_access(text, text, uuid, uuid, jsonb) IS
  'Append a sensitive-read audit row (actor = auth.uid()). EXECUTE limited to '
  'authenticated + service_role. Call AFTER the caller''s org/membership guard '
  'passes. ISSUE #651.';

-- Lock down EXECUTE: revoke from the world, grant only to real principals.
-- anon must NOT be able to forge audit rows for arbitrary orgs.
REVOKE ALL ON FUNCTION public.log_sensitive_access(text, text, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_sensitive_access(text, text, uuid, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.log_sensitive_access(text, text, uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_sensitive_access(text, text, uuid, uuid, jsonb) TO service_role;

-- =============================================================================
-- 3. Wire the pattern into ONE representative guarded reader
-- =============================================================================
-- get_portfolio_clients dumps the full customer portfolio (PII: names, phones,
-- companies, lifetime value) for an org. It is SECURITY DEFINER and — despite a
-- code comment elsewhere claiming otherwise — shipped WITHOUT an org-access
-- guard, trusting p_org_id blindly (latent cross-tenant read). We re-create it
-- body-preserving (canonical body from 20261019000004_portfolio_rpc_add_churn),
-- adding only:
--   (a) PERFORM public.assert_org_access(p_org_id)  -- close the missing guard
--   (b) PERFORM public.log_sensitive_access(...)    -- the #651 audit hook
-- right at the top, AFTER the guard. Everything below the BEGIN is unchanged.
--
-- NOTE: the original was declared STABLE. A STABLE function may not perform the
-- INSERT inside log_sensitive_access (read-only context). This RPC is invoked
-- once per request (not inside a query plan that relies on stability), so we
-- drop the STABLE marker (=> VOLATILE default). No caller depends on STABLE.

CREATE OR REPLACE FUNCTION public.get_portfolio_clients(
  p_org_id    UUID,
  p_filter    TEXT    DEFAULT 'all',
  p_search    TEXT    DEFAULT '',
  p_sort_by   TEXT    DEFAULT 'name',
  p_sort_dir  TEXT    DEFAULT 'asc',
  p_page      INT     DEFAULT 1,
  p_page_size INT     DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset       INT := (p_page - 1) * p_page_size;
  v_total        INT;
  v_rows         JSONB;
  v_allowed_sorts TEXT[] := ARRAY[
    'name', 'health_score', 'avg_ticket', 'days_since_last_order',
    'next_order_expected', 'lifetime_value', 'order_count', 'churn_probability'
  ];
  v_sort         TEXT;
  v_dir          TEXT;
  v_where        TEXT;
BEGIN
  -- [#651] Guard FIRST: caller must be service_role / master / member of p_org_id.
  PERFORM public.assert_org_access(p_org_id);

  -- [#651] Audit the sensitive portfolio read AFTER the guard passes.
  PERFORM public.log_sensitive_access(
    'portfolio.read',
    'organization',
    p_org_id,
    p_org_id,
    jsonb_build_object(
      'filter',    p_filter,
      'search',    NULLIF(p_search, ''),
      'page',      p_page,
      'page_size', p_page_size
    )
  );

  IF p_sort_by = ANY(v_allowed_sorts) THEN
    v_sort := p_sort_by;
  ELSE
    v_sort := 'name';
  END IF;

  IF lower(p_sort_dir) = 'desc' THEN
    v_dir := 'DESC';
  ELSE
    v_dir := 'ASC';
  END IF;

  v_where := format('organization_id = %L AND is_active = true', p_org_id);

  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || format(
      ' AND (name ILIKE %L OR company ILIKE %L)',
      '%' || p_search || '%',
      '%' || p_search || '%'
    );
  END IF;

  IF p_filter = 'overdue' THEN
    v_where := v_where
      || ' AND days_since_last_order IS NOT NULL'
      || ' AND reorder_cycle_days IS NOT NULL'
      || ' AND days_since_last_order > reorder_cycle_days * 1.15';
  ELSIF p_filter = 'expected' THEN
    v_where := v_where
      || ' AND next_order_expected IS NOT NULL'
      || ' AND next_order_expected >= NOW()'
      || ' AND next_order_expected <= NOW() + INTERVAL ''7 days''';
  ELSIF p_filter IN ('ouro', 'prata', 'novo', 'resgate', 'dormindo') THEN
    v_where := v_where || format(' AND segment = %L', p_filter);
  END IF;

  EXECUTE format('SELECT COUNT(*)::int FROM upsell_clients WHERE %s', v_where)
    INTO v_total;

  EXECUTE format(
    $q$
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    FROM (
      SELECT id, name, company, phone, health_score, health_status, segment,
             avg_ticket, days_since_last_order, reorder_cycle_days,
             next_order_expected, order_count, lifetime_value, lead_id, trend,
             churn_probability
      FROM upsell_clients
      WHERE %s
      ORDER BY %I %s NULLS LAST
      LIMIT %s OFFSET %s
    ) t
    $q$,
    v_where, v_sort, v_dir, p_page_size, v_offset
  ) INTO v_rows;

  RETURN jsonb_build_object(
    'rows',        COALESCE(v_rows, '[]'::jsonb),
    'total',       v_total,
    'page',        p_page,
    'page_size',   p_page_size,
    'total_pages', GREATEST(CEIL(v_total::numeric / p_page_size)::int, 1)
  );
END;
$$;

-- Preserve the original grants (CREATE OR REPLACE keeps them, but assert
-- explicitly for a clean re-run).
GRANT EXECUTE ON FUNCTION public.get_portfolio_clients(UUID, TEXT, TEXT, TEXT, TEXT, INT, INT)
  TO authenticated, service_role;
