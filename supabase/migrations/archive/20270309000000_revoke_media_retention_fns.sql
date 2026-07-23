-- 20270309000000_revoke_media_retention_fns.sql
--
-- Onda 0 / Slice 0.1 (SPEC .specs/features/db-optimization/SPEC.md) — close the
-- anon-executable vector on the media-retention functions (audit ADV-1, 2026-07-09).
--
-- PROBLEM: in prod, both SECURITY DEFINER functions carry an EXPLICIT grant to
-- anon AND authenticated:
--   proacl = {postgres=X, anon=X, authenticated=X, service_role=X}
-- despite 20270303000000/001 already running `REVOKE ALL ... FROM PUBLIC`. That
-- REVOKE is a NO-OP here: the grant is not the implicit PUBLIC grant — it comes
-- from pg_default_acl (the postgres role's default privileges materialise an
-- EXPLICIT anon/authenticated grant on every new function). REVOKE FROM PUBLIC
-- never touches an explicit grantee. So anyone holding the anon key (public in
-- the bundle) can:
--   • list_expired_whatsapp_media(...) → enumerate every whatsapp-media/ path
--     (org_id + phone number embedded in the object name = PII), and
--   • invoke_whatsapp_media_retention() → fire a destructive purge run.
--
-- FIX: REVOKE from the real grantees (anon, authenticated) + keep service_role
-- (cron jobid 91 / edge function). Also bound p_limit so even a privileged
-- caller cannot enumerate the whole bucket in one shot.
--
-- GOTCHA (record for future migrations): "use FROM PUBLIC" is INCOMPLETE in this
-- project. Inspect pg_proc.proacl before choosing the grantee — a grant via
-- pg_default_acl is explicit (anon/authenticated), not PUBLIC.
--
-- REPLAY SAFETY: this migration runs AFTER 20270303000000/001 on a fresh replay,
-- so the final ACL state is correct without editing those (immutable) files
-- (migrations/CLAUDE.md rule #1). The window in which anon holds EXECUTE exists
-- only mid-replay (no anon traffic then).
--
-- NOT APPLIED TO PROD BY THIS FILE — prod apply is gated on explicit CTO "vai".
-- Dev-first is blocked (dev 402 quota + divergent baseline); verify queries below
-- are the acceptance artifact.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Re-create list_expired_whatsapp_media with a hard upper bound on p_limit.
--    Body identical to 20270303000001 (jsonb return, prefix-scoped, read-only)
--    except LIMIT is now LEAST(GREATEST(p_limit, 0), 5000).
--    NB: CREATE OR REPLACE preserves the existing (leaky) ACL — the REVOKE below
--    is what actually closes it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_expired_whatsapp_media(
  p_older_than_days integer DEFAULT 30,
  p_limit           integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'path', name,
      'size', COALESCE((metadata ->> 'size')::bigint, 0)
    )),
    '[]'::jsonb
  )
  FROM (
    SELECT name, metadata
    FROM storage.objects
    WHERE bucket_id = 'media'
      AND name LIKE 'whatsapp-media/%'
      AND created_at < now() - make_interval(days => GREATEST(p_older_than_days, 0))
    ORDER BY created_at ASC
    LIMIT LEAST(GREATEST(p_limit, 0), 5000)
  ) s;
$$;

COMMENT ON FUNCTION public.list_expired_whatsapp_media(integer, integer) IS
  'Lists media bucket objects under whatsapp-media/ older than N days as a jsonb '
  'array (single row — avoids the PostgREST 1000-row cap). p_limit hard-capped at '
  '5000. service_role only (edge function whatsapp-media-retention).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The actual security fix — revoke the explicit anon/authenticated grants.
--    PUBLIC is included belt-and-suspenders (harmless no-op if absent).
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.list_expired_whatsapp_media(integer, integer)
  FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.list_expired_whatsapp_media(integer, integer)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.invoke_whatsapp_media_retention()
  FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.invoke_whatsapp_media_retention()
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Optional hardening (evaluate separately — changes the DEFAULT for ALL future
--    public functions, so it is left commented, not applied here):
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
--
-- Without this, every new SECURITY DEFINER function keeps arriving anon-executable
-- (root cause of ADV-1 and the Tier B backlog). Ship as its own reviewed change.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFY (run post-apply against the target project — acceptance criteria):
--
--   SELECT proname,
--          has_function_privilege('anon',          oid, 'execute') AS anon_exec,
--          has_function_privilege('authenticated',  oid, 'execute') AS auth_exec,
--          has_function_privilege('service_role',   oid, 'execute') AS svc_exec
--   FROM pg_proc
--   WHERE proname IN ('list_expired_whatsapp_media','invoke_whatsapp_media_retention');
--   -- EXPECT: anon_exec = false AND auth_exec = false AND svc_exec = true  (both rows)
--
--   -- Smoke (day after): cron job 'whatsapp_media_retention' still succeeded.
--   SELECT status, return_message FROM cron.job_run_details d
--   JOIN cron.job j USING (jobid) WHERE j.jobname = 'whatsapp_media_retention'
--   ORDER BY start_time DESC LIMIT 1;
-- ─────────────────────────────────────────────────────────────────────────────
